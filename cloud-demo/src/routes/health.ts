import type { FastifyInstance } from "fastify";

export const SERVICE_NAME = "cloud-demo";
export const SERVICE_VERSION = "0.1.0";

export type ProbeStatus = "up" | "down" | "not_configured";

export interface ProbeResult {
  status: ProbeStatus;
  latencyMs?: number;
  detail?: string;
}

/** Optional dependency probes wired in by later stages (RDS, Redis). */
export interface HealthProbes {
  rds?: () => Promise<ProbeResult>;
  redis?: () => Promise<ProbeResult>;
  upstream?: () => Promise<ProbeResult>;
}

export interface HealthReport {
  status: "ok" | "degraded";
  service: string;
  version: string;
  uptimeSeconds: number;
  checks: {
    api: ProbeResult;
    rds: ProbeResult;
    redis: ProbeResult;
    upstream: ProbeResult;
  };
}

const NOT_CONFIGURED: ProbeResult = { status: "not_configured" };

async function runProbe(
  probe?: () => Promise<ProbeResult>,
): Promise<ProbeResult> {
  if (!probe) return NOT_CONFIGURED;
  const startedAt = Date.now();
  try {
    return await probe();
  } catch (error) {
    return {
      status: "down",
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function registerHealthRoute(
  app: FastifyInstance,
  probes: HealthProbes = {},
): void {
  app.get("/health", async (): Promise<HealthReport> => {
    const [rds, redis, upstream] = await Promise.all([
      runProbe(probes.rds),
      runProbe(probes.redis),
      runProbe(probes.upstream),
    ]);
    const degraded =
      rds.status === "down" ||
      redis.status === "down" ||
      upstream.status === "down";
    return {
      status: degraded ? "degraded" : "ok",
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { api: { status: "up" }, rds, redis, upstream },
    };
  });
}

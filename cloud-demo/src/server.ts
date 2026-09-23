import { pathToFileURL } from "node:url";
import { buildServer, type AppServices } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDatabase, type Database } from "./services/db.ts";
import { RedisCacheStore, type CacheStore } from "./services/cache.ts";
import { createUpstream } from "./services/upstream.ts";
import { PostgresMemoryRepository } from "./services/memory-repo.ts";
import { TranslationOrchestrator } from "./services/orchestrator.ts";
import type { HealthProbes } from "./routes/health.ts";

export async function main(): Promise<void> {
  const config = loadConfig();

  let database: Database | undefined;
  let cache: CacheStore | undefined;

  if (config.rds) {
    database = createDatabase(config.rds);
  }
  if (config.redis) {
    cache = new RedisCacheStore(config.redis, {
      defaultTtlSeconds: config.cacheTtlSeconds,
    });
  }

  const upstream = createUpstream(config.upstream);
  const memoryRepo = database
    ? new PostgresMemoryRepository(database)
    : undefined;
  const orchestrator = new TranslationOrchestrator({
    upstream,
    ...(cache !== undefined ? { cache } : {}),
    ...(memoryRepo !== undefined ? { memory: memoryRepo } : {}),
    ttlSeconds: config.cacheTtlSeconds,
  });

  const upstreamKind = config.upstream.kind;
  const probes: HealthProbes = {
    upstream: async () => ({
      status: "up",
      detail:
        upstreamKind === "http"
          ? "真实上游（UPSTREAM_KIND=http）"
          : "占位上游（UPSTREAM_KIND=mock，译文带 [源->目标] 前缀）",
    }),
  };
  if (database !== undefined) {
    const db = database;
    probes.rds = async () => {
      const startedAt = Date.now();
      await db.query("SELECT 1");
      return { status: "up", latencyMs: Date.now() - startedAt };
    };
  }
  if (cache !== undefined) {
    const cs = cache;
    probes.redis = async () => {
      const ok = await cs.ping();
      return ok
        ? { status: "up" }
        : { status: "down", detail: "Redis PING 返回失败。" };
    };
  }

  const services: AppServices = {
    orchestrator,
    ...(memoryRepo !== undefined ? { memory: memoryRepo } : {}),
    probes,
  };

  const app = await buildServer(config, services);

  const shutdown = (signal: NodeJS.Signals): void => {
    app.log.info({ signal }, "正在关闭云端 API 服务。");
    void app
      .close()
      .then(async () => {
        if (cache !== undefined) await cache.close();
        if (database !== undefined) await database.close();
      })
      .then(
        () => process.exit(0),
        () => process.exit(1),
      );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await app.listen({ host: config.host, port: config.port });
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}

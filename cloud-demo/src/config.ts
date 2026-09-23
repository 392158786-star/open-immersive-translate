import { z } from "zod";

const portSchema = z.coerce.number().int().min(1).max(65535);

const logLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

export type LogLevel = z.infer<typeof logLevelSchema>;

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    API_HOST: z.string().min(1).default("0.0.0.0"),
    API_PORT: portSchema.default(8787),
    API_TOKEN: z.string().min(8).optional(),
    CORS_ORIGINS: z.string().default("*"),
    LOG_LEVEL: logLevelSchema.default("info"),

    RDS_HOST: z.string().min(1).optional(),
    RDS_PORT: portSchema.default(5432),
    RDS_DATABASE: z.string().min(1).optional(),
    RDS_USER: z.string().min(1).optional(),
    RDS_PASSWORD: z.string().optional(),
    RDS_SSL: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),

    REDIS_HOST: z.string().min(1).optional(),
    REDIS_PORT: portSchema.default(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: z.coerce.number().int().min(0).default(0),
    CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(604_800),

    UPSTREAM_KIND: z.enum(["mock", "http"]).default("mock"),
    UPSTREAM_BASE_URL: z.string().url().optional(),
    UPSTREAM_API_KEY: z.string().optional(),
    UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  })
  .superRefine((value, ctx) => {
    const rdsFields = [value.RDS_HOST, value.RDS_DATABASE, value.RDS_USER];
    const hasAnyRds = rdsFields.some((field) => field !== undefined);
    const hasAllRds = rdsFields.every((field) => field !== undefined);
    if (hasAnyRds && !hasAllRds) {
      ctx.addIssue({
        code: "custom",
        message: "RDS_HOST、RDS_DATABASE、RDS_USER 必须同时提供。",
      });
    }
    if (value.UPSTREAM_KIND === "http" && !value.UPSTREAM_BASE_URL) {
      ctx.addIssue({
        code: "custom",
        message: "UPSTREAM_KIND=http 时必须提供 UPSTREAM_BASE_URL。",
      });
    }
  });

export interface RdsConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
}

export interface UpstreamConfig {
  kind: "mock" | "http";
  baseUrl?: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  apiToken?: string;
  corsOrigins: string[];
  logLevel: LogLevel;
  cacheTtlSeconds: number;
  rds?: RdsConfig;
  redis?: RedisConfig;
  upstream: UpstreamConfig;
}

function parseCorsOrigins(raw: string): string[] {
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : ["*"];
}

function toAppConfig(
  value: z.infer<typeof envSchema>,
): AppConfig {
  const rds =
    value.RDS_HOST !== undefined &&
    value.RDS_DATABASE !== undefined &&
    value.RDS_USER !== undefined
      ? {
          host: value.RDS_HOST,
          port: value.RDS_PORT,
          database: value.RDS_DATABASE,
          user: value.RDS_USER,
          password: value.RDS_PASSWORD ?? "",
          ssl: value.RDS_SSL,
        }
      : undefined;

  const redis =
    value.REDIS_HOST !== undefined
      ? {
          host: value.REDIS_HOST,
          port: value.REDIS_PORT,
          ...(value.REDIS_PASSWORD !== undefined
            ? { password: value.REDIS_PASSWORD }
            : {}),
          db: value.REDIS_DB,
        }
      : undefined;

  return {
    nodeEnv: value.NODE_ENV,
    host: value.API_HOST,
    port: value.API_PORT,
    ...(value.API_TOKEN !== undefined ? { apiToken: value.API_TOKEN } : {}),
    corsOrigins: parseCorsOrigins(value.CORS_ORIGINS),
    logLevel: value.LOG_LEVEL,
    cacheTtlSeconds: value.CACHE_TTL_SECONDS,
    ...(rds !== undefined ? { rds } : {}),
    ...(redis !== undefined ? { redis } : {}),
    upstream: {
      kind: value.UPSTREAM_KIND,
      ...(value.UPSTREAM_BASE_URL !== undefined
        ? { baseUrl: value.UPSTREAM_BASE_URL }
        : {}),
      ...(value.UPSTREAM_API_KEY !== undefined
        ? { apiKey: value.UPSTREAM_API_KEY }
        : {}),
      timeoutMs: value.UPSTREAM_TIMEOUT_MS,
    },
  };
}

/**
 * Validate process environment into a strongly typed configuration object.
 * Throws a readable error listing every invalid field so startup fails fast.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map(
        (issue) =>
          `- ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      )
      .join("\n");
    throw new Error(`云端服务环境变量校验失败：\n${details}`);
  }
  return toAppConfig(parsed.data);
}
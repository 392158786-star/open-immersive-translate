import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.ts";
import { RedisCacheStore } from "../src/services/cache.ts";
import { createDatabase, type Database } from "../src/services/db.ts";
import { createUpstream } from "../src/services/upstream.ts";

type CheckStatus = "ok" | "warn" | "fail";

interface CheckResult {
  status: CheckStatus;
  name: string;
  detail: string;
  hint?: string;
}

const jsonOutput = process.argv.includes("--json");
const results: CheckResult[] = [];

function record(result: CheckResult): void {
  results.push(result);
  if (jsonOutput) return;
  const label =
    result.status === "ok" ? "OK  " : result.status === "warn" ? "WARN" : "FAIL";
  console.log(`[${label}] ${result.name}: ${result.detail}`);
  if (result.hint) console.log(`       → ${result.hint}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Load `cloud-demo/.env` when present so the script matches the runtime. */
function loadEnvFile(): string | undefined {
  const envPath = resolve(import.meta.dirname, "..", ".env");
  if (!existsSync(envPath)) return undefined;
  process.loadEnvFile(envPath);
  return envPath;
}

async function main(): Promise<void> {
  const envPath = loadEnvFile();
  record(
    envPath
      ? { status: "ok", name: "配置文件", detail: `已加载 ${envPath}` }
      : {
          status: "warn",
          name: "配置文件",
          detail: "未找到 cloud-demo/.env，仅使用当前进程环境变量",
          hint: "复制 .env.example 为 .env 并填写云端参数。",
        },
  );

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    record({
      status: "fail",
      name: "环境变量校验",
      detail: messageOf(error),
      hint: "按 .env.example 修正缺失或非法字段后重试。",
    });
    report();
    return;
  }

  record(
    config.apiToken
      ? {
          status: "ok",
          name: "API_TOKEN",
          detail: `已设置（长度 ${config.apiToken.length}）`,
        }
      : {
          status: "warn",
          name: "API_TOKEN",
          detail: "未设置，接口将不校验令牌",
          hint: "公网部署前必须设置至少 8 位的 API_TOKEN。",
        },
  );

  let database: Database | undefined;
  let cache: RedisCacheStore | undefined;

  try {
    if (config.rds) {
      const startedAt = Date.now();
      database = createDatabase(config.rds);
      try {
        await database.query("SELECT 1");
        record({
          status: "ok",
          name: "RDS PostgreSQL",
          detail: `连接成功（${Date.now() - startedAt}ms）`,
        });
      } catch (error) {
        record({
          status: "fail",
          name: "RDS PostgreSQL",
          detail: messageOf(error),
          hint: "检查 RDS_HOST/RDS_USER/RDS_PASSWORD、白名单与 VPC 是否放通 ECS。",
        });
      }
    } else {
      record({
        status: "warn",
        name: "RDS PostgreSQL",
        detail: "未配置，持久化降级为内存实现",
        hint: "设置 RDS_HOST/RDS_DATABASE/RDS_USER/RDS_PASSWORD 后启用。",
      });
    }

    if (config.redis) {
      const startedAt = Date.now();
      cache = new RedisCacheStore(config.redis, {
        defaultTtlSeconds: config.cacheTtlSeconds,
      });
      try {
        const alive = await cache.ping();
        record(
          alive
            ? {
                status: "ok",
                name: "DCS Redis",
                detail: `PING 成功（${Date.now() - startedAt}ms）`,
              }
            : {
                status: "fail",
                name: "DCS Redis",
                detail: "PING 返回失败",
                hint: "检查 REDIS_PASSWORD、白名单与 VPC 是否放通 ECS。",
              },
        );
      } catch (error) {
        record({
          status: "fail",
          name: "DCS Redis",
          detail: messageOf(error),
          hint: "检查 REDIS_HOST/REDIS_PASSWORD、白名单与 VPC 是否放通 ECS。",
        });
      }
    } else {
      record({
        status: "warn",
        name: "DCS Redis",
        detail: "未配置，热点缓存关闭",
        hint: "设置 REDIS_HOST（必要时含 REDIS_PASSWORD）后启用。",
      });
    }

    if (config.upstream.kind === "http") {
      const startedAt = Date.now();
      try {
        const upstream = createUpstream(config.upstream);
        const [translation] = await upstream.translate({
          texts: ["Hello, cloud readiness check."],
          from: "en",
          to: "zh-CN",
        });
        record({
          status: "ok",
          name: "上游翻译模型",
          detail: `调用成功（${Date.now() - startedAt}ms）：${(translation ?? "").slice(0, 40)}`,
        });
      } catch (error) {
        record({
          status: "fail",
          name: "上游翻译模型",
          detail: messageOf(error),
          hint: "检查 UPSTREAM_BASE_URL 可访问性、UPSTREAM_API_KEY 与 /translate 契约。",
        });
      }
    } else {
      record({
        status: "warn",
        name: "上游翻译模型",
        detail: "当前为占位上游，译文会带 [源->目标] 前缀",
        hint: "正式演示前设置 UPSTREAM_KIND=http 与 UPSTREAM_BASE_URL。",
      });
    }
  } finally {
    if (cache) await cache.close().catch(() => undefined);
    if (database) await database.close().catch(() => undefined);
  }

  report();
}

function report(): void {
  const failed = results.filter((result) => result.status === "fail");
  const warned = results.filter((result) => result.status === "warn");

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          ok: failed.length === 0,
          failed: failed.length,
          warned: warned.length,
          checks: results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("");
    console.log(
      `自检结果：${results.length - failed.length - warned.length} 项通过，${warned.length} 项待补，${failed.length} 项失败`,
    );
    if (failed.length > 0) {
      console.log("存在连接失败项，请按上面的提示修复后重跑。");
    } else if (warned.length > 0) {
      console.log("当前可运行，但仍有未配置项；正式演示前需要全部补齐。");
    } else {
      console.log("全部就绪，可以执行云端部署与演示。");
    }
  }

  process.exitCode = failed.length === 0 ? 0 : 1;
}

await main().catch((error: unknown) => {
  console.error(messageOf(error));
  process.exitCode = 1;
});

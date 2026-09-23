import { describe, expect, it } from "vitest";
import { buildServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

const testEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  API_TOKEN: "test-token-1234",
};

describe("GET /health", () => {
  it("未配置 RDS 与 Redis 时返回 ok 并标注 not_configured", async () => {
    const app = await buildServer(loadConfig(testEnv));
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("cloud-demo");
    expect(body.checks.api.status).toBe("up");
    expect(body.checks.rds.status).toBe("not_configured");
    expect(body.checks.redis.status).toBe("not_configured");
    await app.close();
  });

  it("探针失败时降级为 degraded 并保留明细", async () => {
    const app = await buildServer(loadConfig(testEnv), {
      probes: {
        rds: async () => ({ status: "up", latencyMs: 3 }),
        redis: async () => {
          throw new Error("redis connection refused");
        },
      },
    });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.rds.status).toBe("up");
    expect(body.checks.redis.status).toBe("down");
    expect(body.checks.redis.detail).toContain("redis connection refused");
    await app.close();
  });

  it("健康检查无需令牌", async () => {
    const app = await buildServer(loadConfig(testEnv));
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});

describe("鉴权与路由兜底", () => {
  it("受保护路径缺少令牌时返回 401", async () => {
    const app = await buildServer(loadConfig(testEnv));
    const response = await app.inject({ method: "GET", url: "/v1/unknown" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("unauthorized");
    await app.close();
  });

  it("携带正确令牌访问未知路径返回 404", async () => {
    const app = await buildServer(loadConfig(testEnv));
    const response = await app.inject({
      method: "GET",
      url: "/v1/unknown",
      headers: { authorization: "Bearer test-token-1234" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("not_found");
    await app.close();
  });

  it("未配置 API_TOKEN 时受保护路径直接放行", async () => {
    const app = await buildServer(
      loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
    );
    const response = await app.inject({ method: "GET", url: "/v1/unknown" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
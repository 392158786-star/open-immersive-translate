import { describe, expect, it } from "vitest";
import { buildServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { MockUpstream } from "../src/services/upstream.ts";
import { TranslationOrchestrator } from "../src/services/orchestrator.ts";
import type { MemoryQueryStore } from "../src/app.ts";
import type {
  MemoryStats,
  TranslationMemory,
  TranslationRequestRecord,
} from "../src/services/memory-repo.ts";

const testEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  API_TOKEN: "test-token-1234",
};

const authHeader = { authorization: "Bearer test-token-1234" };

function makeOrchestrator(): TranslationOrchestrator {
  return new TranslationOrchestrator({ upstream: new MockUpstream() });
}

const emptyStats: MemoryStats = {
  totalMemory: 0,
  totalHits: 0,
  totalRequests: 0,
  redisHits: 0,
  rdsHits: 0,
  upstreamRequests: 0,
};

function makeMemoryStore(
  memories: readonly TranslationMemory[] = [],
  requests: readonly TranslationRequestRecord[] = [],
  stats: MemoryStats = emptyStats,
): MemoryQueryStore {
  return {
    async listMemory(): Promise<readonly TranslationMemory[]> {
      return memories;
    },
    async listRequests(): Promise<readonly TranslationRequestRecord[]> {
      return requests;
    },
    async getStats(): Promise<MemoryStats> {
      return stats;
    },
  };
}

describe("POST /v1/translate", () => {
  it("返回 mock 上游译文", async () => {
    const app = await buildServer(loadConfig(testEnv), {
      orchestrator: makeOrchestrator(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/translate",
      headers: authHeader,
      body: { text: "hello", from: "en", to: "zh" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.sourceText).toBe("hello");
    expect(body.targetText).toBe("[en->zh] hello");
    expect(body.cacheLayer).toBe("disabled");
    await app.close();
  });

  it("缺少 text 字段时返回 400", async () => {
    const app = await buildServer(loadConfig(testEnv), {
      orchestrator: makeOrchestrator(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/translate",
      headers: authHeader,
      body: { from: "en", to: "zh" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_request");
    await app.close();
  });

  it("缺少令牌时返回 401", async () => {
    const app = await buildServer(loadConfig(testEnv), {
      orchestrator: makeOrchestrator(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/translate",
      body: { text: "hello", from: "en", to: "zh" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/memory", () => {
  it("未注入 memory 服务时返回 404", async () => {
    const app = await buildServer(loadConfig(testEnv), {
      orchestrator: makeOrchestrator(),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/memory",
      headers: authHeader,
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("注入 memory 服务时返回条目列表", async () => {
    const items: readonly TranslationMemory[] = [
      {
        id: 1,
        sourceHash: "abc",
        sourceText: "hello",
        targetText: "[en->zh] hello",
        fromLang: "en",
        toLang: "zh",
        serviceId: "mock",
        hitCount: 3,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const app = await buildServer(loadConfig(testEnv), {
      memory: makeMemoryStore(items),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/memory",
      headers: authHeader,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    await app.close();
  });
});

describe("GET /v1/stats", () => {
  it("返回统计信息", async () => {
    const stats: MemoryStats = {
      totalMemory: 10,
      totalHits: 42,
      totalRequests: 100,
      redisHits: 30,
      rdsHits: 50,
      upstreamRequests: 20,
    };
    const app = await buildServer(loadConfig(testEnv), {
      memory: makeMemoryStore([], [], stats),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/stats",
      headers: authHeader,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().totalMemory).toBe(10);
    await app.close();
  });
});

describe("GET /v1/requests", () => {
  it("返回请求记录列表", async () => {
    const items: readonly TranslationRequestRecord[] = [
      {
        id: 1,
        requestId: "req-1",
        sourceHash: "abc",
        fromLang: "en",
        toLang: "zh",
        cacheLayer: "upstream",
        latencyMs: 12,
        status: "success",
        errorCode: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const app = await buildServer(loadConfig(testEnv), {
      memory: makeMemoryStore([], items),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/requests",
      headers: authHeader,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    await app.close();
  });
});
import { describe, expect, it, vi } from "vitest";
import type { Database, QueryResult } from "../src/services/db.ts";
import {
  PostgresMemoryRepository,
  type MemoryStats,
  type TranslationMemory,
} from "../src/services/memory-repo.ts";

function createDatabase() {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const results: Array<QueryResult<unknown>> = [];
  const database: Database = {
    async query<Row>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>> {
      calls.push({ text, ...(values !== undefined ? { values } : {}) });
      const result = results.shift() ?? { rows: [], rowCount: 0 };
      return result as QueryResult<Row>;
    },
    close: vi.fn(async () => undefined),
  };
  return {
    database,
    calls,
    pushResult(result: QueryResult<unknown>) {
      results.push(result);
    },
  };
}

const memoryRow = {
  id: "1",
  source_hash: "hash",
  source_text: "hello",
  target_text: "你好",
  from_lang: "en",
  to_lang: "zh",
  service_id: "mock",
  hit_count: "3",
  created_at: "2026-09-23T00:00:00.000Z",
  updated_at: "2026-09-23T01:00:00.000Z",
};

describe("PostgresMemoryRepository", () => {
  it("读取并映射翻译记忆", async () => {
    const harness = createDatabase();
    harness.pushResult({ rows: [memoryRow], rowCount: 1 });
    const repository = new PostgresMemoryRepository(harness.database);

    const memory = await repository.findMemory("hash", "en", "zh", "mock");

    expect(memory).toEqual<TranslationMemory>({
      id: 1,
      sourceHash: "hash",
      sourceText: "hello",
      targetText: "你好",
      fromLang: "en",
      toLang: "zh",
      serviceId: "mock",
      hitCount: 3,
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T01:00:00.000Z",
    });
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.text).toContain("FROM translation_memory");
    expect(harness.calls[0]?.values).toEqual(["hash", "en", "zh", "mock"]);
  });

  it("没有记录时返回 null", async () => {
    const repository = new PostgresMemoryRepository(createDatabase().database);
    await expect(
      repository.findMemory("missing", "en", "zh", "mock"),
    ).resolves.toBeNull();
  });

  it("保存时使用唯一键冲突更新", async () => {
    const harness = createDatabase();
    harness.pushResult({ rows: [memoryRow], rowCount: 1 });
    const repository = new PostgresMemoryRepository(harness.database);

    const memory = await repository.saveMemory({
      sourceHash: "hash",
      sourceText: "hello",
      targetText: "你好",
      fromLang: "en",
      toLang: "zh",
      serviceId: "mock",
    });

    expect(memory.targetText).toBe("你好");
    expect(harness.calls[0]?.text).toContain("ON CONFLICT");
    expect(harness.calls[0]?.values).toEqual([
      "hash",
      "hello",
      "你好",
      "en",
      "zh",
      "mock",
    ]);
  });

  it("保存结果为空时抛出可识别错误", async () => {
    const repository = new PostgresMemoryRepository(createDatabase().database);
    await expect(
      repository.saveMemory({
        sourceHash: "hash",
        sourceText: "hello",
        targetText: "你好",
        fromLang: "en",
        toLang: "zh",
        serviceId: "mock",
      }),
    ).rejects.toThrow("RDS did not return");
  });

  it("写入调用记录时保留缓存层和错误码", async () => {
    const harness = createDatabase();
    const repository = new PostgresMemoryRepository(harness.database);

    await repository.recordRequest({
      requestId: "req-1",
      sourceHash: "hash",
      fromLang: "en",
      toLang: "zh",
      cacheLayer: "redis",
      latencyMs: 12,
      status: "success",
    });

    expect(harness.calls[0]?.text).toContain(
      "INSERT INTO translation_requests",
    );
    expect(harness.calls[0]?.values).toEqual([
      "req-1",
      "hash",
      "en",
      "zh",
      "redis",
      12,
      "success",
      null,
    ]);
  });

  it("统计结果将数据库字符串转换为数字", async () => {
    const harness = createDatabase();
    harness.pushResult({
      rows: [
        {
          total_memory: "7",
          total_hits: "11",
          total_requests: "5",
          redis_hits: "3",
          rds_hits: "1",
          upstream_requests: "1",
        },
      ],
      rowCount: 1,
    });
    const repository = new PostgresMemoryRepository(harness.database);

    await expect(repository.getStats()).resolves.toEqual({
      totalMemory: 7,
      totalHits: 11,
      totalRequests: 5,
      redisHits: 3,
      rdsHits: 1,
      upstreamRequests: 1,
    } satisfies MemoryStats);
  });
});

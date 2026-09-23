import { describe, expect, it } from "vitest";
import {
  sha1Hex,
  translationCacheKey,
  type CacheStore,
} from "../src/services/cache.ts";
import type {
  RecordRequestInput,
  SaveMemoryInput,
  TranslationMemory,
} from "../src/services/memory-repo.ts";
import {
  TranslationOrchestrator,
  type TranslationMemoryStore,
} from "../src/services/orchestrator.ts";
import {
  MockUpstream,
  type TranslationUpstream,
  type UpstreamTranslateInput,
} from "../src/services/upstream.ts";

function keyFor(
  text: string,
  from = "en",
  to = "zh",
  serviceId = "mock",
): string {
  return translationCacheKey({ serviceId, from, to, text });
}

function createClock(stepMs: number): () => number {
  let current = 0;
  return () => {
    const value = current;
    current += stepMs;
    return value;
  };
}

interface FakeCache {
  cache: CacheStore;
  store: Map<string, string>;
  getManyCalls: string[][];
}

function createFakeCache(
  initial: Record<string, string> = {},
  overrides: Partial<CacheStore> = {},
): FakeCache {
  const store = new Map<string, string>(Object.entries(initial));
  const getManyCalls: string[][] = [];
  const base: CacheStore = {
    async get<T>(key: string): Promise<T | null> {
      const raw = store.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    async set(key: string, value: unknown): Promise<void> {
      store.set(key, JSON.stringify(value));
    },
    async getMany<T>(keys: readonly string[]): Promise<Array<T | null>> {
      getManyCalls.push([...keys]);
      return keys.map((key) => {
        const raw = store.get(key);
        return raw === undefined ? null : (JSON.parse(raw) as T);
      });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async ping(): Promise<boolean> {
      return true;
    },
    async close(): Promise<void> {
      return undefined;
    },
  };
  const cache: CacheStore = { ...base, ...overrides };
  return { cache, store, getManyCalls };
}

interface FakeMemory {
  memory: TranslationMemoryStore;
  records: RecordRequestInput[];
  saved: SaveMemoryInput[];
  hitCalls: Array<{ sourceHash: string; serviceId: string }>;
}

function createMemoryRecord(targetText: string): TranslationMemory {
  return {
    id: 1,
    sourceHash: sha1Hex("hello"),
    sourceText: "hello",
    targetText,
    fromLang: "en",
    toLang: "zh",
    serviceId: "mock",
    hitCount: 1,
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
  };
}

function createMemoryFor(
  sourceText: string,
  targetText: string,
): TranslationMemory {
  return {
    ...createMemoryRecord(targetText),
    sourceHash: sha1Hex(sourceText),
    sourceText,
  };
}

function createFakeMemory(
  remembered: TranslationMemory | null = null,
  overrides: Partial<TranslationMemoryStore> = {},
): FakeMemory {
  const records: RecordRequestInput[] = [];
  const saved: SaveMemoryInput[] = [];
  const hitCalls: Array<{ sourceHash: string; serviceId: string }> = [];
  const base: TranslationMemoryStore = {
    async findMemory(): Promise<TranslationMemory | null> {
      return remembered;
    },
    async saveMemory(input: SaveMemoryInput): Promise<TranslationMemory> {
      saved.push(input);
      return {
        id: saved.length,
        ...input,
        hitCount: 0,
        createdAt: "2026-09-23T00:00:00.000Z",
        updatedAt: "2026-09-23T00:00:00.000Z",
      };
    },
    async incrementMemoryHit(): Promise<void> {
      hitCalls.push({ sourceHash: sha1Hex("hello"), serviceId: "mock" });
    },
    async recordRequest(input: RecordRequestInput): Promise<void> {
      records.push(input);
    },
  };
  const memory: TranslationMemoryStore = { ...base, ...overrides };
  return { memory, records, saved, hitCalls };
}

interface FakeUpstream {
  upstream: TranslationUpstream;
  calls: string[];
}

function createFakeUpstream(
  translate: (text: string) => string = (text: string) => `[mock] ${text}`,
): FakeUpstream {
  const calls: string[] = [];
  const upstream: TranslationUpstream = {
    id: "mock",
    async translate(input: UpstreamTranslateInput): Promise<string[]> {
      calls.push(...input.texts);
      return input.texts.map((text: string) => translate(text));
    },
  };
  return { upstream, calls };
}

interface OrchestratorOverrides {
  upstream: TranslationUpstream;
  cache?: CacheStore;
  memory?: TranslationMemoryStore;
  stepMs?: number;
  onError?: (error: unknown, context: string) => void;
}

function createOrchestrator(
  options: OrchestratorOverrides,
): TranslationOrchestrator {
  return new TranslationOrchestrator({
    upstream: options.upstream,
    ...(options.cache !== undefined ? { cache: options.cache } : {}),
    ...(options.memory !== undefined ? { memory: options.memory } : {}),
    now: createClock(options.stepMs ?? 10),
    generateRequestId: () => "req-1",
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
}

describe("MockUpstream", () => {
  it("对相同输入产生相同输出", async () => {
    const upstream = new MockUpstream();

    const first = await upstream.translate({
      texts: ["hello", "world"],
      from: "en",
      to: "zh",
    });
    const second = await upstream.translate({
      texts: ["hello", "world"],
      from: "en",
      to: "zh",
    });

    expect(first).toEqual(second);
    expect(first).toEqual(["[en->zh] hello", "[en->zh] world"]);
    expect(upstream.id).toBe("mock");
  });

  it("空字符串保持原样", async () => {
    const upstream = new MockUpstream();
    await expect(
      upstream.translate({ texts: [""], from: "en", to: "zh" }),
    ).resolves.toEqual([""]);
  });
});

describe("TranslationOrchestrator", () => {
  it("Redis 命中时直接返回并记为 redis", async () => {
    const fakeCache = createFakeCache({
      [keyFor("hello")]: JSON.stringify({ targetText: "缓存译文" }),
    });
    const fakeMemory = createFakeMemory();
    const fakeUpstream = createFakeUpstream();
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream.upstream,
      cache: fakeCache.cache,
      memory: fakeMemory.memory,
      stepMs: 40,
    });

    const result = await orchestrator.translate({
      text: "hello",
      from: "en",
      to: "zh",
    });

    expect(result).toEqual({
      requestId: "req-1",
      sourceText: "hello",
      targetText: "缓存译文",
      cacheLayer: "redis",
      latencyMs: 40,
    });
    expect(fakeUpstream.calls).toEqual([]);
    expect(fakeMemory.saved).toEqual([]);
    expect(fakeMemory.hitCalls).toEqual([]);
    expect(fakeMemory.records).toHaveLength(1);
    expect(fakeMemory.records[0]).toMatchObject({
      requestId: "req-1",
      cacheLayer: "redis",
      status: "success",
      latencyMs: 40,
    });
  });

  it("RDS 命中时写回 Redis 并累计命中次数", async () => {
    const fakeCache = createFakeCache();
    const fakeMemory = createFakeMemory(createMemoryRecord("记忆译文"));
    const fakeUpstream = createFakeUpstream();
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream.upstream,
      cache: fakeCache.cache,
      memory: fakeMemory.memory,
      stepMs: 25,
    });

    const result = await orchestrator.translate({
      text: "hello",
      from: "en",
      to: "zh",
    });

    expect(result.cacheLayer).toBe("rds");
    expect(result.targetText).toBe("记忆译文");
    expect(result.latencyMs).toBe(25);
    expect(fakeUpstream.calls).toEqual([]);
    expect(fakeMemory.hitCalls).toEqual([
      { sourceHash: sha1Hex("hello"), serviceId: "mock" },
    ]);
    expect(fakeCache.store.get(keyFor("hello"))).toBe(
      JSON.stringify({ targetText: "记忆译文" }),
    );
    expect(fakeMemory.records[0]?.cacheLayer).toBe("rds");
  });

  it("两级都未命中时调用上游并写回 Redis 与 RDS", async () => {
    const fakeCache = createFakeCache();
    const fakeMemory = createFakeMemory();
    const fakeUpstream = createFakeUpstream();
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream.upstream,
      cache: fakeCache.cache,
      memory: fakeMemory.memory,
      stepMs: 15,
    });

    const result = await orchestrator.translate({
      text: "hello",
      from: "en",
      to: "zh",
    });

    expect(result.cacheLayer).toBe("upstream");
    expect(result.targetText).toBe("[mock] hello");
    expect(fakeUpstream.calls).toEqual(["hello"]);
    expect(fakeCache.store.get(keyFor("hello"))).toBe(
      JSON.stringify({ targetText: "[mock] hello" }),
    );
    expect(fakeMemory.saved).toEqual([
      {
        sourceHash: sha1Hex("hello"),
        sourceText: "hello",
        targetText: "[mock] hello",
        fromLang: "en",
        toLang: "zh",
        serviceId: "mock",
      },
    ]);
    expect(fakeMemory.records[0]?.cacheLayer).toBe("upstream");
  });

  it("未配置 Redis 与 RDS 时标记为 disabled 且仍返回译文", async () => {
    const fakeUpstream = createFakeUpstream();
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream.upstream,
      stepMs: 5,
    });

    const result = await orchestrator.translate({
      text: "hello",
      from: "en",
      to: "zh",
    });

    expect(result.cacheLayer).toBe("disabled");
    expect(result.targetText).toBe("[mock] hello");
    expect(result.latencyMs).toBe(5);
  });

  it("只配置 Redis 时不写 RDS", async () => {
    const fakeCache = createFakeCache();
    const fakeUpstream = createFakeUpstream();
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream.upstream,
      cache: fakeCache.cache,
      stepMs: 5,
    });

    const result = await orchestrator.translate({
      text: "hello",
      from: "en",
      to: "zh",
    });

    expect(result.cacheLayer).toBe("upstream");
    expect(fakeCache.store.has(keyFor("hello"))).toBe(true);
  });

  it("Redis 读取失败时降级到上游并上报错误", async () => {
    const contexts: string[] = [];
    const fakeCache = createFakeCache(
      {},
      {
        async get<T>(): Promise<T | null> {
          throw new Error("redis unavailable");
        },
      },
    );
    const fakeUpstream = createFakeUpstream();
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream.upstream,
      cache: fakeCache.cache,
      stepMs: 5,
      onError: (_error: unknown, context: string) => {
        contexts.push(context);
      },
    });

    const result = await orchestrator.translate({
      text: "hello",
      from: "en",
      to: "zh",
    });

    expect(result.cacheLayer).toBe("upstream");
    expect(result.targetText).toBe("[mock] hello");
    expect(contexts).toEqual(["cache.get"]);
  });

  it("RDS 读取失败时降级到上游并上报错误", async () => {
    const contexts: string[] = [];
    const fakeMemory = createFakeMemory(null, {
      async findMemory(): Promise<TranslationMemory | null> {
        throw new Error("rds unavailable");
      },
    });
    const fakeUpstream = createFakeUpstream();
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream.upstream,
      memory: fakeMemory.memory,
      stepMs: 5,
      onError: (_error: unknown, context: string) => {
        contexts.push(context);
      },
    });

    const result = await orchestrator.translate({
      text: "hello",
      from: "en",
      to: "zh",
    });

    expect(result.cacheLayer).toBe("upstream");
    expect(contexts).toEqual(["memory.findMemory"]);
    expect(fakeMemory.saved).toHaveLength(1);
  });

  it("RDS 写入失败不影响返回结果", async () => {
    const contexts: string[] = [];
    const fakeMemory = createFakeMemory(null, {
      async saveMemory(): Promise<TranslationMemory> {
        throw new Error("write failed");
      },
    });
    const fakeUpstream = createFakeUpstream();
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream.upstream,
      memory: fakeMemory.memory,
      stepMs: 5,
      onError: (_error: unknown, context: string) => {
        contexts.push(context);
      },
    });

    const result = await orchestrator.translate({
      text: "hello",
      from: "en",
      to: "zh",
    });

    expect(result.targetText).toBe("[mock] hello");
    expect(contexts).toEqual(["memory.saveMemory"]);
  });

  it("上游失败时记录错误请求并重新抛出", async () => {
    const fakeMemory = createFakeMemory();
    const failingUpstream: TranslationUpstream = {
      id: "mock",
      async translate(): Promise<string[]> {
        throw new Error("upstream boom");
      },
    };
    const orchestrator = createOrchestrator({
      upstream: failingUpstream,
      memory: fakeMemory.memory,
      stepMs: 30,
    });

    await expect(
      orchestrator.translate({ text: "hello", from: "en", to: "zh" }),
    ).rejects.toThrow("upstream boom");

    expect(fakeMemory.records).toHaveLength(1);
    expect(fakeMemory.records[0]).toMatchObject({
      requestId: "req-1",
      status: "error",
      cacheLayer: "upstream",
      latencyMs: 30,
      errorCode: "Error",
    });
  });

  it("批量请求一次读取 Redis 并保持返回顺序", async () => {
    const fakeCache = createFakeCache({
      [keyFor("hello")]: JSON.stringify({ targetText: "你好" }),
      [keyFor("world")]: JSON.stringify({ targetText: "世界" }),
    });
    const fakeUpstream = createFakeUpstream();
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream.upstream,
      cache: fakeCache.cache,
      stepMs: 5,
    });

    const result = await orchestrator.translateBatch({
      texts: ["hello", "world"],
      from: "en",
      to: "zh",
    });

    expect(result.results.map((item) => item.targetText)).toEqual([
      "你好",
      "世界",
    ]);
    expect(result.results.every((item) => item.cacheLayer === "redis")).toBe(
      true,
    );
    expect(fakeCache.getManyCalls).toHaveLength(1);
    expect(fakeUpstream.calls).toEqual([]);
  });

  it("批量请求只把未命中段落交给上游一次", async () => {
    const fakeCache = createFakeCache({
      [keyFor("hello")]: JSON.stringify({ targetText: "你好" }),
    });
    const remembered = createMemoryFor("world", "世界");
    const fakeMemory = createFakeMemory(null, {
      async findMemories(): Promise<TranslationMemory[]> {
        return [remembered];
      },
    });
    const fakeUpstream = createFakeUpstream();
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream.upstream,
      cache: fakeCache.cache,
      memory: fakeMemory.memory,
      stepMs: 5,
    });

    const result = await orchestrator.translateBatch({
      texts: ["hello", "world", "again"],
      from: "en",
      to: "zh",
    });

    expect(result.results.map((item) => item.cacheLayer)).toEqual([
      "redis",
      "rds",
      "upstream",
    ]);
    expect(fakeUpstream.calls).toEqual(["again"]);
  });

  it("批量上游返回条数不匹配时抛错", async () => {
    const fakeUpstream: TranslationUpstream = {
      id: "mock",
      async translate(): Promise<string[]> {
        return ["只有一条"];
      },
    };
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream,
      stepMs: 5,
    });

    await expect(
      orchestrator.translateBatch({
        texts: ["first", "second"],
        from: "en",
        to: "zh",
      }),
    ).rejects.toThrow("上游翻译服务返回的译文数量与请求不一致");
  });

  it("serviceId 参与缓存 key 计算", async () => {
    const fakeCache = createFakeCache({
      [keyFor("hello", "en", "zh", "custom")]: JSON.stringify({
        targetText: "自定义译文",
      }),
    });
    const fakeUpstream = createFakeUpstream();
    const orchestrator = createOrchestrator({
      upstream: fakeUpstream.upstream,
      cache: fakeCache.cache,
      stepMs: 5,
    });

    const result = await orchestrator.translate({
      text: "hello",
      from: "en",
      to: "zh",
      serviceId: "custom",
    });

    expect(result.cacheLayer).toBe("redis");
    expect(result.targetText).toBe("自定义译文");
  });
});

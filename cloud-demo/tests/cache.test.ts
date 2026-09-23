import { describe, expect, it } from "vitest";
import {
  DEFAULT_TTL_SECONDS,
  RedisCacheStore,
  sha1Hex,
  translationCacheKey,
  type RedisCommandClient,
  type RedisPipelineClient,
} from "../src/services/cache.ts";

const redisConfig = { host: "127.0.0.1", port: 6379, db: 0 };

interface FakeClient {
  client: RedisCommandClient;
  store: Map<string, string>;
  calls: Array<{ command: string; args: unknown[] }>;
}

function createFakeClient(
  overrides: Partial<RedisCommandClient> = {},
): FakeClient {
  const store = new Map<string, string>();
  const calls: Array<{ command: string; args: unknown[] }> = [];
  const base: RedisCommandClient = {
    async get(key: string): Promise<string | null> {
      calls.push({ command: "get", args: [key] });
      return store.get(key) ?? null;
    },
    pipeline(): RedisPipelineClient {
      const keys: string[] = [];
      const pipeline: RedisPipelineClient = {
        get(key: string): RedisPipelineClient {
          calls.push({ command: "pipeline.get", args: [key] });
          keys.push(key);
          return pipeline;
        },
        async exec(): Promise<Array<[Error | null, unknown]> | null> {
          calls.push({ command: "pipeline.exec", args: [] });
          return keys.map((key) => [null, store.get(key) ?? null]);
        },
      };
      return pipeline;
    },
    async set(key: string, value: string): Promise<unknown> {
      calls.push({ command: "set", args: [key, value] });
      store.set(key, value);
      return "OK";
    },
    async setex(
      key: string,
      ttlSeconds: number,
      value: string,
    ): Promise<unknown> {
      calls.push({ command: "setex", args: [key, ttlSeconds, value] });
      store.set(key, value);
      return "OK";
    },
    async del(key: string): Promise<number> {
      calls.push({ command: "del", args: [key] });
      return store.delete(key) ? 1 : 0;
    },
    async ping(): Promise<string> {
      calls.push({ command: "ping", args: [] });
      return "PONG";
    },
    async quit(): Promise<unknown> {
      calls.push({ command: "quit", args: [] });
      return "OK";
    },
  };
  const client: RedisCommandClient = { ...base, ...overrides };
  return { client, store, calls };
}

function createStore(fake: FakeClient, ttl?: number): RedisCacheStore {
  return new RedisCacheStore(
    redisConfig,
    ttl === undefined ? { client: fake.client } : { client: fake.client, defaultTtlSeconds: ttl },
  );
}

describe("sha1Hex", () => {
  it("对已知输入返回稳定的 SHA-1 摘要", () => {
    expect(sha1Hex("hello")).toBe(
      "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
    );
  });

  it("相同输入重复计算结果一致", () => {
    expect(sha1Hex("开源沉浸式翻译")).toBe(sha1Hex("开源沉浸式翻译"));
  });
});

describe("translationCacheKey", () => {
  const base = {
    serviceId: "mock",
    from: "en",
    to: "zh",
    text: "hello",
  };

  it("相同输入生成稳定 key", () => {
    expect(translationCacheKey(base)).toBe(translationCacheKey({ ...base }));
  });

  it("key 以命名空间开头并包含语言与服务标识", () => {
    const key = translationCacheKey(base);
    expect(key.startsWith("tm:en:zh:mock:")).toBe(true);
    expect(key.endsWith(sha1Hex("mock|en|zh|hello"))).toBe(true);
  });

  it("原文不同则 key 不同", () => {
    expect(translationCacheKey(base)).not.toBe(
      translationCacheKey({ ...base, text: "world" }),
    );
  });

  it("variant 参与 key 计算", () => {
    expect(translationCacheKey(base)).not.toBe(
      translationCacheKey({ ...base, variant: "glossary-1" }),
    );
  });

  it("方向不同则 key 不同", () => {
    expect(translationCacheKey(base)).not.toBe(
      translationCacheKey({ ...base, from: "zh", to: "en" }),
    );
  });
});

describe("RedisCacheStore", () => {
  it("默认使用内置 TTL 写入 JSON", async () => {
    const fake = createFakeClient();
    const store = createStore(fake);

    await store.set("k", { text: "你好" });

    expect(fake.calls).toEqual([
      {
        command: "setex",
        args: ["k", DEFAULT_TTL_SECONDS, JSON.stringify({ text: "你好" })],
      },
    ]);
  });

  it("支持自定义 TTL", async () => {
    const fake = createFakeClient();
    const store = createStore(fake);

    await store.set("k", { ok: true }, 30);

    expect(fake.calls[0]).toEqual({
      command: "setex",
      args: ["k", 30, JSON.stringify({ ok: true })],
    });
  });

  it("TTL 为 0 时不设置过期", async () => {
    const fake = createFakeClient();
    const store = createStore(fake);

    await store.set("k", "value", 0);

    expect(fake.calls[0]).toEqual({
      command: "set",
      args: ["k", JSON.stringify("value")],
    });
  });

  it("构造选项可覆盖默认 TTL", async () => {
    const fake = createFakeClient();
    const store = createStore(fake, 60);

    await store.set("k", 1);

    expect(fake.calls[0]).toEqual({
      command: "setex",
      args: ["k", 60, "1"],
    });
  });

  it("无法序列化的值会抛出错误", async () => {
    const fake = createFakeClient();
    const store = createStore(fake);

    await expect(store.set("k", undefined)).rejects.toThrow(
      "缓存值无法序列化为 JSON",
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("命中时返回解析后的 JSON", async () => {
    const fake = createFakeClient();
    fake.store.set("k", JSON.stringify({ text: "你好", hits: 2 }));
    const store = createStore(fake);

    await expect(store.get<{ text: string; hits: number }>("k")).resolves.toEqual(
      { text: "你好", hits: 2 },
    );
  });

  it("未命中时返回 null", async () => {
    const fake = createFakeClient();
    const store = createStore(fake);

    await expect(store.get("missing")).resolves.toBeNull();
    expect(fake.calls).toEqual([{ command: "get", args: ["missing"] }]);
  });

  it("批量读取使用 pipeline 并保持顺序", async () => {
    const fake = createFakeClient();
    fake.store.set("a", JSON.stringify({ text: "甲" }));
    fake.store.set("b", JSON.stringify({ text: "乙" }));
    const store = createStore(fake);

    await expect(
      store.getMany<{ text: string }>(["a", "missing", "b"]),
    ).resolves.toEqual([{ text: "甲" }, null, { text: "乙" }]);
    expect(fake.calls.map((call) => call.command)).toEqual([
      "pipeline.get",
      "pipeline.get",
      "pipeline.get",
      "pipeline.exec",
    ]);
  });

  it("脏数据返回 null 并清理该 key", async () => {
    const fake = createFakeClient();
    fake.store.set("k", "{not-json");
    const store = createStore(fake);

    await expect(store.get("k")).resolves.toBeNull();
    expect(fake.calls.map((call) => call.command)).toEqual(["get", "del"]);
    expect(fake.store.has("k")).toBe(false);
  });

  it("delete 调用 del", async () => {
    const fake = createFakeClient();
    const store = createStore(fake);

    await store.delete("k");

    expect(fake.calls).toEqual([{ command: "del", args: ["k"] }]);
  });

  it("ping 在 PONG 时返回 true", async () => {
    const fake = createFakeClient();
    const store = createStore(fake);

    await expect(store.ping()).resolves.toBe(true);
  });

  it("ping 在客户端异常时返回 false", async () => {
    const fake = createFakeClient({
      async ping(): Promise<string> {
        throw new Error("redis unavailable");
      },
    });
    const store = createStore(fake);

    await expect(store.ping()).resolves.toBe(false);
  });

  it("close 调用 quit", async () => {
    const fake = createFakeClient();
    const store = createStore(fake);

    await store.close();

    expect(fake.calls).toEqual([{ command: "quit", args: [] }]);
  });
});

import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import type { RedisConfig } from "../config.ts";

/** Default hot-cache retention: seven days. */
export const DEFAULT_TTL_SECONDS = 604_800;

/** Redis key namespace for translation memory entries. */
export const TRANSLATION_CACHE_PREFIX = "tm";

/** Minimal cache contract shared by the cloud API and the demo. */
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** Inputs that uniquely identify one cached translation. */
export interface TranslationCacheKeyInput {
  serviceId: string;
  from: string;
  to: string;
  text: string;
  /** Prompt-affecting glossary/context data; omitted for plain requests. */
  variant?: string;
}

/** Stable SHA-1 hex digest used when building cache keys. */
export function sha1Hex(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

/**
 * Build a deterministic Redis key for one translation.
 * The hash material mirrors the browser extension's IndexedDB cache so both
 * sides describe the same translation with the same identifier.
 */
export function translationCacheKey(input: TranslationCacheKeyInput): string {
  const variant = input.variant === undefined ? "" : `|${input.variant}`;
  const material = `${input.serviceId}|${input.from}|${input.to}|${input.text}${variant}`;
  return [
    TRANSLATION_CACHE_PREFIX,
    input.from,
    input.to,
    input.serviceId,
    sha1Hex(material),
  ].join(":");
}

/** The subset of the ioredis client the cache actually uses. */
export interface RedisCommandClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

export interface RedisCacheStoreOptions {
  /** TTL applied when a caller does not pass one explicitly. */
  defaultTtlSeconds?: number;
  /** Injected client, used by tests to avoid a live Redis instance. */
  client?: RedisCommandClient;
}

function createRedisClient(config: RedisConfig): RedisCommandClient {
  return new Redis({
    host: config.host,
    port: config.port,
    ...(config.password !== undefined ? { password: config.password } : {}),
    db: config.db,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
}

/** Redis-backed JSON cache with a per-entry TTL. */
export class RedisCacheStore implements CacheStore {
  private readonly client: RedisCommandClient;
  private readonly defaultTtlSeconds: number;

  constructor(config: RedisConfig, options: RedisCacheStoreOptions = {}) {
    this.client = options.client ?? createRedisClient(config);
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      await this.client.del(key);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (payload === undefined) {
      throw new Error("缓存值无法序列化为 JSON。");
    }
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    if (ttl > 0) {
      await this.client.setex(key, ttl, payload);
      return;
    }
    await this.client.set(key, payload);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
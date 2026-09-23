import { randomUUID } from "node:crypto";
import {
  sha1Hex,
  translationCacheKey,
  type CacheStore,
} from "./cache.ts";
import type {
  CacheLayer,
  FindMemoryInput,
  RecordRequestInput,
  RequestStatus,
  SaveMemoryInput,
  TranslationMemory,
} from "./memory-repo.ts";
import type { TranslationUpstream } from "./upstream.ts";

export interface TranslateInput {
  text: string;
  from: string;
  to: string;
  /** Defaults to the upstream id so cache entries stay provider-scoped. */
  serviceId?: string;
}

export interface TranslateOutput {
  requestId: string;
  sourceText: string;
  targetText: string;
  /** Which layer actually produced the translation. */
  cacheLayer: CacheLayer;
  latencyMs: number;
}

export interface TranslateBatchInput {
  texts: readonly string[];
  from: string;
  to: string;
  serviceId?: string;
}

export interface TranslateBatchOutput {
  results: TranslateOutput[];
}

/**
 * Persistence subset the orchestrator needs.
 * `PostgresMemoryRepository` satisfies this structurally.
 */
export interface TranslationMemoryStore {
  findMemory(
    sourceHash: string,
    fromLang: string,
    toLang: string,
    serviceId: string,
  ): Promise<TranslationMemory | null>;
  findMemories?(
    inputs: readonly FindMemoryInput[],
  ): Promise<TranslationMemory[]>;
  saveMemory(input: SaveMemoryInput): Promise<TranslationMemory>;
  incrementMemoryHit(
    sourceHash: string,
    fromLang: string,
    toLang: string,
    serviceId: string,
  ): Promise<void>;
  recordRequest(input: RecordRequestInput): Promise<void>;
}

export interface TranslationOrchestratorOptions {
  upstream: TranslationUpstream;
  cache?: CacheStore;
  memory?: TranslationMemoryStore;
  /** Overrides the cache default TTL when writing back. */
  ttlSeconds?: number;
  now?: () => number;
  generateRequestId?: () => string;
  /** Observability hook; degraded cache/persistence failures are reported here. */
  onError?: (error: unknown, context: string) => void;
}

interface CachedTranslation {
  targetText: string;
}

interface BatchEntry {
  index: number;
  text: string;
  sourceHash: string;
  cacheKey: string;
  targetText?: string;
  cacheLayer?: CacheLayer;
}
interface RequestLogEntry {
  requestId: string;
  sourceHash: string;
  fromLang: string;
  toLang: string;
  cacheLayer: CacheLayer;
  status: RequestStatus;
  latencyMs: number;
  errorCode?: string;
}

function errorCodeOf(error: unknown): string {
  if (error instanceof Error && error.name.length > 0) return error.name;
  return "UNKNOWN";
}

/**
 * Resolve one translation through Redis, then RDS, then the upstream.
 * Cache and persistence failures degrade to the next layer instead of failing
 * the request, so an unavailable Redis or RDS never blocks translation.
 */
export class TranslationOrchestrator {
  private readonly upstream: TranslationUpstream;
  private readonly cache: CacheStore | undefined;
  private readonly memory: TranslationMemoryStore | undefined;
  private readonly ttlSeconds: number | undefined;
  private readonly now: () => number;
  private readonly generateRequestId: () => string;
  private readonly onError:
    | ((error: unknown, context: string) => void)
    | undefined;

  constructor(options: TranslationOrchestratorOptions) {
    this.upstream = options.upstream;
    this.cache = options.cache;
    this.memory = options.memory;
    this.ttlSeconds = options.ttlSeconds;
    this.now = options.now ?? (() => Date.now());
    this.generateRequestId = options.generateRequestId ?? (() => randomUUID());
    this.onError = options.onError;
  }

  async translate(input: TranslateInput): Promise<TranslateOutput> {
    const startedAt = this.now();
    const requestId = this.generateRequestId();
    const serviceId = input.serviceId ?? this.upstream.id;
    const sourceHash = sha1Hex(input.text);
    const cacheKey = translationCacheKey({
      serviceId,
      from: input.from,
      to: input.to,
      text: input.text,
    });

    try {
      const cached = await this.readCache(cacheKey);
      if (cached !== null) {
        const latencyMs = this.now() - startedAt;
        await this.record({
          requestId,
          sourceHash,
          fromLang: input.from,
          toLang: input.to,
          cacheLayer: "redis",
          status: "success",
          latencyMs,
        });
        return this.output(requestId, input.text, cached, "redis", latencyMs);
      }

      const remembered = await this.readMemory(sourceHash, input, serviceId);
      if (remembered !== null) {
        await this.bumpMemoryHit(sourceHash, input, serviceId);
        await this.writeCache(cacheKey, remembered);
        const latencyMs = this.now() - startedAt;
        await this.record({
          requestId,
          sourceHash,
          fromLang: input.from,
          toLang: input.to,
          cacheLayer: "rds",
          status: "success",
          latencyMs,
        });
        return this.output(requestId, input.text, remembered, "rds", latencyMs);
      }

      const translated = await this.callUpstream(input);
      await this.writeCache(cacheKey, translated);
      await this.writeMemory(sourceHash, input, serviceId, translated);
      const latencyMs = this.now() - startedAt;
      const cacheLayer: CacheLayer = this.hasStorage()
        ? "upstream"
        : "disabled";
      await this.record({
        requestId,
        sourceHash,
        fromLang: input.from,
        toLang: input.to,
        cacheLayer,
        status: "success",
        latencyMs,
      });
      return this.output(requestId, input.text, translated, cacheLayer, latencyMs);
    } catch (error) {
      const latencyMs = this.now() - startedAt;
      await this.record({
        requestId,
        sourceHash,
        fromLang: input.from,
        toLang: input.to,
        cacheLayer: "upstream",
        status: "error",
        latencyMs,
        errorCode: errorCodeOf(error),
      });
      throw error;
    }
  }

  async translateBatch(
    input: TranslateBatchInput,
  ): Promise<TranslateBatchOutput> {
    if (input.texts.length === 0) return { results: [] };
    if (input.texts.length === 1) {
      return {
        results: [
          await this.translate({
            text: input.texts[0] as string,
            from: input.from,
            to: input.to,
            ...(input.serviceId !== undefined
              ? { serviceId: input.serviceId }
              : {}),
          }),
        ],
      };
    }

    const startedAt = this.now();
    const requestId = this.generateRequestId();
    const serviceId = input.serviceId ?? this.upstream.id;
    const entries: BatchEntry[] = input.texts.map((text, index) => ({
      index,
      text,
      sourceHash: sha1Hex(text),
      cacheKey: translationCacheKey({
        serviceId,
        from: input.from,
        to: input.to,
        text,
      }),
    }));

    try {
      const cached = await this.readCacheMany(
        entries.map((entry) => entry.cacheKey),
      );
      entries.forEach((entry, index) => {
        const targetText = cached[index];
        if (targetText !== null && targetText !== undefined) {
          entry.targetText = targetText;
          entry.cacheLayer = "redis";
        }
      });

      const memoryCandidates = entries.filter(
        (entry) => entry.targetText === undefined,
      );
      const remembered = await this.readMemories(
        memoryCandidates,
        input,
        serviceId,
      );
      for (let index = 0; index < memoryCandidates.length; index += 1) {
        const entry = memoryCandidates[index];
        const targetText = remembered[index];
        if (!entry || targetText === null || targetText === undefined) continue;
        entry.targetText = targetText;
        entry.cacheLayer = "rds";
        await this.bumpMemoryHit(
          entry.sourceHash,
          { text: entry.text, from: input.from, to: input.to },
          serviceId,
        );
        await this.writeCache(entry.cacheKey, targetText);
      }

      const misses = entries.filter((entry) => entry.targetText === undefined);
      if (misses.length > 0) {
        const translations = await this.upstream.translate({
          texts: misses.map((entry) => entry.text),
          from: input.from,
          to: input.to,
        });
        if (translations.length !== misses.length) {
          throw new Error("上游翻译服务返回的译文数量与请求不一致。");
        }
        const cacheLayer: CacheLayer = this.hasStorage()
          ? "upstream"
          : "disabled";
        for (let index = 0; index < misses.length; index += 1) {
          const entry = misses[index];
          const targetText = translations[index];
          if (!entry || targetText === undefined) {
            throw new Error("上游翻译服务未返回译文。");
          }
          entry.targetText = targetText;
          entry.cacheLayer = cacheLayer;
          await this.writeCache(entry.cacheKey, targetText);
          await this.writeMemory(
            entry.sourceHash,
            { text: entry.text, from: input.from, to: input.to },
            serviceId,
            targetText,
          );
        }
      }

      const latencyMs = this.now() - startedAt;
      const results = entries.map((entry) =>
        this.output(
          requestId,
          entry.text,
          entry.targetText as string,
          entry.cacheLayer ?? "disabled",
          latencyMs,
        ),
      );
      for (const entry of entries) {
        await this.record({
          requestId,
          sourceHash: entry.sourceHash,
          fromLang: input.from,
          toLang: input.to,
          cacheLayer: entry.cacheLayer ?? "disabled",
          status: "success",
          latencyMs,
        });
      }
      return { results };
    } catch (error) {
      const latencyMs = this.now() - startedAt;
      for (const entry of entries) {
        await this.record({
          requestId,
          sourceHash: entry.sourceHash,
          fromLang: input.from,
          toLang: input.to,
          cacheLayer: entry.cacheLayer ?? "upstream",
          status: "error",
          latencyMs,
          errorCode: errorCodeOf(error),
        });
      }
      throw error;
    }
  }

  private output(
    requestId: string,
    sourceText: string,
    targetText: string,
    cacheLayer: CacheLayer,
    latencyMs: number,
  ): TranslateOutput {
    return { requestId, sourceText, targetText, cacheLayer, latencyMs };
  }

  private hasStorage(): boolean {
    return this.cache !== undefined || this.memory !== undefined;
  }

  private async readCache(key: string): Promise<string | null> {
    if (this.cache === undefined) return null;
    try {
      const cached = await this.cache.get<CachedTranslation>(key);
      if (cached === null || typeof cached.targetText !== "string") return null;
      return cached.targetText;
    } catch (error) {
      this.warn(error, "cache.get");
      return null;
    }
  }

  private async readCacheMany(
    keys: readonly string[],
  ): Promise<Array<string | null>> {
    if (this.cache === undefined) return keys.map(() => null);
    try {
      const cached = this.cache.getMany
        ? await this.cache.getMany<CachedTranslation>(keys)
        : await Promise.all(
            keys.map((key) => this.cache?.get<CachedTranslation>(key)),
          );
      return cached.map((item) =>
        item !== null &&
        item !== undefined &&
        typeof item.targetText === "string"
          ? item.targetText
          : null,
      );
    } catch (error) {
      this.warn(error, "cache.getMany");
      return keys.map(() => null);
    }
  }

  private async writeCache(key: string, targetText: string): Promise<void> {
    if (this.cache === undefined) return;
    try {
      const payload: CachedTranslation = { targetText };
      await this.cache.set(key, payload, this.ttlSeconds);
    } catch (error) {
      this.warn(error, "cache.set");
    }
  }

  private async readMemory(
    sourceHash: string,
    input: TranslateInput,
    serviceId: string,
  ): Promise<string | null> {
    if (this.memory === undefined) return null;
    try {
      const memory = await this.memory.findMemory(
        sourceHash,
        input.from,
        input.to,
        serviceId,
      );
      return memory === null ? null : memory.targetText;
    } catch (error) {
      this.warn(error, "memory.findMemory");
      return null;
    }
  }

  private async readMemories(
    entries: readonly BatchEntry[],
    input: TranslateBatchInput,
    serviceId: string,
  ): Promise<Array<string | null>> {
    if (this.memory?.findMemories === undefined) {
      return Promise.all(
        entries.map((entry) =>
          this.readMemory(
            entry.sourceHash,
            { text: entry.text, from: input.from, to: input.to },
            serviceId,
          ),
        ),
      );
    }
    try {
      const memories = await this.memory.findMemories(
        entries.map((entry) => ({
          sourceHash: entry.sourceHash,
          fromLang: input.from,
          toLang: input.to,
          serviceId,
        })),
      );
      const byKey = new Map(
        memories.map((memory) => [
          `${memory.sourceHash}|${memory.fromLang}|${memory.toLang}|${memory.serviceId}`,
          memory.targetText,
        ]),
      );
      return entries.map(
        (entry) =>
          byKey.get(
            `${entry.sourceHash}|${input.from}|${input.to}|${serviceId}`,
          ) ?? null,
      );
    } catch (error) {
      this.warn(error, "memory.findMemories");
      return entries.map(() => null);
    }
  }

  private async bumpMemoryHit(
    sourceHash: string,
    input: TranslateInput,
    serviceId: string,
  ): Promise<void> {
    if (this.memory === undefined) return;
    try {
      await this.memory.incrementMemoryHit(
        sourceHash,
        input.from,
        input.to,
        serviceId,
      );
    } catch (error) {
      this.warn(error, "memory.incrementMemoryHit");
    }
  }

  private async writeMemory(
    sourceHash: string,
    input: TranslateInput,
    serviceId: string,
    targetText: string,
  ): Promise<void> {
    if (this.memory === undefined) return;
    try {
      await this.memory.saveMemory({
        sourceHash,
        sourceText: input.text,
        targetText,
        fromLang: input.from,
        toLang: input.to,
        serviceId,
      });
    } catch (error) {
      this.warn(error, "memory.saveMemory");
    }
  }

  private async callUpstream(input: TranslateInput): Promise<string> {
    const results = await this.upstream.translate({
      texts: [input.text],
      from: input.from,
      to: input.to,
    });
    const first = results[0];
    if (first === undefined) {
      throw new Error("上游翻译服务未返回译文。");
    }
    return first;
  }

  private async record(entry: RequestLogEntry): Promise<void> {
    if (this.memory === undefined) return;
    try {
      await this.memory.recordRequest({
        requestId: entry.requestId,
        sourceHash: entry.sourceHash,
        fromLang: entry.fromLang,
        toLang: entry.toLang,
        cacheLayer: entry.cacheLayer,
        latencyMs: entry.latencyMs,
        status: entry.status,
        ...(entry.errorCode !== undefined
          ? { errorCode: entry.errorCode }
          : {}),
      });
    } catch (error) {
      this.warn(error, "memory.recordRequest");
    }
  }

  private warn(error: unknown, context: string): void {
    this.onError?.(error, context);
  }
}

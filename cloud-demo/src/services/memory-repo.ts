import type { Database } from "./db.ts";

export type CacheLayer = "redis" | "rds" | "upstream" | "disabled";
export type RequestStatus = "success" | "error";

export interface TranslationMemory {
  id: number;
  sourceHash: string;
  sourceText: string;
  targetText: string;
  fromLang: string;
  toLang: string;
  serviceId: string;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveMemoryInput {
  sourceHash: string;
  sourceText: string;
  targetText: string;
  fromLang: string;
  toLang: string;
  serviceId: string;
}

export interface FindMemoryInput {
  sourceHash: string;
  fromLang: string;
  toLang: string;
  serviceId: string;
}

export interface RecordRequestInput {
  requestId: string;
  sourceHash: string;
  fromLang: string;
  toLang: string;
  cacheLayer: CacheLayer;
  latencyMs: number;
  status: RequestStatus;
  errorCode?: string;
}

export interface TranslationRequestRecord {
  id: number;
  requestId: string;
  sourceHash: string;
  fromLang: string;
  toLang: string;
  cacheLayer: CacheLayer;
  latencyMs: number;
  status: RequestStatus;
  errorCode: string | null;
  createdAt: string;
}

export interface MemoryStats {
  totalMemory: number;
  totalHits: number;
  totalRequests: number;
  redisHits: number;
  rdsHits: number;
  upstreamRequests: number;
}

interface MemoryRow {
  id: string | number;
  source_hash: string;
  source_text: string;
  target_text: string;
  from_lang: string;
  to_lang: string;
  service_id: string;
  hit_count: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RequestRow {
  id: string | number;
  request_id: string;
  source_hash: string;
  from_lang: string;
  to_lang: string;
  cache_layer: CacheLayer;
  latency_ms: string | number;
  status: RequestStatus;
  error_code: string | null;
  created_at: Date | string;
}

interface StatsRow {
  total_memory: string | number;
  total_hits: string | number;
  total_requests: string | number;
  redis_hits: string | number;
  rds_hits: string | number;
  upstream_requests: string | number;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function mapMemory(row: MemoryRow): TranslationMemory {
  return {
    id: toNumber(row.id),
    sourceHash: row.source_hash,
    sourceText: row.source_text,
    targetText: row.target_text,
    fromLang: row.from_lang,
    toLang: row.to_lang,
    serviceId: row.service_id,
    hitCount: toNumber(row.hit_count),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapRequest(row: RequestRow): TranslationRequestRecord {
  return {
    id: toNumber(row.id),
    requestId: row.request_id,
    sourceHash: row.source_hash,
    fromLang: row.from_lang,
    toLang: row.to_lang,
    cacheLayer: row.cache_layer,
    latencyMs: toNumber(row.latency_ms),
    status: row.status,
    errorCode: row.error_code,
    createdAt: toIsoString(row.created_at),
  };
}

export class PostgresMemoryRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  async findMemory(
    sourceHash: string,
    fromLang: string,
    toLang: string,
    serviceId: string,
  ): Promise<TranslationMemory | null> {
    const result = await this.database.query<MemoryRow>(
      `SELECT id, source_hash, source_text, target_text, from_lang, to_lang,
              service_id, hit_count, created_at, updated_at
         FROM translation_memory
        WHERE source_hash = $1
          AND from_lang = $2
          AND to_lang = $3
          AND service_id = $4
        LIMIT 1`,
      [sourceHash, fromLang, toLang, serviceId],
    );
    const row = result.rows[0];
    return row ? mapMemory(row) : null;
  }

  async findMemories(
    inputs: readonly FindMemoryInput[],
  ): Promise<TranslationMemory[]> {
    if (inputs.length === 0) return [];
    const values: string[] = [];
    const placeholders = inputs.map((input, index) => {
      const offset = index * 4;
      values.push(
        input.sourceHash,
        input.fromLang,
        input.toLang,
        input.serviceId,
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
    });
    const result = await this.database.query<MemoryRow>(
      `SELECT id, source_hash, source_text, target_text, from_lang, to_lang,
              service_id, hit_count, created_at, updated_at
         FROM translation_memory
        WHERE (source_hash, from_lang, to_lang, service_id)
              IN (${placeholders.join(", ")})`,
      values,
    );
    return result.rows.map(mapMemory);
  }

  async saveMemory(input: SaveMemoryInput): Promise<TranslationMemory> {
    const result = await this.database.query<MemoryRow>(
      `INSERT INTO translation_memory (
         source_hash, source_text, target_text, from_lang, to_lang, service_id
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_hash, from_lang, to_lang, service_id)
       DO UPDATE SET
         source_text = EXCLUDED.source_text,
         target_text = EXCLUDED.target_text,
         updated_at = NOW()
       RETURNING id, source_hash, source_text, target_text, from_lang, to_lang,
                 service_id, hit_count, created_at, updated_at`,
      [
        input.sourceHash,
        input.sourceText,
        input.targetText,
        input.fromLang,
        input.toLang,
        input.serviceId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("RDS did not return the saved translation memory");
    return mapMemory(row);
  }

  async incrementMemoryHit(
    sourceHash: string,
    fromLang: string,
    toLang: string,
    serviceId: string,
  ): Promise<void> {
    await this.database.query(
      `UPDATE translation_memory
          SET hit_count = hit_count + 1,
              updated_at = NOW()
        WHERE source_hash = $1
          AND from_lang = $2
          AND to_lang = $3
          AND service_id = $4`,
      [sourceHash, fromLang, toLang, serviceId],
    );
  }

  async recordRequest(input: RecordRequestInput): Promise<void> {
    await this.database.query(
      `INSERT INTO translation_requests (
         request_id, source_hash, from_lang, to_lang, cache_layer,
         latency_ms, status, error_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.requestId,
        input.sourceHash,
        input.fromLang,
        input.toLang,
        input.cacheLayer,
        input.latencyMs,
        input.status,
        input.errorCode ?? null,
      ],
    );
  }

  async listRequests(limit = 20): Promise<TranslationRequestRecord[]> {
    const result = await this.database.query<RequestRow>(
      `SELECT id, request_id, source_hash, from_lang, to_lang, cache_layer,
              latency_ms, status, error_code, created_at
         FROM translation_requests
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapRequest);
  }

  async listMemory(limit = 20): Promise<TranslationMemory[]> {
    const result = await this.database.query<MemoryRow>(
      `SELECT id, source_hash, source_text, target_text, from_lang, to_lang,
              service_id, hit_count, created_at, updated_at
         FROM translation_memory
        ORDER BY updated_at DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapMemory);
  }

  async getStats(): Promise<MemoryStats> {
    const result = await this.database.query<StatsRow>(
      `SELECT
         (SELECT COUNT(*) FROM translation_memory) AS total_memory,
         (SELECT COALESCE(SUM(hit_count), 0) FROM translation_memory) AS total_hits,
         (SELECT COUNT(*) FROM translation_requests) AS total_requests,
         (SELECT COUNT(*) FROM translation_requests WHERE cache_layer = 'redis') AS redis_hits,
         (SELECT COUNT(*) FROM translation_requests WHERE cache_layer = 'rds') AS rds_hits,
         (SELECT COUNT(*) FROM translation_requests WHERE cache_layer = 'upstream') AS upstream_requests`,
    );
    const row = result.rows[0];
    if (!row) {
      return {
        totalMemory: 0,
        totalHits: 0,
        totalRequests: 0,
        redisHits: 0,
        rdsHits: 0,
        upstreamRequests: 0,
      };
    }
    return {
      totalMemory: toNumber(row.total_memory),
      totalHits: toNumber(row.total_hits),
      totalRequests: toNumber(row.total_requests),
      redisHits: toNumber(row.redis_hits),
      rdsHits: toNumber(row.rds_hits),
      upstreamRequests: toNumber(row.upstream_requests),
    };
  }
}

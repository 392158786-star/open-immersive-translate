CREATE TABLE IF NOT EXISTS translation_memory (
  id BIGSERIAL PRIMARY KEY,
  source_hash TEXT NOT NULL,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  from_lang TEXT NOT NULL,
  to_lang TEXT NOT NULL,
  service_id TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT translation_memory_unique_lookup
    UNIQUE (source_hash, from_lang, to_lang, service_id)
);

CREATE TABLE IF NOT EXISTS translation_requests (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  from_lang TEXT NOT NULL,
  to_lang TEXT NOT NULL,
  cache_layer TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT translation_requests_cache_layer_check
    CHECK (cache_layer IN ('redis', 'rds', 'upstream', 'disabled')),
  CONSTRAINT translation_requests_status_check
    CHECK (status IN ('success', 'error'))
);

CREATE INDEX IF NOT EXISTS translation_requests_created_at_idx
  ON translation_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS translation_requests_source_hash_idx
  ON translation_requests (source_hash);

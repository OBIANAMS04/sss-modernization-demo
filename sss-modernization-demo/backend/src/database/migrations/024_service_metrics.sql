-- 024_service_metrics.sql
-- STORY-027: what the service measures about itself, kept in PostgreSQL so the Observability page needs no outside tool.
-- Nothing here holds a person: routes are templates ("GET /api/cases/:id"), never raw paths, ids or query strings.

-- One row per route template per minute. hist is the count of requests in each duration bucket (the bounds are in
-- observability/histogram.ts), so any window's percentile can be computed by adding the rows' counts; the p50/p95/p99 columns are that
-- minute's own figures, from its sorted samples.
CREATE TABLE IF NOT EXISTS route_metrics_minute (
  minute TIMESTAMPTZ NOT NULL,
  route VARCHAR(160) NOT NULL,
  requests INTEGER NOT NULL,
  errors_4xx INTEGER NOT NULL DEFAULT 0,
  errors_5xx INTEGER NOT NULL DEFAULT 0,
  total_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  p50_ms REAL,
  p95_ms REAL,
  p99_ms REAL,
  max_ms REAL,
  hist INTEGER[] NOT NULL,
  PRIMARY KEY (minute, route)
);
CREATE INDEX IF NOT EXISTS idx_route_metrics_route ON route_metrics_minute(route, minute DESC);

-- Database query time and connection pool use, per minute. pool_in_use_max is the most connections checked out at once.
CREATE TABLE IF NOT EXISTS db_metrics_minute (
  minute TIMESTAMPTZ PRIMARY KEY,
  queries INTEGER NOT NULL,
  failed INTEGER NOT NULL DEFAULT 0,
  total_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  p50_ms REAL,
  p95_ms REAL,
  max_ms REAL,
  hist INTEGER[] NOT NULL,
  pool_size INTEGER,
  pool_in_use_max INTEGER,
  pool_waiting_max INTEGER
);

-- Responses with a status of 500 or more: where, when, and the trace id to find the trace and the log lines. error_name and error_code
-- are the class of the error and its database code (never its message, which can echo a value a person typed).
CREATE TABLE IF NOT EXISTS server_errors (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  route VARCHAR(160) NOT NULL,
  status SMALLINT NOT NULL,
  trace_id VARCHAR(32),
  duration_ms REAL,
  error_name VARCHAR(80),
  error_code VARCHAR(40)
);
CREATE INDEX IF NOT EXISTS idx_server_errors_at ON server_errors(at DESC);

-- AI usage on every model call: tokens as the API reports them and an estimated cost (aiPricing.ts). ai_calls is how many calls the
-- row paid for (0 when the question was answered without the model). A run of the evaluation or fairness set adds up all its calls.
ALTER TABLE assistant_interactions
  ADD COLUMN IF NOT EXISTS ai_calls SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0;
ALTER TABLE assistant_eval_runs
  ADD COLUMN IF NOT EXISTS ai_calls INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_interactions_ai_day ON assistant_interactions(created_at) WHERE ai_calls > 0;

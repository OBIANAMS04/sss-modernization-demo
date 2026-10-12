-- 014_data_freshness.sql
-- STORY-009: every tracked write records how long until its change was readable on a separate
-- read, the way the next API request sees it. latency_ms is that total; write_ms and visible_ms
-- split it into the write itself and the wait until the new row version was visible. visible is
-- false when the change never showed up within the give-up time.
ALTER TABLE latency_metrics ADD COLUMN IF NOT EXISTS write_ms INTEGER;
ALTER TABLE latency_metrics ADD COLUMN IF NOT EXISTS visible_ms INTEGER;
ALTER TABLE latency_metrics ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT TRUE;

-- Rows the end-to-end check writes and reads back. Nothing else uses this table.
CREATE TABLE IF NOT EXISTS freshness_probes (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

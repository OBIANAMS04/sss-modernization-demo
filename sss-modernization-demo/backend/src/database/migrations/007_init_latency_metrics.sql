-- 007_init_latency_metrics.sql
CREATE TABLE IF NOT EXISTS latency_metrics (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL, -- users, exemptions, cases, etc.
  operation VARCHAR(50) NOT NULL, -- create, update, delete
  latency_ms INTEGER NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_latency_entity_type ON latency_metrics(entity_type);
CREATE INDEX IF NOT EXISTS idx_latency_operation ON latency_metrics(operation);
CREATE INDEX IF NOT EXISTS idx_latency_timestamp ON latency_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_latency_entity_operation ON latency_metrics(entity_type, operation, timestamp);

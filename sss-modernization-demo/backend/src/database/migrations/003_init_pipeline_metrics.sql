-- 003_init_pipeline_metrics.sql
CREATE TABLE IF NOT EXISTS pipeline_metrics (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  latency_ms INTEGER NOT NULL,
  data_age_ms INTEGER NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_user_id ON pipeline_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_timestamp ON pipeline_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_event_type ON pipeline_metrics(event_type);

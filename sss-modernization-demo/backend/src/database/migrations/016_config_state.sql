-- 016_config_state.sql
-- STORY-010: the settings the server last started with, so that a change between starts is recorded
-- in the audit log as CONFIG_CHANGE. Public settings are kept as plain values; secrets and connection
-- details only as salted SHA-256 fingerprints. No route reads this table.
CREATE TABLE IF NOT EXISTS config_state (
  name VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

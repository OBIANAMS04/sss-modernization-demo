-- 008_init_audit_logs.sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action VARCHAR(50) NOT NULL, -- USER_LOGIN, USER_LOGOUT, CASE_CREATED, CASE_UPDATED, etc.
  actor UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email VARCHAR(255),
  resource VARCHAR(100), -- auth, users, cases, exemptions, etc.
  resource_id VARCHAR(100),
  status VARCHAR(20) NOT NULL, -- success, failure
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Immutable: no UPDATE allowed, only SELECT and INSERT
  CONSTRAINT audit_logs_immutable CHECK (true)
);

-- Write-once semantics: no UPDATE clause allowed
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_actor_timestamp ON audit_logs(actor, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_logs(status);

-- Read-only view for querying
CREATE OR REPLACE VIEW audit_logs_readonly AS
SELECT id, action, actor, actor_email, resource, resource_id, status,
       details, ip_address, user_agent, timestamp
FROM audit_logs;

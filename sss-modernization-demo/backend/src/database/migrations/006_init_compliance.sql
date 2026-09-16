-- 006_init_compliance.sql
CREATE TABLE IF NOT EXISTS compliance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id VARCHAR(100) NOT NULL, -- FAR code (e.g., FAR 52.209-2)
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  control_name VARCHAR(255) NOT NULL,
  passed BOOLEAN NOT NULL,
  evidence TEXT,
  checked_by VARCHAR(255),
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compliance_dashboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  total_decisions INTEGER DEFAULT 0,
  compliant_decisions INTEGER DEFAULT 0,
  compliance_rate DECIMAL(5, 2) DEFAULT 0.00,
  alerts TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_dashboard_date ON compliance_dashboard(date);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_requirement ON compliance_checks(requirement_id);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_case_id ON compliance_checks(case_id);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_user_id ON compliance_checks(user_id);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_checked_at ON compliance_checks(checked_at);

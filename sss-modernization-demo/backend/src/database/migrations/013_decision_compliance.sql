-- 013_decision_compliance.sql
-- STORY-008: every exemption decision (Approved/Denied) is evaluated against the decision
-- controls when it is made. Each control result is one compliance_checks row linked to the
-- decision event; any failure opens a compliance review that another case manager resolves.

ALTER TABLE compliance_checks ADD COLUMN IF NOT EXISTS control_id VARCHAR(20);
ALTER TABLE compliance_checks ADD COLUMN IF NOT EXISTS decision VARCHAR(20);
ALTER TABLE compliance_checks ADD COLUMN IF NOT EXISTS decision_event_id UUID REFERENCES case_events(id) ON DELETE CASCADE;
ALTER TABLE compliance_checks ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE compliance_checks ADD COLUMN IF NOT EXISTS decided_by_email VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_event ON compliance_checks(decision_event_id);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_control ON compliance_checks(control_id);

CREATE TABLE IF NOT EXISTS compliance_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  decision_event_id UUID REFERENCES case_events(id) ON DELETE CASCADE,
  decision VARCHAR(20),
  decided_by_email VARCHAR(255),
  failed_controls TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'Open', -- Open, Resolved
  resolution VARCHAR(40),                     -- Exception accepted, Case reopened
  resolution_note TEXT,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_by_email VARCHAR(255),
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_compliance_reviews_status ON compliance_reviews(status);
CREATE INDEX IF NOT EXISTS idx_compliance_reviews_case ON compliance_reviews(case_id);

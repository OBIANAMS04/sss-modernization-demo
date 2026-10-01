-- 012_case_workflow.sql
-- STORY-007: case timeline, in-app notifications, and one case per exemption.

-- Every change to a case (creation, status change, assignment, note, document).
-- Citizens see status changes and documents on their timeline; staff see everything.
CREATE TABLE IF NOT EXISTS case_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL, -- created, status_change, assigned, note, document
  from_status VARCHAR(50),
  to_status VARCHAR(50),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email VARCHAR(255),
  detail TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_case_events_case_id ON case_events(case_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- An exemption is applied for once; a denial is appealed on the same case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_exemption_unique ON cases(exemption_id) WHERE exemption_id IS NOT NULL;

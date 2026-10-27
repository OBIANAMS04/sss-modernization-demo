-- 028_training.sql (STORY-035)
-- Every knowledge-check attempt in the staff training portal. The answers are graded on the server; the row keeps the score and
-- the module version, so a module whose content changes (a new version) must be passed again.
CREATE TABLE IF NOT EXISTS training_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id VARCHAR(50) NOT NULL,
  module_version INTEGER NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  passed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_attempts_user_module ON training_attempts (user_id, module_id, created_at DESC);

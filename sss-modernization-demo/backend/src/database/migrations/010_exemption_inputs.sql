-- 010_exemption_inputs.sql
-- STORY-006: Type B (income) and Type C (hardship) exemptions need these on
-- the user's profile. Both are optional; NULL income means "not provided".
ALTER TABLE users ADD COLUMN IF NOT EXISTS annual_income INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_documented_hardship BOOLEAN NOT NULL DEFAULT FALSE;

-- One determination row per user per exemption type, updated in place on each
-- check, so cases.exemption_id links stay valid across re-checks.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exemptions_user_type ON exemptions(user_id, exemption_type);

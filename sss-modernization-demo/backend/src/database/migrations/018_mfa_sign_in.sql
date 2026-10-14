-- 018_mfa_sign_in.sql
-- STORY-003: two-step verification when signing in.
--  * last_used_step is the time step of the last code accepted for a device. A code is never accepted twice
--    (RFC 6238 section 5.2): only a later step passes.
--  * A person has at most one verified authenticator; an unverified one is a setup not yet confirmed.
--  * mfa_code_attempts counts the codes checked for one pending sign-in (or one signed-in session, for turning
--    two-step verification on or off), so five wrong codes end it. A try is counted before the code is checked,
--    so guesses sent in parallel cannot slip past the limit.
--  * completed_at marks a pending sign-in that has given its session: the same pending token is refused after that,
--    even with a later right code.
ALTER TABLE mfa_devices ADD COLUMN IF NOT EXISTS last_used_step BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_one_verified ON mfa_devices(user_id) WHERE verified;

CREATE TABLE IF NOT EXISTS mfa_code_attempts (
  budget VARCHAR(120) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mfa_code_attempts_created_at ON mfa_code_attempts(created_at);

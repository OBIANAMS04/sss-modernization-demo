-- 027_security_hardening.sql (STORY-041)

-- Counters for sign-in and registration throttling, one row per key (an account or an address) and window. Kept in the
-- database, not in memory, so the limits hold across instances and restarts.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);

-- Sessions ended by signing out. A session is one sign-in (its id is in every token of it, extended ones included), so signing
-- out ends every token of that sign-in at once. A row is needed only until the longest session could have ended.
CREATE TABLE IF NOT EXISTS revoked_sessions (
  sid UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires ON revoked_sessions (expires_at);

-- One-time recovery codes for two-step verification, for a person who has lost their authenticator. Only a SHA-256 hash of each
-- code is kept (the codes carry 80 random bits, so the hash cannot be reversed by guessing); each works once.
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, code_hash)
);

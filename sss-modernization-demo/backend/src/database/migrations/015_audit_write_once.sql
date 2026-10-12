-- 015_audit_write_once.sql
-- STORY-010: audit entries are write-once, enforced by the database. The original
-- "CONSTRAINT audit_logs_immutable CHECK (true)" enforced nothing.
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_immutable;

-- Removing a user must never rewrite audit history (the old foreign key set actor to NULL on
-- delete). The actor's id and email stay on each entry as recorded.
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_fkey;

-- Kept for at least 7 years; the date is visible on every entry. Added before the triggers
-- below, because adding a stored column rewrites existing rows.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS retain_until TIMESTAMP
  GENERATED ALWAYS AS (timestamp + INTERVAL '7 years') STORED;

CREATE OR REPLACE FUNCTION audit_logs_refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update_delete ON audit_logs;
CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_refuse_change();

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_refuse_change();

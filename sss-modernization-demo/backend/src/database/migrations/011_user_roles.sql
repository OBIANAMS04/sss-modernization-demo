-- 011_user_roles.sql
-- Staff roles gate case management and the reporting/admin endpoints. Everyone is a
-- citizen by default; case managers are granted from the CASE_MANAGER_EMAILS
-- environment variable (see services/roleService.ts).
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(30) NOT NULL DEFAULT 'citizen';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('citizen', 'case_manager', 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

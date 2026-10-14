-- 017_leadership_role.sql
-- STORY-015: leadership (directors) read aggregate dashboards only: no case work and no personal data.
-- Roles are now citizen, case_manager, leadership and admin (011 allowed the first, second and last).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('citizen', 'case_manager', 'leadership', 'admin'));

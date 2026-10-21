-- 026_load_indexes.sql (STORY-033)
-- Found by running the dashboards and the case list against 100,000 cases and 100,000 applicants (docs/evidence/r3-load/README.md).
-- Each index replaces a scan of a whole table; the numbers are measured on that data set.

-- The admin dashboard counts each case manager's open cases with lower(assigned_to) = lower(email); the plain index on assigned_to
-- cannot serve that comparison, so each of the ~40 staff rows read every case with the status (633 ms -> 23 ms).
CREATE INDEX IF NOT EXISTS idx_cases_assigned_lower_status ON cases (lower(assigned_to), status);

-- The staff list sorts every case by last update and shows 25: it sorted all of them (115 ms -> 0.4 ms).
CREATE INDEX IF NOT EXISTS idx_cases_updated_at ON cases (updated_at DESC);

-- Staff Access finds a person by lower(email) = lower($1), which read every user (22 ms -> 0.2 ms).
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

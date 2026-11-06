-- SSS Modernization Platform - Performance Index Creation Script
-- These indexes are designed to optimize common query patterns
-- Execute after analyzing slow query logs

-- ===== SECTION 1: Common Query Optimization Indexes =====

-- 1. Cases table - frequent filters
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_user_id ON cases(user_id);
CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_user_status ON cases(user_id, status);

-- 2. Case notes - association lookups
CREATE INDEX IF NOT EXISTS idx_case_notes_case_id ON case_notes(case_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_user_id ON case_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_created_at ON case_notes(created_at DESC);

-- 3. Exemptions - user lookups
CREATE INDEX IF NOT EXISTS idx_exemptions_user_id ON exemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_exemptions_status ON exemptions(status);

-- 4. Audit logs - critical for compliance queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- 5. Compliance checks - compliance query filtering
CREATE INDEX IF NOT EXISTS idx_compliance_case_id ON compliance_checks(case_id);
CREATE INDEX IF NOT EXISTS idx_compliance_user_id ON compliance_checks(user_id);

-- 6. Latency metrics - time-series data queries
CREATE INDEX IF NOT EXISTS idx_latency_timestamp ON latency_metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_latency_entity ON latency_metrics(entity_type, operation);

-- ===== SECTION 2: Composite Indexes (for JOINs and filtering) =====

-- Optimize common case queries with multiple filters
CREATE INDEX IF NOT EXISTS idx_cases_user_status_time
ON cases(user_id, status, created_at DESC);

-- Optimize audit log queries with multiple conditions
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_timestamp
ON audit_logs(resource, resource_id, timestamp DESC);

-- Optimize exemption lookups
CREATE INDEX IF NOT EXISTS idx_exemptions_user_status
ON exemptions(user_id, status);

-- ===== SECTION 3: Partial Indexes (for common WHERE clauses) =====

-- Index active cases only (most queries filter by status)
CREATE INDEX IF NOT EXISTS idx_cases_active
ON cases(user_id, created_at DESC)
WHERE status NOT IN ('Approved', 'Denied');

-- Index recent audit logs only (common for compliance)
CREATE INDEX IF NOT EXISTS idx_audit_logs_recent
ON audit_logs(timestamp DESC)
WHERE timestamp > NOW() - INTERVAL '90 days';

-- Index pending exemptions
CREATE INDEX IF NOT EXISTS idx_exemptions_pending
ON exemptions(user_id)
WHERE status = 'Pending Review';

-- ===== SECTION 4: Covering Indexes (for Index-Only Scans) =====

-- Include commonly selected columns to avoid table lookups
CREATE INDEX IF NOT EXISTS idx_cases_full_scan
ON cases(user_id, status)
INCLUDE (id, created_at, type);

-- Compliance checks with common fields
CREATE INDEX IF NOT EXISTS idx_compliance_full_scan
ON compliance_checks(case_id)
INCLUDE (status, requirement_name, timestamp);

-- ===== SECTION 5: Analyze Index Impact =====

-- After creating indexes, run ANALYZE to update statistics
ANALYZE;

-- ===== SECTION 6: Monitor Index Usage =====

-- Query to check index usage (run after indexes are created)
-- Indexes with idx_scan = 0 can be considered for removal
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;

-- Query to identify missing indexes based on sequential scans
-- If seq_scan is high relative to idx_scan, consider adding an index
SELECT
  schemaname,
  tablename,
  seq_scan,
  seq_tup_read,
  idx_scan,
  (seq_tup_read - idx_tup_read) as potential_index_gain
FROM pg_stat_user_tables
WHERE seq_scan > 0 AND seq_tup_read > idx_tup_read
ORDER BY seq_tup_read DESC;

-- ===== SECTION 7: Index Maintenance =====

-- Rebuild fragmented indexes (run if fragmentation > 20%)
-- REINDEX INDEX CONCURRENTLY idx_cases_status;
-- REINDEX INDEX CONCURRENTLY idx_audit_logs_timestamp;

-- Analyze table to update statistics (run after large data loads)
-- ANALYZE cases;
-- ANALYZE audit_logs;
-- ANALYZE exemptions;

-- ===== SECTION 8: Query Performance Verification =====

-- EXPLAIN ANALYZE queries to verify index usage:

-- Query: Fetch user's cases by status
-- EXPLAIN ANALYZE
-- SELECT * FROM cases
-- WHERE user_id = 'uuid' AND status = 'Draft'
-- ORDER BY created_at DESC;

-- Query: Fetch recent audit logs for compliance
-- EXPLAIN ANALYZE
-- SELECT * FROM audit_logs
-- WHERE resource = 'cases' AND timestamp > NOW() - INTERVAL '30 days'
-- ORDER BY timestamp DESC
-- LIMIT 100;

-- Query: Check exemption eligibility
-- EXPLAIN ANALYZE
-- SELECT * FROM exemptions
-- WHERE user_id = 'uuid' AND status = 'Eligible'
-- ORDER BY created_at DESC
-- LIMIT 1;

-- ===== SECTION 9: Performance Tuning Parameters =====

-- These can be set in PostgreSQL configuration or via ALTER SYSTEM

-- Improve performance for analytical queries
-- ALTER SYSTEM SET work_mem = '256MB';

-- Enable query parallelization
-- ALTER SYSTEM SET max_parallel_workers_per_gather = 4;

-- Optimize planner
-- ALTER SYSTEM SET random_page_cost = 1.1;  -- For SSD storage
-- ALTER SYSTEM SET effective_cache_size = '4GB';

-- Connection settings
-- ALTER SYSTEM SET shared_buffers = '2GB';
-- ALTER SYSTEM SET max_connections = 200;

-- Then reload configuration:
-- SELECT pg_reload_conf();

-- ===== SECTION 10: Performance Monitoring Queries =====

-- Cache hit ratio (should be > 99%)
SELECT
  sum(heap_blks_read) as disk_reads,
  sum(heap_blks_hit) as cache_hits,
  round(100.0 * sum(heap_blks_hit) /
    (sum(heap_blks_hit) + sum(heap_blks_read)), 2) as cache_hit_ratio
FROM pg_statio_user_tables;

-- Slow queries (queries taking > 1000ms)
SELECT
  query,
  calls,
  total_time,
  mean_time,
  max_time
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat%' AND mean_time > 1000
ORDER BY mean_time DESC;

-- Table bloat (can be reduced with VACUUM)
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  round(100 * pg_total_relation_size(schemaname||'.'||tablename) /
    (SELECT pg_total_relation_size('pg_database'))::numeric, 2) as percent
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Connection utilization
SELECT
  datname,
  count(*) as connections,
  max_conn
FROM pg_stat_activity
JOIN (SELECT setting::int as max_conn FROM pg_settings WHERE name = 'max_connections') ON true
GROUP BY datname, max_conn
ORDER BY connections DESC;

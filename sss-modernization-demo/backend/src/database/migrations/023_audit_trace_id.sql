-- 023_audit_trace_id.sql
-- STORY-026: an audit entry records the trace id of the request that caused it (the id on the response's X-Request-Id and traceparent
-- headers and on that request's log lines), so an entry, a log line and a trace can be found from one another.
-- A new column on an append-only table: the write-once triggers (migration 015) refuse UPDATE and DELETE, and adding a nullable column
-- changes no existing row. Entries written before this migration, and entries not caused by a request (the start of the server), have none.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS trace_id VARCHAR(32);
CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit_logs(trace_id) WHERE trace_id IS NOT NULL;

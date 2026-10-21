-- 025_slo_alerts.sql
-- STORY-029: service level objective alerts use the alert table of STORY-021 (one open alert per kind and key until it clears) instead of a
-- second one. kind 'slo' alerts are keyed "<objective>:<window>", for example "latency:1h". Migration 022 is not edited: it may already have run.
ALTER TABLE assistant_quality_alerts DROP CONSTRAINT IF EXISTS assistant_quality_alerts_kind_check;
ALTER TABLE assistant_quality_alerts ADD CONSTRAINT assistant_quality_alerts_kind_check CHECK (kind IN ('signal', 'eval', 'fairness', 'slo'));

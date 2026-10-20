-- 022_ai_quality.sql
-- STORY-021 and 025: what drift detection and fairness testing keep. Migration 020 and 021 are not edited: they may already have run.

-- One row per run of the golden set (kind 'eval', STORY-021) or of the counterfactual question set (kind 'fairness', STORY-025), started
-- by an administrator and run on the server through the same retrieval and answer path as a real question.
--   status          running (started, not finished), completed, or failed (the run itself broke; the questions that the model could not
--                   answer are not a failure of the run, they are scored)
--   model           the model as the API reported it (null when nothing was generated); corpus_version is the policy documents' version
--   mode            ai (the real model), stub (the test double) or passages-only (nothing generated: only retrieval is scored)
--   the four scores retrieval hit rate, fact accuracy, citation validity and grounded rate, 0 to 1; null when they do not apply.
--                   A fairness run leaves them null and keeps its figures in `summary`.
--   results         one entry per question (or per variant of a question for a fairness run); never the answer of a withheld question
--   passed          whether every enforced threshold (eval) or criterion (fairness) was met
--   is_baseline     the run later runs are compared with; at most one per kind and mode
CREATE TABLE IF NOT EXISTS assistant_eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(10) NOT NULL DEFAULT 'eval' CHECK (kind IN ('eval', 'fairness')),
  status VARCHAR(10) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  model VARCHAR(100),
  corpus_version VARCHAR(20),
  mode VARCHAR(20) CHECK (mode IN ('ai', 'stub', 'passages-only')),
  retrieval_hit_rate NUMERIC(5, 4),
  fact_accuracy NUMERIC(5, 4),
  citation_validity NUMERIC(5, 4),
  grounded_rate NUMERIC(5, 4),
  passed BOOLEAN,
  summary JSONB,
  results JSONB,
  error TEXT,
  started_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_by_email VARCHAR(255),
  is_baseline BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_eval_runs_kind_time ON assistant_eval_runs(kind, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_runs_baseline ON assistant_eval_runs(kind, mode) WHERE is_baseline;

-- A change of model (as the API reports it) or of the policy documents' version, noticed when it happened. Shown on the trend.
CREATE TABLE IF NOT EXISTS assistant_change_markers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('model', 'corpus')),
  from_value VARCHAR(100),
  to_value VARCHAR(100) NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_change_markers_kind_time ON assistant_change_markers(kind, at DESC);

-- Drift alerts. One is open per (kind, key) until the thing that raised it clears, so a lasting drift alerts once.
--   kind 'signal' (a daily quality signal drifted; key = the signal), 'eval' (the latest golden-set run), 'fairness' (the latest counterfactual run)
CREATE TABLE IF NOT EXISTS assistant_quality_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('signal', 'eval', 'fairness')),
  key VARCHAR(60) NOT NULL,
  message TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_alerts_open ON assistant_quality_alerts(kind, key) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quality_alerts_time ON assistant_quality_alerts(opened_at DESC);

-- 020_policy_assistant.sql
-- STORY-017 and STORY-018: the policy assistant answers only from synthetic demo policy documents (backend/policy-docs), and
-- every exchange is stored so it can be monitored (STORY-022) and reviewed by a person (STORY-023).

-- The documents, split into passages at their headings. The id is stable (<document>:<heading>), so a stored answer keeps
-- pointing at the same section after the documents are re-ingested. All passages of one document share its content hash
-- (version): the startup ingestion compares it with the file and replaces the document's passages only when it differs.
CREATE TABLE IF NOT EXISTS policy_passages (
  id TEXT PRIMARY KEY,
  doc_slug VARCHAR(100) NOT NULL,
  doc_title VARCHAR(255) NOT NULL,
  heading VARCHAR(255) NOT NULL,
  position INTEGER NOT NULL,
  body TEXT NOT NULL,
  version CHAR(64) NOT NULL,
  -- When passages are ranked against a question the heading counts most, then the text; the document title, which every passage
  -- of a document shares, counts least
  search TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', heading), 'A') ||
    setweight(to_tsvector('english', body), 'B') ||
    setweight(to_tsvector('english', doc_title), 'D')
  ) STORED,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_policy_passages_search ON policy_passages USING GIN (search);
CREATE INDEX IF NOT EXISTS idx_policy_passages_doc ON policy_passages(doc_slug, position);

-- One row per question asked. The row is written when the question is accepted (status 'pending', which also counts it against
-- the person's hourly limit and the daily cap) and completed when the answer is ready.
--   question_redacted  the question with SSN-shaped text removed; the original is never stored
--   passage_ids        the passages the assistant was given, best first
--   citations          [{ passageId, docTitle, heading, quote, version }] for the answer
--   grounding          the result of the grounding check ({ grounded, unsupported, coverage, levelReasons, ... }); when no answer was
--                      made, why not ({ fallback }); null when nothing needed saying
--   mode               ai (the model), stub (the test double) or passages-only (nothing was generated)
--   level              0 shown, 1 shown with "check with a case manager", 2 withheld for a person (STORY-023)
--   status             pending (accepted, not yet answered), shown, no-answer (the documents do not cover it), with-staff (a level 2
--                      answer waiting for a case manager) or error (the request failed after it was counted)
--   feedback           the person's rating of the answer (STORY-019)
-- The review columns are for STORY-023: who reviewed a withheld answer, what they sent the person instead, and the outcome.
CREATE TABLE IF NOT EXISTS assistant_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  trace_id UUID NOT NULL UNIQUE,
  question_redacted TEXT NOT NULL,
  passage_ids TEXT[] NOT NULL DEFAULT '{}',
  answer TEXT,
  citations JSONB NOT NULL DEFAULT '[]',
  model VARCHAR(100),
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('ai', 'stub', 'passages-only')),
  latency_ms INTEGER,
  grounding JSONB,
  level SMALLINT CHECK (level IN (0, 1, 2)),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  feedback VARCHAR(20),
  reviewer UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewer_email VARCHAR(255),
  reviewed_answer TEXT,
  reviewed_at TIMESTAMPTZ,
  review_outcome VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistant_user_time ON assistant_interactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_created ON assistant_interactions(created_at);
CREATE INDEX IF NOT EXISTS idx_assistant_with_staff ON assistant_interactions(created_at) WHERE status = 'with-staff';

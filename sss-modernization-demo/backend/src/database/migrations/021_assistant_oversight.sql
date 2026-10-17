-- 021_assistant_oversight.sql
-- STORY-019, 023 and 024: what the policy assistant's page and review queue need beyond migration 020, and what the override rate
-- needs to know about case decisions. Migration 020 is not edited: it may already have run.

-- The person's comment with their feedback (optional, up to 500 characters; SSN-shaped text removed) and when they gave it. A reported
-- problem enters the review queue at that moment, so the queue is ordered by it rather than by when the question was asked.
ALTER TABLE assistant_interactions ADD COLUMN IF NOT EXISTS feedback_comment TEXT;
ALTER TABLE assistant_interactions ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ;

-- The case manager's note with a review: the reason for approving, correcting or declining. It stays with the exchange (staff
-- only); the person is sent the reviewed answer, not the note.
ALTER TABLE assistant_interactions ADD COLUMN IF NOT EXISTS review_note TEXT;
CREATE INDEX IF NOT EXISTS idx_assistant_reviewed ON assistant_interactions(reviewed_at) WHERE review_outcome IS NOT NULL;

-- The automatic eligibility result (Eligible, Pending Review or Not Eligible) in force when a case was approved or denied. The
-- exemption row is updated in place whenever eligibility is checked again, so it cannot be read back later; the override rate
-- (STORY-024) needs the result as it stood at the moment of the decision. Null for every other event, and for decisions made
-- before this column existed (they are not counted: nothing says what the result was).
ALTER TABLE case_events ADD COLUMN IF NOT EXISTS eligibility_status VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_case_events_decisions ON case_events(created_at)
  WHERE event_type = 'status_change' AND to_status IN ('Approved', 'Denied');

import pool from '../database/connection';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { ReviewOutcome, scrubSsn } from './assistantService';
import { AuditAction, logAuditEvent } from './auditService';
import { inTransaction, notify } from './caseEvents';
import { Unsupported } from './groundingCheck';

// STORY-019 and STORY-023: what a person can say about an answer, and what a case manager does with the answers that were withheld
// or reported. A report moves the exchange to the review queue (level 2); a review approves the draft, replaces it with a corrected
// answer, or declines, and tells the person. Every step is audited, never with the question, the answer or the person's comment.
// Demonstrated on a synthetic demo deployment.

export const RATINGS = ['helpful', 'not-helpful', 'problem'] as const;
export type Rating = (typeof RATINGS)[number];
export const REVIEW_OUTCOMES: ReviewOutcome[] = ['approved', 'corrected', 'declined'];

export const FEEDBACK_COMMENT_MAX = 500;
export const REVIEW_ANSWER_MAX = 2000;
export const REVIEW_NOTE_MAX = 1000;
/** Items listed in the review queue; the count beside them says how many are waiting in all. */
export const QUEUE_LIMIT = 100;
export const RECENT_REVIEWS = 10;
/** What a person is told when the case manager declines and gives no reason of their own. */
export const DECLINE_REASON = 'Please contact a case manager directly about this question.';

const TRACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTraceId = (value: unknown): value is string => typeof value === 'string' && TRACE_ID.test(value);

/** Free text from a person: line endings made alike, spaces at the ends of lines and runs of blank lines removed, SSN-shaped text removed. */
function tidy(text: string): string {
  return scrubSsn(text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
}

// ---- STORY-019: feedback

/** The person's comment, or null when they left none. */
export function cleanComment(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new ValidationError('A comment must be text.');
  if (raw.length > FEEDBACK_COMMENT_MAX) throw new ValidationError(`A comment can be up to ${FEEDBACK_COMMENT_MAX} characters.`);
  return tidy(raw) || null;
}

export interface FeedbackResult {
  traceId: string;
  feedback: Rating;
  /** with-staff after a report: the exchange is in the review queue and its answer is withheld again. */
  status: 'shown' | 'no-answer' | 'with-staff';
  queued: boolean;
  message: string;
}

// Why an exchange cannot be rated, by its status. An answer waiting for a case manager has nothing to rate yet.
const NOT_RATEABLE: Record<string, string> = {
  'with-staff': 'A case manager is already reviewing this question, so there is nothing to rate yet.',
  reviewed: 'A case manager has already reviewed this answer.',
};

/**
 * Records the signed-in person's feedback on one of their own exchanges: helpful, not helpful, or a reported problem. A report
 * withholds the answer again and puts the exchange in the review queue at level 2. Someone else's exchange is refused (403).
 */
export async function submitFeedback(user: { id: string; email: string }, traceId: unknown, body: any): Promise<FeedbackResult> {
  if (!isTraceId(traceId)) throw new NotFoundError('Question not found');
  const rating: Rating | undefined = RATINGS.find((r) => r === body?.rating);
  if (!rating) throw new ValidationError('Choose Helpful, Not helpful or Report a problem.');
  const comment = cleanComment(body?.comment);

  const found = await pool.query('SELECT user_id, status FROM assistant_interactions WHERE trace_id = $1', [traceId]);
  if (found.rows.length === 0) throw new NotFoundError('Question not found');
  const { user_id: owner, status } = found.rows[0];
  if (owner !== user.id) throw new AppError(403, 'You can only give feedback on your own questions', 'FORBIDDEN');
  if (status !== 'shown' && status !== 'no-answer') throw new ConflictError(NOT_RATEABLE[status] ?? 'This question has no answer to rate.');

  const queued = rating === 'problem';
  // The guard on status makes a report and a review that arrive together decide it once
  const updated = await pool.query(
    `UPDATE assistant_interactions
     SET feedback = $2, feedback_comment = $3, feedback_at = NOW()${queued ? ", status = 'with-staff', level = 2" : ''}
     WHERE trace_id = $1 AND user_id = $4 AND status IN ('shown', 'no-answer')
     RETURNING status`,
    [traceId, rating, comment, user.id]
  );
  if (updated.rows.length === 0) throw new ConflictError('This question changed while you were rating it. Reload the page and try again.');

  await logAuditEvent(AuditAction.AI_FEEDBACK, 'assistant', 'success', {
    actor: user.id,
    actorEmail: user.email,
    resourceId: traceId,
    details: { traceId, rating, queued, commented: comment !== null },
  });
  return {
    traceId,
    feedback: rating,
    status: updated.rows[0].status,
    queued,
    message: queued ? 'Thank you. A case manager will review this answer and reply.' : 'Thank you for your feedback.',
  };
}

// ---- STORY-023: the review queue

export interface QueueReason {
  code: 'reported' | 'ungrounded' | 'personal-question' | 'held';
  text: string;
}

const REASON_TEXT: Record<string, string> = {
  reported: 'The person reported a problem with the answer they were shown.',
  ungrounded:
    'The draft answer failed the grounding check: a statement without a citation, a number or date that no cited passage contains, or a citation that does not hold up.',
  'personal-question': "The question is about the person's own eligibility or case. The assistant never decides those.",
};

/** Why an exchange is in the queue: a report, and the reasons its answer was withheld, from the oversight level's own reasons. Pure. */
export function queueReasons(grounding: any, feedback: string | null): QueueReason[] {
  const codes: string[] = [];
  if (feedback === 'problem') codes.push('reported');
  for (const code of grounding?.levelReasons ?? []) if (code in REASON_TEXT && !codes.includes(code)) codes.push(code);
  return codes.length > 0
    ? codes.map((code) => ({ code: code as QueueReason['code'], text: REASON_TEXT[code] }))
    : [{ code: 'held', text: 'It was held for a case manager.' }];
}

// What to tell the reviewer in place of a draft, from how the exchange was answered when there was nothing to draft from
const NO_DRAFT: [RegExp, string][] = [
  [/^off$/, 'AI answers were turned off, so no draft was made.'],
  [/^daily-cap$/, 'The daily limit for AI answers had been reached, so no draft was made.'],
  [/^unavailable/, 'The AI assistant was not available, so no draft was made.'],
  [/^declined/, 'The model could not give a reliable answer, so no draft was made.'],
  [/^(no-answer|no-passages)$/, 'The policy documents did not answer the question, so no draft was made.'],
];

export function noDraftNote(grounding: any): string {
  const fallback = typeof grounding?.fallback === 'string' ? grounding.fallback : '';
  return NO_DRAFT.find(([pattern]) => pattern.test(fallback))?.[1] ?? 'No draft answer was made.';
}

export interface QueueItem {
  traceId: string;
  /** The cleaned question: SSN-shaped text was removed when it was asked. */
  question: string;
  askedAt: string;
  /** When it entered the queue: when it was asked, or when the person reported it. The queue is oldest first by this. */
  queuedAt: string;
  askedBy: { name: string; email: string } | null;
  /** The reviewer asked it themselves, so another case manager must review it. */
  own: boolean;
  reasons: QueueReason[];
  reportComment: string | null;
  draft: {
    answer: string | null;
    /** Why there is no draft, when there is none. */
    note: string | null;
    citations: { passageId: string; docTitle: string; heading: string; quote: string }[];
    mode: string;
    model: string | null;
  };
  grounding: { grounded: boolean; coverage: number; unsupported: Unsupported[] } | null;
}

export interface ReviewedItem {
  traceId: string;
  question: string;
  outcome: ReviewOutcome;
  reviewedBy: string | null;
  reviewedAt: string;
  reported: boolean;
}

export interface ReviewQueue {
  /** Everything waiting for a case manager, which can be more than the items listed. */
  waiting: number;
  items: QueueItem[];
  recentlyReviewed: ReviewedItem[];
}

/** The exchanges waiting for a case manager, oldest first, with what a reviewer needs; and the latest reviews. Staff only (the route says so). */
export async function listReviews(reviewer: { id: string }): Promise<ReviewQueue> {
  const [queue, reviewed] = await Promise.all([
    pool.query(
      `SELECT i.trace_id, i.question_redacted, i.answer, i.citations, i.grounding, i.mode, i.model, i.feedback, i.feedback_comment,
              i.feedback_at, i.created_at, i.user_id, u.full_name, u.email, (COUNT(*) OVER ())::int AS total
       FROM assistant_interactions i
       LEFT JOIN users u ON u.id = i.user_id
       WHERE i.status = 'with-staff'
       ORDER BY COALESCE(CASE WHEN i.feedback = 'problem' THEN i.feedback_at END, i.created_at) ASC, i.id
       LIMIT $1`,
      [QUEUE_LIMIT]
    ),
    pool.query(
      `SELECT trace_id, question_redacted, review_outcome, reviewer_email, reviewed_at, feedback
       FROM assistant_interactions
       WHERE status = 'reviewed'
       ORDER BY reviewed_at DESC, id DESC
       LIMIT $1`,
      [RECENT_REVIEWS]
    ),
  ]);
  return {
    waiting: Number(queue.rows[0]?.total ?? 0),
    items: queue.rows.map((r: any): QueueItem => {
      const checked = typeof r.grounding?.grounded === 'boolean';
      return {
        traceId: r.trace_id,
        question: r.question_redacted,
        askedAt: r.created_at,
        queuedAt: r.feedback === 'problem' && r.feedback_at ? r.feedback_at : r.created_at,
        askedBy: r.user_id && r.email ? { name: r.full_name, email: r.email } : null,
        own: r.user_id === reviewer.id,
        reasons: queueReasons(r.grounding, r.feedback),
        reportComment: r.feedback === 'problem' ? r.feedback_comment ?? null : null,
        draft: {
          answer: r.answer ?? null,
          note: r.answer ? null : noDraftNote(r.grounding),
          citations: (r.citations ?? []).map(({ version, ...citation }: any) => citation),
          mode: r.mode,
          model: r.model ?? null,
        },
        grounding: checked ? { grounded: r.grounding.grounded, coverage: r.grounding.coverage, unsupported: r.grounding.unsupported ?? [] } : null,
      };
    }),
    recentlyReviewed: reviewed.rows.map((r: any) => ({
      traceId: r.trace_id,
      question: r.question_redacted,
      outcome: r.review_outcome,
      reviewedBy: r.reviewer_email ?? null,
      reviewedAt: r.reviewed_at,
      reported: r.feedback === 'problem',
    })),
  };
}

// ---- STORY-023: a review

export interface ReviewInput {
  outcome: ReviewOutcome;
  /** The corrected answer; with a decline, the reason the person is given. Never present with an approval. */
  answer: string | null;
  note: string;
}

/** Checks a reviewer's input: an outcome, a note that says why, and for a correction the answer the person will see. */
export function cleanReview(body: any): ReviewInput {
  const outcome = REVIEW_OUTCOMES.find((o) => o === body?.outcome);
  if (!outcome) throw new ValidationError('Choose an outcome: approved, corrected or declined.');

  if (body.note !== undefined && typeof body.note !== 'string') throw new ValidationError('The note must be text.');
  const note = tidy(body.note ?? '');
  if (!note) throw new ValidationError('A note is required: say why you approved, corrected or declined this answer.');
  if (note.length > REVIEW_NOTE_MAX) throw new ValidationError(`The note can be up to ${REVIEW_NOTE_MAX} characters.`);

  if (body.answer !== undefined && body.answer !== null && typeof body.answer !== 'string') throw new ValidationError('The answer must be text.');
  const answer = typeof body.answer === 'string' ? tidy(body.answer) : '';
  if (answer.length > REVIEW_ANSWER_MAX) throw new ValidationError(`The answer can be up to ${REVIEW_ANSWER_MAX} characters.`);
  if (outcome === 'approved' && answer) {
    throw new ValidationError('An approved answer is sent as it is. Choose "corrected" to change it.');
  }
  if (outcome === 'corrected' && !answer) throw new ValidationError('Write the corrected answer the person will see.');
  return { outcome, answer: answer || null, note };
}

/** The message the person gets in their notifications: their question (shortened) and the reviewed answer, or that it was declined. */
export function reviewNotification(question: string, outcome: ReviewOutcome, sent: string): string {
  const quoted = `"${question.length > 80 ? `${question.slice(0, 77)}...` : question}"`;
  return outcome === 'declined'
    ? `A case manager reviewed your policy question ${quoted} and could not answer it here. ${sent}`
    : `A case manager reviewed your policy question ${quoted} and replied: ${sent}`;
}

export interface ReviewResult {
  traceId: string;
  outcome: ReviewOutcome;
  status: 'reviewed';
  /** False only when the person's account no longer exists. */
  notified: boolean;
}

/**
 * A case manager's review of a withheld or reported exchange. The corrected answer replaces the draft; an approval sends the draft
 * as it is; a decline sends a reason. The person is notified and sees the result in their history, marked as reviewed. Nobody may
 * review a question they asked themselves (403), and an exchange is reviewed once: the row is locked, so two reviewers cannot both
 * win (409 for the second). The audit entry is written before the commit, so a review never exists without it.
 */
export async function reviewExchange(reviewer: { id: string; email: string }, traceId: unknown, body: unknown): Promise<ReviewResult> {
  if (!isTraceId(traceId)) throw new NotFoundError('Question not found');
  const review = cleanReview(body);

  return inTransaction(async (client) => {
    const found = await client.query(
      `SELECT user_id, status, answer, level, mode, feedback, question_redacted
       FROM assistant_interactions WHERE trace_id = $1 FOR UPDATE`,
      [traceId]
    );
    if (found.rows.length === 0) throw new NotFoundError('Question not found');
    const row = found.rows[0];
    if (row.user_id === reviewer.id) {
      throw new AppError(403, 'You cannot review a question you asked yourself. Another case manager will review it.', 'FORBIDDEN');
    }
    if (row.status === 'reviewed') throw new ConflictError('This question has already been reviewed.');
    if (row.status !== 'with-staff') throw new ConflictError('This question is not waiting for a review.');
    if (review.outcome === 'approved' && !row.answer?.trim()) {
      throw new ValidationError('There is no draft answer to approve. Write the answer instead, or decline.');
    }

    // What the person is sent: the draft as it is, the correction, or the reason for declining
    const sent: string = review.outcome === 'approved' ? row.answer : review.outcome === 'corrected' ? review.answer! : review.answer ?? DECLINE_REASON;
    await client.query(
      `UPDATE assistant_interactions
       SET status = 'reviewed', reviewer = $2, reviewer_email = $3, reviewed_answer = $4, reviewed_at = NOW(), review_outcome = $5, review_note = $6
       WHERE trace_id = $1`,
      [traceId, reviewer.id, reviewer.email, sent, review.outcome, review.note]
    );
    if (row.user_id) await notify(client, row.user_id, null, reviewNotification(row.question_redacted, review.outcome, sent));

    // The outcome and the note are the reviewer's; the question and the answer stay out of the log, as for AI_ANSWER
    await logAuditEvent(AuditAction.AI_REVIEW, 'assistant', 'success', {
      actor: reviewer.id,
      actorEmail: reviewer.email,
      resourceId: traceId,
      details: { traceId, outcome: review.outcome, level: row.level, mode: row.mode, reported: row.feedback === 'problem', note: review.note },
    });
    return { traceId, outcome: review.outcome, status: 'reviewed' as const, notified: Boolean(row.user_id) };
  });
}

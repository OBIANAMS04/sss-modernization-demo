// STORY-019 and STORY-023 (backend): feedback on an answer, the review queue and a case manager's review, with the database, the
// notification and the audit log mocked.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('./caseEvents', () => ({ inTransaction: jest.fn(), notify: jest.fn() }));
jest.mock('./auditService', () => ({ ...jest.requireActual('./auditService'), logAuditEvent: jest.fn() }));

import pool from '../database/connection';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import {
  DECLINE_REASON,
  FEEDBACK_COMMENT_MAX,
  QUEUE_LIMIT,
  REVIEW_ANSWER_MAX,
  REVIEW_NOTE_MAX,
  cleanComment,
  cleanReview,
  isTraceId,
  listReviews,
  noDraftNote,
  queueReasons,
  reviewExchange,
  reviewNotification,
  submitFeedback,
} from './assistantReviewService';
import { logAuditEvent } from './auditService';
import { inTransaction, notify } from './caseEvents';

const poolQuery = pool.query as unknown as jest.Mock;
const transaction = inTransaction as jest.Mock;
const notified = notify as jest.Mock;
const audit = logAuditEvent as jest.Mock;
const client = { query: jest.fn() };

const TRACE = '4bc727fb-eaad-459a-a522-4f5ecc937372';
const ASKER = 'asker-1';
const ME = { id: ASKER, email: 'asker@example.com' };
const REVIEWER = { id: 'reviewer-1', email: 'reviewer@example.com' };
const QUESTION = 'Am I eligible for the senior exemption?';
const DRAFT = 'A registrant qualifies for Type A when they are 65 years old or older.';
const text = (sql: unknown) => String(sql).replace(/\s+/g, ' ').trim();

beforeEach(() => {
  poolQuery.mockReset();
  client.query.mockReset();
  notified.mockReset();
  audit.mockReset();
  transaction.mockReset().mockImplementation(async (work: (c: typeof client) => Promise<unknown>) => work(client));
});

describe('isTraceId', () => {
  it('accepts a UUID and nothing else', () => {
    expect(isTraceId(TRACE)).toBe(true);
    for (const bad of ['', 'sample', '4bc727fb-eaad-459a-a522', `${TRACE}x`, 42, undefined, null]) expect(isTraceId(bad)).toBe(false);
  });
});

describe('cleanComment (STORY-019)', () => {
  it('is null when there is no comment, and the trimmed text when there is one', () => {
    expect(cleanComment(undefined)).toBeNull();
    expect(cleanComment(null)).toBeNull();
    expect(cleanComment('   ')).toBeNull();
    expect(cleanComment('  The age was wrong.  ')).toBe('The age was wrong.');
    expect(cleanComment('x'.repeat(FEEDBACK_COMMENT_MAX))).toHaveLength(FEEDBACK_COMMENT_MAX);
  });

  it('refuses a comment that is not text or is over 500 characters', () => {
    expect(() => cleanComment(7)).toThrow(ValidationError);
    expect(() => cleanComment('x'.repeat(FEEDBACK_COMMENT_MAX + 1))).toThrow(/up to 500 characters/);
  });

  it('removes SSN-shaped text however it is written', () => {
    expect(cleanComment('My number is 900-00-0010, or 900000010, so why?')).toBe('My number is [REDACTED], or [REDACTED], so why?');
  });
});

describe('submitFeedback (STORY-019)', () => {
  const exchange = (over: Record<string, unknown> = {}) => ({ rows: [{ user_id: ASKER, status: 'shown', ...over }] });
  const updatedTo = (status: string) => ({ rows: [{ status }] });

  it('records helpful or not helpful on the person\'s own exchange without moving it', async () => {
    poolQuery.mockResolvedValueOnce(exchange()).mockResolvedValueOnce(updatedTo('shown'));
    const result = await submitFeedback(ME, TRACE, { rating: 'not-helpful', comment: 'It missed the appeal deadline.' });
    expect(result).toEqual({ traceId: TRACE, feedback: 'not-helpful', status: 'shown', queued: false, message: 'Thank you for your feedback.' });
    const [sql, params] = poolQuery.mock.calls[1];
    expect(text(sql)).toContain('SET feedback = $2, feedback_comment = $3, feedback_at = NOW() WHERE');
    expect(text(sql)).not.toContain("status = 'with-staff'");
    expect(text(sql)).toContain("AND user_id = $4 AND status IN ('shown', 'no-answer')");
    expect(params).toEqual([TRACE, 'not-helpful', 'It missed the appeal deadline.', ASKER]);
  });

  it('sends a reported problem to the review queue at level 2, and says so', async () => {
    poolQuery.mockResolvedValueOnce(exchange({ status: 'no-answer' })).mockResolvedValueOnce(updatedTo('with-staff'));
    const result = await submitFeedback(ME, TRACE, { rating: 'problem' });
    expect(result).toEqual({
      traceId: TRACE,
      feedback: 'problem',
      status: 'with-staff',
      queued: true,
      message: 'Thank you. A case manager will review this answer and reply.',
    });
    const [sql, params] = poolQuery.mock.calls[1];
    expect(text(sql)).toContain("SET feedback = $2, feedback_comment = $3, feedback_at = NOW(), status = 'with-staff', level = 2");
    expect(params[2]).toBeNull();
  });

  it('audits it as AI_FEEDBACK with the rating and whether it was queued, never the comment', async () => {
    poolQuery.mockResolvedValueOnce(exchange()).mockResolvedValueOnce(updatedTo('with-staff'));
    await submitFeedback(ME, TRACE, { rating: 'problem', comment: 'It quoted a number the policy does not have.' });
    expect(audit).toHaveBeenCalledTimes(1);
    const [action, resource, status, options] = audit.mock.calls[0];
    expect([action, resource, status]).toEqual(['AI_FEEDBACK', 'assistant', 'success']);
    expect(options).toMatchObject({ actor: ASKER, actorEmail: ME.email, resourceId: TRACE });
    expect(options.details).toEqual({ traceId: TRACE, rating: 'problem', queued: true, commented: true });
    expect(JSON.stringify(audit.mock.calls)).not.toContain('quoted a number');
  });

  it('refuses someone else\'s exchange (403) without changing or auditing anything', async () => {
    poolQuery.mockResolvedValueOnce(exchange({ user_id: 'someone-else' }));
    const error = await submitFeedback(ME, TRACE, { rating: 'helpful' }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN', message: 'You can only give feedback on your own questions' });
    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it('refuses an exchange that does not exist, and an id that is not one, as 404', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    await expect(submitFeedback(ME, TRACE, { rating: 'helpful' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitFeedback(ME, 'not-a-trace-id', { rating: 'helpful' })).rejects.toBeInstanceOf(NotFoundError);
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it.each([['an unknown rating', { rating: 'great' }], ['none', {}], ['no body', undefined], ['a comment that is not text', { rating: 'helpful', comment: { a: 1 } }]])(
    'refuses %s (400) before reading anything',
    async (_why, body) => {
      await expect(submitFeedback(ME, TRACE, body)).rejects.toBeInstanceOf(ValidationError);
      expect(poolQuery).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['with-staff', /already reviewing this question/],
    ['reviewed', /already reviewed this answer/],
    ['pending', /no answer to rate/],
    ['error', /no answer to rate/],
  ])('refuses an exchange that is %s (409): there is nothing to rate', async (status, message) => {
    poolQuery.mockResolvedValueOnce(exchange({ status }));
    const error = await submitFeedback(ME, TRACE, { rating: 'helpful' }).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toMatch(message);
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it('says so (409) when the exchange moved on between the read and the write', async () => {
    poolQuery.mockResolvedValueOnce(exchange()).mockResolvedValueOnce({ rows: [] });
    await expect(submitFeedback(ME, TRACE, { rating: 'problem' })).rejects.toThrow(/changed while you were rating it/);
    expect(audit).not.toHaveBeenCalled();
  });

  it('removes SSN-shaped text from the comment before it is stored', async () => {
    poolQuery.mockResolvedValueOnce(exchange()).mockResolvedValueOnce(updatedTo('shown'));
    await submitFeedback(ME, TRACE, { rating: 'not-helpful', comment: 'My SSN is 900-00-0010' });
    expect(poolQuery.mock.calls[1][1][2]).toBe('My SSN is [REDACTED]');
  });
});

describe('queueReasons and noDraftNote (STORY-023)', () => {
  it('gives a reason for each way an answer is withheld, a report first', () => {
    expect(queueReasons({ levelReasons: ['ungrounded', 'personal-question'] }, null).map((r) => r.code)).toEqual(['ungrounded', 'personal-question']);
    expect(queueReasons({ levelReasons: ['ok'] }, 'problem').map((r) => r.code)).toEqual(['reported']);
    expect(queueReasons({ levelReasons: ['personal-question'] }, 'problem').map((r) => r.code)).toEqual(['reported', 'personal-question']);
    expect(queueReasons({ levelReasons: ['ungrounded'] }, 'problem')[1].text).toMatch(/failed the grounding check/);
  });

  it('does not list the reasons for a shown answer, and has a fallback for an exchange with none', () => {
    expect(queueReasons({ levelReasons: ['few-sources', 'low-coverage'] }, 'problem').map((r) => r.code)).toEqual(['reported']);
    expect(queueReasons(null, null)).toEqual([{ code: 'held', text: 'It was held for a case manager.' }]);
  });

  it('says why there is no draft', () => {
    expect(noDraftNote({ fallback: 'off' })).toMatch(/turned off/);
    expect(noDraftNote({ fallback: 'daily-cap' })).toMatch(/daily limit/);
    expect(noDraftNote({ fallback: 'unavailable:timeout' })).toMatch(/not available/);
    expect(noDraftNote({ fallback: 'declined:refusal' })).toMatch(/could not give a reliable answer/);
    expect(noDraftNote({ fallback: 'no-answer' })).toMatch(/did not answer the question/);
    expect(noDraftNote(null)).toBe('No draft answer was made.');
  });
});

describe('listReviews (STORY-023)', () => {
  const waiting = (over: Record<string, unknown> = {}) => ({
    trace_id: TRACE,
    question_redacted: QUESTION,
    answer: DRAFT,
    citations: [{ passageId: 'exemption-type-a:who-qualifies', docTitle: 'Type A', heading: 'Who qualifies', quote: DRAFT, version: 'v1' }],
    grounding: { grounded: true, coverage: 1, unsupported: [], levelReasons: ['personal-question'] },
    mode: 'stub',
    model: 'stub',
    feedback: null,
    feedback_comment: null,
    feedback_at: null,
    created_at: '2026-10-16T08:00:00.000Z',
    user_id: ASKER,
    full_name: 'Avery Lane',
    email: 'avery@example.com',
    total: 1,
    ...over,
  });

  it('lists the exchanges with a case manager, oldest in the queue first, up to the limit, and counts all of them', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [waiting()] }).mockResolvedValueOnce({ rows: [] });
    await listReviews(REVIEWER);
    const [sql, params] = poolQuery.mock.calls[0];
    expect(text(sql)).toContain("WHERE i.status = 'with-staff'");
    // A reported exchange has waited since the report, not since the question
    expect(text(sql)).toContain("ORDER BY COALESCE(CASE WHEN i.feedback = 'problem' THEN i.feedback_at END, i.created_at) ASC");
    expect(text(sql)).toContain('(COUNT(*) OVER ())::int AS total');
    expect(params).toEqual([QUEUE_LIMIT]);
  });

  it('gives the reviewer the question, the draft with its citations, the grounding result, who asked and why it was withheld', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [waiting({ total: 120 })] }).mockResolvedValueOnce({ rows: [] });
    const queue = await listReviews(REVIEWER);
    expect(queue.waiting).toBe(120);
    expect(queue.items).toEqual([
      {
        traceId: TRACE,
        question: QUESTION,
        askedAt: '2026-10-16T08:00:00.000Z',
        queuedAt: '2026-10-16T08:00:00.000Z',
        askedBy: { name: 'Avery Lane', email: 'avery@example.com' },
        own: false,
        reasons: [{ code: 'personal-question', text: expect.stringContaining('own eligibility or case') }],
        reportComment: null,
        draft: {
          answer: DRAFT,
          note: null,
          citations: [{ passageId: 'exemption-type-a:who-qualifies', docTitle: 'Type A', heading: 'Who qualifies', quote: DRAFT }],
          mode: 'stub',
          model: 'stub',
        },
        grounding: { grounded: true, coverage: 1, unsupported: [] },
      },
    ]);
  });

  it('marks the reviewer\'s own questions, and queues a reported exchange from the time of the report with the person\'s comment', async () => {
    poolQuery
      .mockResolvedValueOnce({
        rows: [waiting({ user_id: REVIEWER.id, feedback: 'problem', feedback_comment: 'The age is wrong.', feedback_at: '2026-10-16T12:00:00.000Z', grounding: { levelReasons: ['ok'], grounded: true, coverage: 1 } })],
      })
      .mockResolvedValueOnce({ rows: [] });
    const [item] = (await listReviews(REVIEWER)).items;
    expect(item).toMatchObject({ own: true, queuedAt: '2026-10-16T12:00:00.000Z', askedAt: '2026-10-16T08:00:00.000Z', reportComment: 'The age is wrong.' });
    expect(item.reasons.map((r) => r.code)).toEqual(['reported']);
  });

  it('says why there is no draft and gives no grounding result when no answer was made', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [waiting({ answer: null, citations: [], grounding: { fallback: 'off', levelReasons: ['personal-question'] } })] })
      .mockResolvedValueOnce({ rows: [] });
    const [item] = (await listReviews(REVIEWER)).items;
    expect(item.draft).toMatchObject({ answer: null, citations: [] });
    expect(item.draft.note).toMatch(/turned off/);
    expect(item.grounding).toBeNull();
  });

  it('shows the unsupported statements of an ungrounded draft to the reviewer', async () => {
    const unsupported = [{ type: 'unsupported-number', text: '45' }];
    poolQuery
      .mockResolvedValueOnce({ rows: [waiting({ grounding: { grounded: false, coverage: 0.7, unsupported, levelReasons: ['ungrounded'] } })] })
      .mockResolvedValueOnce({ rows: [] });
    const [item] = (await listReviews(REVIEWER)).items;
    expect(item.grounding).toEqual({ grounded: false, coverage: 0.7, unsupported });
    expect(item.reasons.map((r) => r.code)).toEqual(['ungrounded']);
  });

  it('is empty when nothing is waiting, and lists the latest reviews', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ trace_id: 'r1', question_redacted: 'Q?', review_outcome: 'corrected', reviewer_email: 'reviewer@example.com', reviewed_at: '2026-10-16T13:00:00.000Z', feedback: 'problem' }],
    });
    const queue = await listReviews(REVIEWER);
    expect(queue.waiting).toBe(0);
    expect(queue.items).toEqual([]);
    expect(queue.recentlyReviewed).toEqual([
      { traceId: 'r1', question: 'Q?', outcome: 'corrected', reviewedBy: 'reviewer@example.com', reviewedAt: '2026-10-16T13:00:00.000Z', reported: true },
    ]);
    expect(text(poolQuery.mock.calls[1][0])).toContain("WHERE status = 'reviewed' ORDER BY reviewed_at DESC");
  });
});

describe('cleanReview (STORY-023)', () => {
  it('takes an outcome and a note, and for a correction the answer the person will see', () => {
    expect(cleanReview({ outcome: 'approved', note: ' Matches the policy. ' })).toEqual({ outcome: 'approved', answer: null, note: 'Matches the policy.' });
    expect(cleanReview({ outcome: 'corrected', answer: ' Type A is 65 or older. ', note: 'Wrong age.' })).toEqual({ outcome: 'corrected', answer: 'Type A is 65 or older.', note: 'Wrong age.' });
    expect(cleanReview({ outcome: 'declined', note: 'Personal case.' })).toEqual({ outcome: 'declined', answer: null, note: 'Personal case.' });
    expect(cleanReview({ outcome: 'declined', answer: 'I have called you.', note: 'Personal case.' }).answer).toBe('I have called you.');
  });

  it('keeps the paragraphs of a correction and removes SSN-shaped text from everything', () => {
    const review = cleanReview({ outcome: 'corrected', answer: 'First.\r\n\r\n\r\n\r\nSecond, for 900-00-0010.', note: 'Checked 900000010.' });
    expect(review.answer).toBe('First.\n\nSecond, for [REDACTED].');
    expect(review.note).toBe('Checked [REDACTED].');
  });

  it.each([
    ['no outcome', { note: 'x' }, /Choose an outcome/],
    ['an unknown outcome', { outcome: 'escalated', note: 'x' }, /Choose an outcome/],
    ['no body', undefined, /Choose an outcome/],
    ['no note', { outcome: 'approved' }, /A note is required/],
    ['a blank note', { outcome: 'approved', note: '   ' }, /A note is required/],
    ['a note that is not text', { outcome: 'approved', note: 5 }, /note must be text/],
    ['a note over the limit', { outcome: 'approved', note: 'x'.repeat(REVIEW_NOTE_MAX + 1) }, /up to 1000 characters/],
    ['a correction with no answer', { outcome: 'corrected', note: 'x' }, /Write the corrected answer/],
    ['a correction with a blank answer', { outcome: 'corrected', answer: '  ', note: 'x' }, /Write the corrected answer/],
    ['an answer over the limit', { outcome: 'corrected', answer: 'x'.repeat(REVIEW_ANSWER_MAX + 1), note: 'x' }, /up to 2000 characters/],
    ['an answer that is not text', { outcome: 'corrected', answer: ['a'], note: 'x' }, /answer must be text/],
    ['an approval that also changes the answer', { outcome: 'approved', answer: 'Something else.', note: 'x' }, /sent as it is/],
  ])('refuses %s (400)', (_why, body, message) => {
    const error = (() => {
      try {
        cleanReview(body);
      } catch (e) {
        return e as ValidationError;
      }
    })();
    expect(error).toBeInstanceOf(ValidationError);
    expect(error!.statusCode).toBe(400);
    expect(error!.message).toMatch(message);
  });
});

describe('reviewNotification', () => {
  it('quotes the question and gives the reply, or says the question could not be answered', () => {
    expect(reviewNotification('How old?', 'corrected', 'Sixty-five.')).toBe('A case manager reviewed your policy question "How old?" and replied: Sixty-five.');
    expect(reviewNotification('How old?', 'declined', DECLINE_REASON)).toBe(`A case manager reviewed your policy question "How old?" and could not answer it here. ${DECLINE_REASON}`);
  });

  it('shortens a long question', () => {
    const message = reviewNotification('Q'.repeat(200), 'approved', 'Yes.');
    expect(message).toContain(`"${'Q'.repeat(77)}..."`);
    expect(message).not.toContain('Q'.repeat(78));
  });
});

describe('reviewExchange (STORY-023)', () => {
  const waitingRow = (over: Record<string, unknown> = {}) => ({
    user_id: ASKER,
    status: 'with-staff',
    answer: DRAFT,
    level: 2,
    mode: 'stub',
    feedback: null,
    question_redacted: QUESTION,
    ...over,
  });
  const lockedRow = (row: Record<string, unknown>) =>
    client.query.mockImplementation(async (sql: string) => (text(sql).startsWith('SELECT') ? { rows: [row] } : { rows: [] }));
  const writes = () => client.query.mock.calls.filter(([sql]) => text(sql).startsWith('UPDATE'));

  beforeEach(() => lockedRow(waitingRow()));

  it('locks the row first, so two reviewers cannot both review it', async () => {
    await reviewExchange(REVIEWER, TRACE, { outcome: 'approved', note: 'Matches the policy.' });
    expect(text(client.query.mock.calls[0][0])).toMatch(/FROM assistant_interactions WHERE trace_id = \$1 FOR UPDATE$/);
    expect(client.query.mock.calls[0][1]).toEqual([TRACE]);
  });

  it('approves the draft as it is: the person is sent it, notified, and the review is audited', async () => {
    const result = await reviewExchange(REVIEWER, TRACE, { outcome: 'approved', note: 'Matches the policy.' });
    expect(result).toEqual({ traceId: TRACE, outcome: 'approved', status: 'reviewed', notified: true });

    const [sql, params] = writes()[0];
    expect(text(sql)).toContain("SET status = 'reviewed', reviewer = $2, reviewer_email = $3, reviewed_answer = $4, reviewed_at = NOW(), review_outcome = $5, review_note = $6");
    expect(params).toEqual([TRACE, REVIEWER.id, REVIEWER.email, DRAFT, 'approved', 'Matches the policy.']);
    expect(notified).toHaveBeenCalledWith(client, ASKER, null, `A case manager reviewed your policy question "${QUESTION}" and replied: ${DRAFT}`);

    expect(audit).toHaveBeenCalledTimes(1);
    const [action, resource, status, options] = audit.mock.calls[0];
    expect([action, resource, status]).toEqual(['AI_REVIEW', 'assistant', 'success']);
    expect(options).toMatchObject({ actor: REVIEWER.id, actorEmail: REVIEWER.email, resourceId: TRACE });
    expect(options.details).toEqual({ traceId: TRACE, outcome: 'approved', level: 2, mode: 'stub', reported: false, note: 'Matches the policy.' });
  });

  it('replaces the draft with a correction: the person is sent the correction and never the draft', async () => {
    await reviewExchange(REVIEWER, TRACE, { outcome: 'corrected', answer: 'Type A is for registrants aged 65 or older.', note: 'The draft left out the age rule.' });
    expect(writes()[0][1][3]).toBe('Type A is for registrants aged 65 or older.');
    expect(writes()[0][1][4]).toBe('corrected');
    const message = notified.mock.calls[0][3];
    expect(message).toContain('and replied: Type A is for registrants aged 65 or older.');
    expect(message).not.toContain(DRAFT);
  });

  it('declines with a reason of its own or the standard one, and tells the person it could not be answered', async () => {
    await reviewExchange(REVIEWER, TRACE, { outcome: 'declined', note: 'Needs the case file.' });
    expect(writes()[0][1].slice(3)).toEqual([DECLINE_REASON, 'declined', 'Needs the case file.']);
    expect(notified.mock.calls[0][3]).toBe(`A case manager reviewed your policy question "${QUESTION}" and could not answer it here. ${DECLINE_REASON}`);

    client.query.mockClear();
    notified.mockClear();
    await reviewExchange(REVIEWER, TRACE, { outcome: 'declined', answer: 'I will call you today.', note: 'Needs the case file.' });
    expect(writes()[0][1][3]).toBe('I will call you today.');
    expect(notified.mock.calls[0][3]).toContain('could not answer it here. I will call you today.');
  });

  it('keeps the question, the draft and the correction out of the audit log, and records that a report started it', async () => {
    lockedRow(waitingRow({ feedback: 'problem' }));
    await reviewExchange(REVIEWER, TRACE, { outcome: 'corrected', answer: 'A corrected answer nobody else may read in the log.', note: 'Fixed the age.' });
    const logged = JSON.stringify(audit.mock.calls);
    expect(logged).not.toContain('senior exemption');
    expect(logged).not.toContain(DRAFT);
    expect(logged).not.toContain('nobody else may read');
    expect(audit.mock.calls[0][3].details).toMatchObject({ outcome: 'corrected', reported: true, note: 'Fixed the age.' });
  });

  it('refuses a question the reviewer asked themselves (403), changing, notifying and auditing nothing', async () => {
    lockedRow(waitingRow({ user_id: REVIEWER.id }));
    const error = await reviewExchange(REVIEWER, TRACE, { outcome: 'approved', note: 'x' }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN', message: 'You cannot review a question you asked yourself. Another case manager will review it.' });
    expect(writes()).toEqual([]);
    expect(notified).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it.each([
    ['already reviewed', 'reviewed', /already been reviewed/],
    ['shown to the person', 'shown', /not waiting for a review/],
    ['pending', 'pending', /not waiting for a review/],
  ])('refuses a question that is %s (409)', async (_why, status, message) => {
    lockedRow(waitingRow({ status }));
    const error = await reviewExchange(REVIEWER, TRACE, { outcome: 'approved', note: 'x' }).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toMatch(message);
    expect(writes()).toEqual([]);
  });

  it('refuses a question that does not exist (404), and an id that is not one before reading anything', async () => {
    client.query.mockImplementation(async () => ({ rows: [] }));
    await expect(reviewExchange(REVIEWER, TRACE, { outcome: 'approved', note: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(reviewExchange(REVIEWER, 'sample', { outcome: 'approved', note: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses invalid input before opening a transaction', async () => {
    await expect(reviewExchange(REVIEWER, TRACE, { outcome: 'approved' })).rejects.toBeInstanceOf(ValidationError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('cannot approve a question that has no draft: the reviewer writes the answer or declines', async () => {
    lockedRow(waitingRow({ answer: null }));
    await expect(reviewExchange(REVIEWER, TRACE, { outcome: 'approved', note: 'x' })).rejects.toThrow(/no draft answer to approve/);
    expect(writes()).toEqual([]);
    // A correction and a decline still work
    await expect(reviewExchange(REVIEWER, TRACE, { outcome: 'corrected', answer: 'My own answer.', note: 'x' })).resolves.toMatchObject({ outcome: 'corrected' });
    await expect(reviewExchange(REVIEWER, TRACE, { outcome: 'declined', note: 'x' })).resolves.toMatchObject({ outcome: 'declined' });
  });

  it('writes the audit entry before the transaction commits, so a review never exists without it', async () => {
    const order: string[] = [];
    client.query.mockImplementation(async (sql: string) => {
      order.push(text(sql).startsWith('UPDATE') ? 'update' : 'select');
      return { rows: text(sql).startsWith('SELECT') ? [waitingRow()] : [] };
    });
    notified.mockImplementation(async () => order.push('notify'));
    audit.mockImplementation(async () => order.push('audit'));
    transaction.mockImplementation(async (work: (c: typeof client) => Promise<unknown>) => {
      const result = await work(client);
      order.push('commit');
      return result;
    });
    await reviewExchange(REVIEWER, TRACE, { outcome: 'approved', note: 'x' });
    expect(order).toEqual(['select', 'update', 'notify', 'audit', 'commit']);
  });

  it('rolls back, with no review, when the audit entry cannot be written', async () => {
    audit.mockRejectedValue(new Error('audit down'));
    // The callback throws, so the real transaction rolls back its UPDATE and its notification
    await expect(reviewExchange(REVIEWER, TRACE, { outcome: 'approved', note: 'x' })).rejects.toThrow('audit down');
  });

  it('reviews a question whose asker no longer has an account, without a notification', async () => {
    lockedRow(waitingRow({ user_id: null }));
    expect(await reviewExchange(REVIEWER, TRACE, { outcome: 'approved', note: 'x' })).toMatchObject({ notified: false });
    expect(notified).not.toHaveBeenCalled();
  });
});

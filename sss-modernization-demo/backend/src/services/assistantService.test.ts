// STORY-018, 022 and 023 (backend): the assistant end to end, with the database, the corpus search, the audit log and the model all
// mocked. Claude is never called.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('./caseEvents', () => ({ inTransaction: jest.fn() }));
jest.mock('./policyCorpus', () => ({ searchPassages: jest.fn(), getCorpusInfo: jest.fn() }));
jest.mock('./auditService', () => ({ ...jest.requireActual('./auditService'), logAuditEvent: jest.fn() }));
jest.mock('./assistantModel', () => {
  const actual = jest.requireActual('./assistantModel');
  return { ...actual, askClaude: jest.fn(), askStub: jest.fn(actual.askStub) };
});

import pool from '../database/connection';
import { RateLimitError, ValidationError } from '../utils/errors';
import { askClaude, askStub } from './assistantModel';
import { logAuditEvent } from './auditService';
import { inTransaction } from './caseEvents';
import {
  DEFAULT_DAILY_LIMIT,
  HALLUCINATION_TARGET,
  HOURLY_LIMIT,
  NO_ANSWER_MESSAGE,
  STAFF_REPLY_MESSAGE,
  askAssistant,
  cleanQuestion,
  dailyLimit,
  getHistory,
  getQuality,
  reserveAsk,
  summariseQuality,
} from './assistantService';
import { getCorpusInfo, RetrievedPassage, searchPassages } from './policyCorpus';

const poolQuery = pool.query as unknown as jest.Mock;
const transaction = inTransaction as jest.Mock;
const search = searchPassages as jest.Mock;
const claude = askClaude as jest.Mock;
const stub = askStub as jest.Mock;
const audit = logAuditEvent as jest.Mock;
const client = { query: jest.fn() };

const passage = (id: string, body: string): RetrievedPassage => ({
  id,
  docSlug: id.split(':')[0],
  docTitle: `Title of ${id.split(':')[0]}`,
  heading: id.split(':')[1],
  position: 0,
  body,
  version: 'f'.repeat(64),
  rank: 0.5,
});
const TYPE_A = passage('exemption-type-a:who-qualifies', 'A registrant qualifies for Type A when they are 65 years old or older. Age is worked out in whole years.');
const TYPE_B = passage('exemption-type-b:who-qualifies-the-income-limit', 'A registrant qualifies for Type B when the annual income on the profile is below $20,000.');
const APPEALS = passage('appeals:how-to-appeal', 'On a Denied case, select Appeal this decision and confirm.');
const PASSAGES = [TYPE_A, TYPE_B, APPEALS];

const USER = { id: 'user-1', email: 'person@example.com' };
const GENERAL = 'How old must a registrant be for Type A?';

// What the mocked database answers, and what it was sent
let asksInHour: number;
let retryAfter: number;
let answersToday: number;
let inserted: any[][];
let updates: any[][];

const SAVED_ENV = { ...process.env };
function setEnv(env: Record<string, string | undefined>) {
  for (const name of ['AI_PROVIDER', 'AI_MODEL', 'AI_DAILY_LIMIT', 'ANTHROPIC_API_KEY']) delete process.env[name];
  Object.assign(process.env, env);
}

beforeEach(() => {
  asksInHour = 0;
  retryAfter = 1800;
  answersToday = 0;
  inserted = [];
  updates = [];
  setEnv({ AI_PROVIDER: 'stub' });
  search.mockReset().mockResolvedValue(PASSAGES);
  claude.mockReset();
  stub.mockClear();
  audit.mockReset();
  (getCorpusInfo as jest.Mock).mockReset().mockResolvedValue({ documents: 8, passages: 43, version: 'abc123abc123', ingestedAt: '2026-10-15T10:00:00.000Z' });
  transaction.mockReset().mockImplementation(async (work: (c: typeof client) => Promise<unknown>) => work(client));
  client.query.mockReset().mockImplementation(async (sql: string, params: any[] = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (text.includes('COUNT(*)::int AS asks')) return { rows: [{ asks: asksInHour, retry_after: retryAfter }] };
    if (text.includes('COUNT(*)::int AS answers')) return { rows: [{ answers: answersToday }] };
    if (text.startsWith('INSERT INTO assistant_interactions')) {
      inserted.push(params);
      return { rows: [] };
    }
    throw new Error(`unexpected statement in the reservation: ${text}`);
  });
  poolQuery.mockReset().mockImplementation(async (sql: string, params: any[] = []) => {
    if (String(sql).trim().startsWith('UPDATE assistant_interactions')) {
      updates.push([sql, ...params]);
      return { rows: [] };
    }
    throw new Error(`unexpected statement: ${sql}`);
  });
});
afterAll(() => {
  setEnv({});
  Object.assign(process.env, SAVED_ENV);
});

/** The columns the final UPDATE wrote: passage_ids, answer, citations, model, mode, latency_ms, grounding, level, status. */
const stored = () => {
  const [, traceId, passageIds, answer, citations, model, mode, latencyMs, grounding, level, status] = updates[0];
  return { traceId, passageIds, answer, citations: JSON.parse(citations), model, mode, latencyMs, grounding: grounding ? JSON.parse(grounding) : null, level, status };
};

describe('cleanQuestion (STORY-018)', () => {
  it('accepts a question of 3 to 500 characters, trimmed and with spaces collapsed', () => {
    expect(cleanQuestion('  How   old\n must I be?  ')).toEqual({ question: 'How old must I be?', redacted: false });
    expect(cleanQuestion('Why').question).toBe('Why');
    expect(cleanQuestion('x'.repeat(500)).question).toHaveLength(500);
  });

  it.each([
    ['too short', 'Hi'],
    ['empty', '   '],
    ['too long', 'x'.repeat(501)],
    ['a number', 12345],
    ['missing', undefined],
    ['an object', { text: 'How old?' }],
  ])('refuses a question that is %s, with a 400 that does not echo it', (_why, question) => {
    expect(() => cleanQuestion(question)).toThrow(ValidationError);
    try {
      cleanQuestion(question);
    } catch (error) {
      expect((error as ValidationError).statusCode).toBe(400);
      expect((error as ValidationError).message).not.toContain('xxxxx');
    }
  });

  it('removes SSN-shaped text however it is written, and says it did', () => {
    const cases = [
      '900-00-0010',
      '900 00 0010',
      '900–00–0010',
      '900000010',
    ];
    for (const ssn of cases) {
      const cleaned = cleanQuestion(`My number is ${ssn} so how old must I be?`);
      expect(cleaned).toEqual({ question: 'My number is [REDACTED] so how old must I be?', redacted: true });
    }
    expect(cleanQuestion('A: 900-00-0010 B: 123-45-6789 What is Type A?').question).toBe('A: [REDACTED] B: [REDACTED] What is Type A?');
  });

  it('leaves amounts, dates and ten-digit numbers alone', () => {
    const question = 'Is $20,000 the limit on 2026-10-15, case 5550123456, CTRL-04?';
    expect(cleanQuestion(question)).toEqual({ question, redacted: false });
  });

  it('refuses a question that is nothing but a Social Security number', () => {
    expect(() => cleanQuestion('900-00-0010')).toThrow(/ask your question in words/i);
    expect(() => cleanQuestion('123456789 987654321')).toThrow(ValidationError);
  });
});

describe('dailyLimit', () => {
  it('is AI_DAILY_LIMIT, or 300 when it is missing or not a whole number of zero or more', () => {
    expect(DEFAULT_DAILY_LIMIT).toBe(300);
    expect(dailyLimit({})).toBe(300);
    expect(dailyLimit({ AI_DAILY_LIMIT: '25' })).toBe(25);
    expect(dailyLimit({ AI_DAILY_LIMIT: '0' })).toBe(0);
    for (const bad of ['', 'many', '-5', 'NaN']) expect(dailyLimit({ AI_DAILY_LIMIT: bad })).toBe(300);
  });
});

describe('reserveAsk: the hourly limit and the daily cap (STORY-018)', () => {
  it('counts under one lock and records the question as pending in the same transaction', async () => {
    const reservation = await reserveAsk('user-1', 'How old?', { AI_PROVIDER: 'stub' });
    expect(reservation).toMatchObject({ mode: 'stub', why: null });
    expect(reservation.traceId).toMatch(/^[0-9a-f-]{36}$/);
    const steps = client.query.mock.calls.map(([sql]) => {
      const text = String(sql);
      return /pg_advisory_xact_lock/.test(text) ? 'lock' : /AS asks/.test(text) ? 'count the hour' : /AS answers/.test(text) ? 'count the day' : /^\s*INSERT/.test(text) ? 'insert' : 'other';
    });
    expect(steps).toEqual(['lock', 'count the hour', 'count the day', 'insert']);
    expect(inserted).toEqual([['user-1', reservation.traceId, 'How old?', 'stub']]);
  });

  it(`refuses a question over the limit of ${HOURLY_LIMIT} an hour with a 429, a clear message and how long to wait, and records nothing`, async () => {
    asksInHour = HOURLY_LIMIT;
    retryAfter = 1800;
    const error = await reserveAsk('user-1', 'How old?', { AI_PROVIDER: 'stub' }).catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED', retryAfterSeconds: 1800 });
    expect(error.message).toBe('You have reached the limit of 20 questions per hour. Please try again in about 30 minutes.');
    expect(inserted).toEqual([]);
  });

  it('lets the 20th question through and counts only the last hour of this person', async () => {
    asksInHour = HOURLY_LIMIT - 1;
    await expect(reserveAsk('user-1', 'How old?', { AI_PROVIDER: 'stub' })).resolves.toMatchObject({ mode: 'stub' });
    const [sql, params] = client.query.mock.calls.find(([s]) => String(s).includes('AS asks'))!;
    expect(String(sql)).toContain("WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'");
    expect(params).toEqual(['user-1']);
  });

  it('says "a minute" for a short wait', async () => {
    asksInHour = HOURLY_LIMIT;
    retryAfter = 20;
    await expect(reserveAsk('u', 'How old?', { AI_PROVIDER: 'stub' })).rejects.toThrow('Please try again in a minute.');
  });

  it('falls back to the passages alone once today\'s cap is used up, but still takes the question', async () => {
    answersToday = 5;
    const reservation = await reserveAsk('user-1', 'How old?', { AI_PROVIDER: 'stub', AI_DAILY_LIMIT: '5' });
    expect(reservation).toMatchObject({ mode: 'passages-only', why: 'daily-cap' });
    expect(inserted[0][3]).toBe('passages-only'); // so it does not count toward the cap itself
  });

  it('stays in AI mode one below the cap, with the cap from AI_DAILY_LIMIT and 300 by default', async () => {
    answersToday = 4;
    expect(await reserveAsk('u', 'q?', { AI_PROVIDER: 'stub', AI_DAILY_LIMIT: '5' })).toMatchObject({ mode: 'stub' });
    answersToday = 299;
    expect(await reserveAsk('u', 'q?', { ANTHROPIC_API_KEY: 'sk-test' })).toMatchObject({ mode: 'ai' });
    answersToday = 300;
    expect(await reserveAsk('u', 'q?', { ANTHROPIC_API_KEY: 'sk-test' })).toMatchObject({ mode: 'passages-only', why: 'daily-cap' });
  });

  it('counts the answers generated today (UTC) by anyone, in AI or stub mode, and not the passages-only ones', async () => {
    await reserveAsk('u', 'q?', { AI_PROVIDER: 'stub' });
    const [sql] = client.query.mock.calls.find(([s]) => String(s).includes('AS answers'))!;
    const text = String(sql).replace(/\s+/g, ' ');
    expect(text).toContain("mode IN ('ai', 'stub')");
    expect(text).toContain("date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'");
    expect(text).not.toContain('user_id');
  });

  it('does not look at the cap when AI is off, and says why', async () => {
    const reservation = await reserveAsk('u', 'q?', {});
    expect(reservation).toMatchObject({ mode: 'passages-only', why: 'off' });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('AS answers'))).toBe(false);
  });
});

describe('askAssistant: an answer from the stand-in model', () => {
  it('answers a general question, cited to the retrieved passages, stores it and audits it without the question', async () => {
    const response = await askAssistant(USER, GENERAL);

    expect(response).toMatchObject({ mode: 'stub', status: 'shown', level: 0, questionRedacted: false });
    expect(response.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.answer).toContain('65 years old or older');
    expect(response.citations.length).toBeGreaterThanOrEqual(2);
    const retrievedIds = PASSAGES.map((p) => p.id);
    expect(response.retrieved.map((r) => r.passageId)).toEqual(retrievedIds);
    for (const citation of response.citations) {
      expect(retrievedIds).toContain(citation.passageId);
      expect(PASSAGES.find((p) => p.id === citation.passageId)!.body).toContain(citation.quote);
      expect(citation).toEqual({ passageId: citation.passageId, docTitle: expect.any(String), heading: expect.any(String), quote: expect.any(String) });
    }
    expect(response.grounding).toEqual({ grounded: true, coverage: 1, unsupported: [] });
    expect(response.passages).toBeUndefined();

    expect(stored()).toMatchObject({
      traceId: response.traceId,
      passageIds: retrievedIds,
      answer: response.answer,
      model: 'stub',
      mode: 'stub',
      level: 0,
      status: 'shown',
      grounding: { grounded: true, coverage: 1, unsupported: [], levelReasons: ['ok'] },
    });
    expect(stored().citations[0]).toMatchObject({ passageId: TYPE_A.id, version: 'f'.repeat(64) });
    expect(stored().latencyMs).toBeGreaterThanOrEqual(0);

    expect(audit).toHaveBeenCalledTimes(1);
    const [action, resource, status, options] = audit.mock.calls[0];
    expect([action, resource, status]).toEqual(['AI_ANSWER', 'assistant', 'success']);
    expect(options).toMatchObject({ actor: 'user-1', actorEmail: 'person@example.com', resourceId: response.traceId });
    expect(options.details).toEqual({
      traceId: response.traceId,
      mode: 'stub',
      status: 'shown',
      level: 0,
      passageIds: retrievedIds,
      citedPassageIds: [TYPE_A.id, TYPE_B.id],
      grounded: true,
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain('How old must a registrant');
  });

  it('shows an answer that cites one passage at level 1', async () => {
    search.mockResolvedValue([TYPE_A]);
    const response = await askAssistant(USER, GENERAL);
    expect(response).toMatchObject({ status: 'shown', level: 1 });
    expect(stored().grounding.levelReasons).toEqual(['few-sources']);
  });

  it('withholds the answer to a question about the person\'s own eligibility (level 2), keeping it for the review', async () => {
    const response = await askAssistant(USER, 'Am I eligible for the senior exemption?');
    expect(response).toMatchObject({ mode: 'stub', status: 'with-staff', level: 2, answer: null, citations: [], message: STAFF_REPLY_MESSAGE });
    expect(response.grounding).toEqual({ grounded: true, coverage: 1 }); // whether it was grounded, not what it said
    expect(JSON.stringify(response)).not.toContain('65 years old');
    expect(stored()).toMatchObject({ status: 'with-staff', level: 2, grounding: { levelReasons: ['personal-question'] } });
    expect(stored().answer).toContain('65 years old or older'); // kept for the case manager
    expect(stored().citations.length).toBeGreaterThan(0);
    expect(audit.mock.calls[0][3].details).toMatchObject({ status: 'with-staff', level: 2 });
  });

  it('withholds an ungrounded answer (level 2), counts it as a failure, and audits it as one', async () => {
    const response = await askAssistant(USER, `${GENERAL} stub-ungrounded`);
    expect(response).toMatchObject({ status: 'with-staff', level: 2, answer: null, message: STAFF_REPLY_MESSAGE });
    expect(response.grounding).toEqual({ grounded: false, coverage: expect.any(Number) });
    expect(JSON.stringify(response)).not.toContain('45 days'); // nothing of the withheld answer reaches the person
    expect(stored().grounding).toMatchObject({ grounded: false, levelReasons: ['ungrounded'] });
    expect(stored().grounding.unsupported.map((u: any) => u.type).sort()).toEqual(['uncited-sentence', 'unsupported-number']);
    expect(audit.mock.calls[0][2]).toBe('failure');
    expect(audit.mock.calls[0][3].details.grounded).toBe(false);
  });

  it('says there is no answer when nothing matched, without asking the model', async () => {
    search.mockResolvedValue([]);
    const response = await askAssistant(USER, 'What is the weather today?');
    expect(response).toMatchObject({ status: 'no-answer', level: 1, answer: null, citations: [], retrieved: [], message: NO_ANSWER_MESSAGE, grounding: null });
    expect(stub).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ status: 'no-answer', mode: 'passages-only', answer: null });
  });

  it('sends a personal question that matched nothing to a case manager', async () => {
    search.mockResolvedValue([]);
    expect(await askAssistant(USER, 'Am I eligible for a passport?')).toMatchObject({ status: 'with-staff', level: 2, message: STAFF_REPLY_MESSAGE });
  });

  it('falls back to the passages when the model is unavailable, and records why', async () => {
    const response = await askAssistant(USER, `${GENERAL} stub-unavailable`);
    expect(response).toMatchObject({ mode: 'passages-only', status: 'shown', level: 0, answer: null });
    expect(response.message).toContain('not available right now');
    expect(response.passages).toHaveLength(3);
    expect(stored()).toMatchObject({ mode: 'passages-only', grounding: { fallback: 'unavailable:stub' } }); // a failed call does not use up the cap
  });
});

describe('askAssistant: nothing personal reaches the model, the store or the log', () => {
  it('removes SSN-shaped text before the search, the model, the store and the audit log', async () => {
    const response = await askAssistant(USER, 'My number is 900-00-0010, also 123456789 and 123 45 6789. How old must a registrant be for Type A?');
    expect(response.questionRedacted).toBe(true);
    const clean = 'My number is [REDACTED], also [REDACTED] and [REDACTED]. How old must a registrant be for Type A?';
    expect(search).toHaveBeenCalledWith(clean);
    expect(stub).toHaveBeenCalledWith(clean, PASSAGES);
    expect(inserted[0][2]).toBe(clean);
    const everything = JSON.stringify([search.mock.calls, stub.mock.calls, inserted, updates, audit.mock.calls, response]);
    for (const ssn of ['900-00-0010', '900-00', '123456789', '123 45 6789', '123-45']) expect(everything).not.toContain(ssn);
  });

  it('never calls the model for a question that is refused', async () => {
    await expect(askAssistant(USER, 'ok')).rejects.toThrow(ValidationError);
    await expect(askAssistant(USER, '900-00-0010')).rejects.toThrow(ValidationError);
    expect(search).not.toHaveBeenCalled();
    expect(stub).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it('does not search, ask or store when the person is over the limit', async () => {
    asksInHour = HOURLY_LIMIT;
    await expect(askAssistant(USER, GENERAL)).rejects.toBeInstanceOf(RateLimitError);
    expect(search).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('askAssistant: AI off, the daily cap, and the real model path', () => {
  it('returns the policy passages with a plain note when there is no key, and does not ask a model', async () => {
    setEnv({});
    const response = await askAssistant(USER, GENERAL);
    expect(response).toMatchObject({ mode: 'passages-only', status: 'shown', level: 0, answer: null, citations: [], grounding: null });
    expect(response.message).toBe('AI answers are turned off in this demo, so here are the most relevant policy passages instead.');
    expect(response.passages?.map((p) => [p.passageId, p.text])).toEqual(PASSAGES.map((p) => [p.id, p.body]));
    expect(stub).not.toHaveBeenCalled();
    expect(claude).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ mode: 'passages-only', status: 'shown', grounding: { fallback: 'off' }, model: null });
    expect(audit.mock.calls[0][3].details).toMatchObject({ mode: 'passages-only', grounded: null, fallback: 'off' });
  });

  it('is off too with AI_PROVIDER=off, whatever key is set', async () => {
    setEnv({ AI_PROVIDER: 'off', ANTHROPIC_API_KEY: 'sk-test' });
    expect((await askAssistant(USER, GENERAL)).mode).toBe('passages-only');
    expect(claude).not.toHaveBeenCalled();
  });

  it('sends a personal question to a case manager even with AI off', async () => {
    setEnv({});
    expect(await askAssistant(USER, 'Will I be approved?')).toMatchObject({ mode: 'passages-only', status: 'with-staff', level: 2, answer: null, message: STAFF_REPLY_MESSAGE });
  });

  it('falls back to the passages with a note about the daily limit once the cap is reached', async () => {
    setEnv({ AI_PROVIDER: 'stub', AI_DAILY_LIMIT: '2' });
    answersToday = 2;
    const response = await askAssistant(USER, GENERAL);
    expect(response).toMatchObject({ mode: 'passages-only', status: 'shown', answer: null });
    expect(response.message).toContain('daily limit for AI answers has been reached');
    expect(stub).not.toHaveBeenCalled();
    expect(stored().grounding).toEqual({ fallback: 'daily-cap' });
  });

  describe('with a key, the answer comes from Claude and is checked like any other', () => {
    beforeEach(() => setEnv({ ANTHROPIC_API_KEY: 'sk-test' }));
    const quoteA = 'A registrant qualifies for Type A when they are 65 years old or older.';
    const quoteB = 'A registrant qualifies for Type B when the annual income on the profile is below $20,000.';

    it('shows a grounded answer from two passages at level 0, recording the model that served it', async () => {
      claude.mockResolvedValue({
        type: 'answer',
        model: 'claude-opus-5-5',
        segments: [
          { text: 'Type A is for registrants of 65 or older', citations: [{ passageId: TYPE_A.id, quote: quoteA }] },
          { text: '. ', citations: [] },
          { text: 'Type B is for an income below $20,000', citations: [{ passageId: TYPE_B.id, quote: quoteB }] },
          { text: '.', citations: [] },
        ],
      });
      const response = await askAssistant(USER, GENERAL);
      expect(claude).toHaveBeenCalledWith(GENERAL, PASSAGES);
      expect(response).toMatchObject({ mode: 'ai', status: 'shown', level: 0, answer: 'Type A is for registrants of 65 or older. Type B is for an income below $20,000.' });
      expect(response.citations.map((c) => c.passageId)).toEqual([TYPE_A.id, TYPE_B.id]);
      expect(stored()).toMatchObject({ model: 'claude-opus-5-5', mode: 'ai' });
    });

    it('withholds an answer that cites a passage which was not retrieved', async () => {
      claude.mockResolvedValue({
        type: 'answer',
        model: 'claude-opus-5-5',
        segments: [{ text: 'Type A is for registrants of 65 or older.', citations: [{ passageId: 'made-up:passage', quote: quoteA }] }],
      });
      const response = await askAssistant(USER, GENERAL);
      expect(response).toMatchObject({ status: 'with-staff', level: 2, answer: null, citations: [] });
      expect(stored().grounding.unsupported.map((u: any) => u.type)).toContain('invalid-citation');
    });

    it('shows the passages instead when the model refuses, and keeps the mode: the call was made', async () => {
      claude.mockResolvedValue({ type: 'declined', model: 'claude-opus-5-5', reason: 'refusal', detail: 'cyber' });
      const response = await askAssistant(USER, GENERAL);
      expect(response).toMatchObject({ mode: 'ai', status: 'shown', answer: null });
      expect(response.message).toContain('could not give a reliable answer');
      expect(response.passages).toHaveLength(3);
      expect(stored()).toMatchObject({ mode: 'ai', model: 'claude-opus-5-5', grounding: { fallback: 'declined:refusal' } });
    });

    it('shows the passages instead when the call fails, and it does not use up the daily cap', async () => {
      claude.mockResolvedValue({ type: 'unavailable', reason: 'timeout' });
      const response = await askAssistant(USER, GENERAL);
      expect(response).toMatchObject({ mode: 'passages-only', status: 'shown', answer: null });
      expect(response.message).toContain('not available right now');
      expect(stored()).toMatchObject({ mode: 'passages-only', grounding: { fallback: 'unavailable:timeout' } });
      expect(audit.mock.calls[0][3].details.fallback).toBe('unavailable:timeout');
    });

    it('says there is no answer when the model says the documents do not cover it', async () => {
      claude.mockResolvedValue({ type: 'no-answer', model: 'claude-opus-5-5' });
      const response = await askAssistant(USER, GENERAL);
      expect(response).toMatchObject({ mode: 'ai', status: 'no-answer', level: 1, answer: null, message: NO_ANSWER_MESSAGE });
      expect(response.grounding).toBeNull(); // not an answer, so not a hallucination
    });
  });

  it('marks the exchange failed and rethrows when something breaks after it was counted', async () => {
    search.mockRejectedValue(new Error('database down'));
    poolQuery.mockReset().mockResolvedValue({ rows: [] });
    await expect(askAssistant(USER, GENERAL)).rejects.toThrow('database down');
    const [sql, params] = poolQuery.mock.calls[0];
    expect(String(sql)).toContain("SET status = 'error'");
    expect(params).toEqual([inserted[0][1]]);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('getHistory', () => {
  const row = (over: Record<string, unknown>) => ({
    trace_id: 't1',
    question_redacted: 'How old?',
    mode: 'stub',
    status: 'shown',
    level: 0,
    answer: 'Sixty-five.',
    citations: [{ passageId: 'a:b', docTitle: 'A', heading: 'B', quote: 'q', version: 'v' }],
    feedback: null,
    created_at: '2026-10-15T10:00:00.000Z',
    ...over,
  });

  it('reads only the caller\'s own last 20 finished exchanges', async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    await getHistory('user-1');
    const [sql, params] = poolQuery.mock.calls[0];
    const text = String(sql).replace(/\s+/g, ' ');
    expect(text).toContain('WHERE user_id = $1');
    expect(text).toContain("status IN ('shown', 'no-answer', 'with-staff', 'reviewed')");
    expect(text).toContain('ORDER BY created_at DESC');
    expect(params).toEqual(['user-1', 20]);
  });

  it('shows an answer with its citations, minus the internal version, and never a withheld answer', async () => {
    poolQuery.mockResolvedValue({
      rows: [
        row({}),
        row({ trace_id: 't2', status: 'with-staff', level: 2, answer: 'A draft that must stay hidden' }),
        row({ trace_id: 't3', status: 'no-answer', level: 1, answer: null, citations: [] }),
      ],
    });
    const history = await getHistory('user-1');
    expect(history[0]).toEqual({
      traceId: 't1',
      question: 'How old?',
      mode: 'stub',
      status: 'shown',
      level: 0,
      answer: 'Sixty-five.',
      citations: [{ passageId: 'a:b', docTitle: 'A', heading: 'B', quote: 'q' }],
      feedback: null,
      createdAt: '2026-10-15T10:00:00.000Z',
    });
    expect(history[1]).toMatchObject({ traceId: 't2', answer: null, citations: [], message: STAFF_REPLY_MESSAGE });
    expect(history[2]).toMatchObject({ traceId: 't3', message: NO_ANSWER_MESSAGE });
    expect(JSON.stringify(history)).not.toContain('must stay hidden');
  });

  // STORY-023: after a case manager has reviewed an exchange the person sees the reviewed answer, marked as reviewed, never the draft
  describe('reviewed exchanges', () => {
    const REVIEWED_AT = '2026-10-16T09:30:00.000Z';
    const reviewedRow = (outcome: string, reviewedAnswer: string | null) =>
      row({ trace_id: `r-${outcome}`, status: 'reviewed', level: 2, answer: 'The withheld draft', review_outcome: outcome, reviewed_answer: reviewedAnswer, reviewed_at: REVIEWED_AT });

    it('shows an approved draft with its citations, and a correction with none, both marked as reviewed', async () => {
      poolQuery.mockResolvedValue({ rows: [reviewedRow('approved', 'The withheld draft'), reviewedRow('corrected', 'The case manager\'s own words.')] });
      const [approved, corrected] = await getHistory('user-1');
      expect(approved).toMatchObject({ traceId: 'r-approved', status: 'reviewed', answer: 'The withheld draft', reviewed: { outcome: 'approved', at: REVIEWED_AT } });
      expect(approved.citations).toEqual([{ passageId: 'a:b', docTitle: 'A', heading: 'B', quote: 'q' }]);
      expect(corrected).toMatchObject({ status: 'reviewed', answer: 'The case manager\'s own words.', citations: [], reviewed: { outcome: 'corrected' } });
      expect(corrected.message).toBeUndefined();
    });

    it('shows a declined question with the case manager\'s reason as a message and no answer', async () => {
      poolQuery.mockResolvedValue({ rows: [reviewedRow('declined', 'Please contact a case manager directly about this question.')] });
      const [declined] = await getHistory('user-1');
      expect(declined).toMatchObject({
        status: 'reviewed',
        answer: null,
        citations: [],
        message: 'A case manager reviewed this question and could not answer it here. Please contact a case manager directly about this question.',
        reviewed: { outcome: 'declined' },
      });
      expect(JSON.stringify(declined)).not.toContain('The withheld draft');
    });

    it('never shows the draft of an exchange that is still with a case manager, and a report does not bring it back', async () => {
      poolQuery.mockResolvedValue({ rows: [row({ status: 'with-staff', level: 2, answer: 'The withheld draft', feedback: 'problem' })] });
      const [waiting] = await getHistory('user-1');
      expect(waiting).toMatchObject({ status: 'with-staff', answer: null, citations: [], message: STAFF_REPLY_MESSAGE, feedback: 'problem' });
      expect(waiting.reviewed).toBeUndefined();
      expect(JSON.stringify(waiting)).not.toContain('The withheld draft');
    });
  });

  // With AI off the history still says which sections the question matched, so they can be opened again
  it('lists the sections an exchange answered with the passages alone matched, in order, with their titles', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [row({ mode: 'passages-only', answer: null, citations: [], passage_ids: ['b:two', 'a:one', 'gone:missing'] })] })
      .mockResolvedValueOnce({ rows: [{ id: 'a:one', doc_title: 'Doc A', heading: 'One' }, { id: 'b:two', doc_title: 'Doc B', heading: 'Two' }] });
    const [item] = await getHistory('user-1');
    expect(item.sections).toEqual([
      { passageId: 'b:two', docTitle: 'Doc B', heading: 'Two' },
      { passageId: 'a:one', docTitle: 'Doc A', heading: 'One' },
    ]);
    expect(poolQuery.mock.calls[1][1]).toEqual([['b:two', 'a:one', 'gone:missing']]);
  });

  it('reads no section titles when no exchange was answered with the passages alone', async () => {
    poolQuery.mockResolvedValue({ rows: [row({})] });
    const [item] = await getHistory('user-1');
    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(item.sections).toBeUndefined();
  });
});

describe('summariseQuality (STORY-022)', () => {
  const windows = (a7: number, u7: number, a30: number, u30: number) => [
    { days: 7, answers: a7, ungrounded: u7 },
    { days: 30, answers: a30, ungrounded: u30 },
  ];

  it('gives the rate of answers that failed the check, in percent', () => {
    const summary = summariseQuality(windows(200, 2, 800, 4));
    expect(summary.windows).toEqual([
      { days: 7, answers: 200, ungrounded: 2, rate: 1 },
      { days: 30, answers: 800, ungrounded: 4, rate: 0.5 },
    ]);
    expect(summary.alert).toBe(false);
    expect(summary.alertMessage).toBeNull();
  });

  it('raises the alert at the 2% target, not below it', () => {
    expect(HALLUCINATION_TARGET).toBe(2);
    expect(summariseQuality(windows(100, 1, 100, 1)).alert).toBe(false);
    expect(summariseQuality(windows(1000, 19, 1000, 19)).alert).toBe(false); // 1.9%
    expect(summariseQuality(windows(100, 2, 100, 0)).alert).toBe(true); // 2.00%
  });

  it('names the window that is over the target, with the counts', () => {
    const summary = summariseQuality(windows(50, 3, 400, 4));
    expect(summary.alert).toBe(true);
    expect(summary.alertMessage).toBe('3 of 50 answers in the last 7 days failed the grounding check (6%, target below 2%).');
    expect(summariseQuality(windows(50, 3, 100, 5)).alertMessage).toContain('5 of 100 answers in the last 30 days');
  });

  it('has no rate and no alert when nothing was answered', () => {
    const summary = summariseQuality(windows(0, 0, 0, 0));
    expect(summary.windows.map((w) => w.rate)).toEqual([null, null]);
    expect(summary.alert).toBe(false);
  });
});

describe('getQuality', () => {
  it('reports answers and failures for 7 and 30 days, the latest ungrounded examples, the day\'s usage and the corpus', async () => {
    setEnv({ AI_DAILY_LIMIT: '50' });
    poolQuery
      .mockResolvedValueOnce({ rows: [{ answers_7: 40, ungrounded_7: 1, answers_30: 120, ungrounded_30: 4 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            trace_id: 't9',
            created_at: '2026-10-14T09:00:00.000Z',
            question_redacted: 'How do I appeal?',
            answer: 'Appeals take 45 days.',
            grounding: { grounded: false, unsupported: [{ type: 'unsupported-number', text: '45' }] },
            mode: 'ai',
            model: 'claude-opus-5-5',
            level: 2,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ answers: 12 }] });
    const report = await getQuality();

    expect(report.target).toBe(2);
    expect(report.windows).toEqual([
      { days: 7, answers: 40, ungrounded: 1, rate: 2.5 },
      { days: 30, answers: 120, ungrounded: 4, rate: 3.33 },
    ]);
    expect(report.alert).toBe(true);
    expect(report.alertMessage).toContain('1 of 40 answers in the last 7 days');
    expect(report.latestUngrounded).toEqual([
      {
        traceId: 't9',
        createdAt: '2026-10-14T09:00:00.000Z',
        question: 'How do I appeal?',
        answer: 'Appeals take 45 days.',
        unsupported: [{ type: 'unsupported-number', text: '45' }],
        mode: 'ai',
        model: 'claude-opus-5-5',
        level: 2,
      },
    ]);
    expect(report.usage).toEqual({ generatedToday: 12, dailyLimit: 50 });
    expect(report.corpus).toMatchObject({ documents: 8, passages: 43 });

    const countsSql = String(poolQuery.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(countsSql).toContain("grounding->>'grounded' IS NOT NULL"); // only exchanges that made an answer are counted
    expect(countsSql).toContain("INTERVAL '7 days'");
    expect(countsSql).toContain("INTERVAL '30 days'");
  });
});

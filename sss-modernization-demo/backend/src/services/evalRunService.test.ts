// STORY-021: server-side evaluation runs. Scoring is pure; starting a run, the hourly limit and the baseline are checked here with the
// database mocked, and against a real one by scripts/e2e/ai-quality.mjs.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('./caseEvents', () => ({ inTransaction: jest.fn() }));
jest.mock('./auditService', () => ({ AuditAction: { AI_EVAL_RUN: 'AI_EVAL_RUN', AI_EVAL_BASELINE: 'AI_EVAL_BASELINE' }, logAuditEvent: jest.fn().mockResolvedValue({}) }));
jest.mock('./assistantService', () => ({ answerFor: jest.fn() }));
jest.mock('./policyCorpus', () => ({ POLICY_DOCS_DIR: require('node:path').resolve(__dirname, '..', '..', 'policy-docs'), getCorpusInfo: jest.fn().mockResolvedValue({ version: 'abc123def456' }) }));

import pool from '../database/connection';
import { RateLimitError, ValidationError } from '../utils/errors';
import { logAuditEvent } from './auditService';
import { inTransaction } from './caseEvents';
import { answerFor } from './assistantService';
import {
  QuestionResult,
  checkThresholds,
  belowBaseline,
  citationIsValid,
  hasFact,
  loadGolden,
  mapLimit,
  markBaseline,
  runGoldenSet,
  scoreResults,
  startRun,
} from './evalRunService';

const query = pool.query as unknown as jest.Mock;
const transaction = inTransaction as jest.Mock;
const audit = logAuditEvent as jest.Mock;
const ask = answerFor as jest.Mock;
const ADMIN = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.com' };

const result = (change: Partial<QuestionResult> = {}): QuestionResult => ({
  id: 'g01', question: 'q', status: 'shown', level: 0, mode: 'ai', latencyMs: 10, expectedPassages: ['a:1'], retrieved: ['a:1'],
  retrievalHit: true, facts: 2, factsFound: 2, factsMissing: [], citations: 2, invalidCitations: 0, grounded: true, answer: 'text', ...change,
});

describe('the golden set the server reads', () => {
  it('is the same file scripts/ai/eval.mjs scores: at least 25 questions with expected passages and facts', () => {
    const golden = loadGolden();
    expect(golden.length).toBeGreaterThanOrEqual(25);
    expect(golden.every((q) => q.question && q.expectedPassages.length > 0 && q.facts.length > 0)).toBe(true);
  });
});

describe('hasFact and citationIsValid', () => {
  it('ignore case, commas and the dollar sign, and accept any alternative', () => {
    expect(hasFact('Income must be under $20,000.', '20000')).toBe(true);
    expect(hasFact('Send an email.', ['email address', 'email'])).toBe(true);
    expect(hasFact('Nothing here.', ['email', 'phone'])).toBe(false);
  });
  it('a citation is valid only for a retrieved passage whose text holds the quote', () => {
    const passages = [{ id: 'a:1', body: 'Applicants may appeal within 30 days.' }];
    expect(citationIsValid({ passageId: 'a:1', quote: 'appeal within 30 days' }, passages)).toBe(true);
    expect(citationIsValid({ passageId: 'a:1', quote: 'within 45 days' }, passages)).toBe(false);
    expect(citationIsValid({ passageId: 'b:1', quote: 'appeal within 30 days' }, passages)).toBe(false);
  });
});

describe('scoreResults: the four scores', () => {
  it('scores retrieval, facts, citations and grounding', () => {
    const scores = scoreResults([
      result(),
      result({ id: 'g02', retrievalHit: false, factsFound: 1, factsMissing: ['x'], citations: 2, invalidCitations: 1, grounded: false }),
    ]);
    expect(scores).toEqual({ retrievalHitRate: 0.5, factAccuracy: 0.75, citationValidity: 0.75, groundedRate: 0.5 });
  });

  it('scores only retrieval when nothing was generated (AI off)', () => {
    const scores = scoreResults([result({ mode: 'passages-only', citations: 0, grounded: null, answer: null })]);
    expect(scores).toEqual({ retrievalHitRate: 1, factAccuracy: null, citationValidity: null, groundedRate: null });
  });
});

describe('checkThresholds', () => {
  const good = { retrievalHitRate: 0.95, factAccuracy: 0.9, citationValidity: 1, groundedRate: 1 };
  it('enforces all four for the real model, and flags the one that fails', () => {
    expect(checkThresholds(good, 'ai').every((c) => c.enforced && c.passed)).toBe(true);
    const failed = checkThresholds({ ...good, factAccuracy: 0.8 }, 'ai').filter((c) => !c.passed);
    expect(failed.map((c) => c.key)).toEqual(['factAccuracy']);
  });
  it('enforces only retrieval and citations for the stand-in, and only retrieval with AI off', () => {
    expect(checkThresholds({ ...good, factAccuracy: 0.1, groundedRate: 0.1 }, 'stub').every((c) => c.passed)).toBe(true);
    expect(checkThresholds(good, 'stub').filter((c) => c.enforced).map((c) => c.key)).toEqual(['retrievalHitRate', 'citationValidity']);
    expect(checkThresholds({ ...good, citationValidity: null }, 'passages-only').filter((c) => c.enforced).map((c) => c.key)).toEqual(['retrievalHitRate']);
  });
  it('a score that is missing where it is enforced is a failure', () => {
    expect(checkThresholds({ ...good, groundedRate: null }, 'ai').find((c) => c.key === 'groundedRate')!.passed).toBe(false);
  });
});

describe('belowBaseline: more than 5 points under', () => {
  const baseline = { retrievalHitRate: 1, factAccuracy: 0.9, citationValidity: 1, groundedRate: 1 };
  it('is quiet at exactly 5 points and for an improvement', () => {
    expect(belowBaseline({ ...baseline, factAccuracy: 0.85, retrievalHitRate: 1 }, baseline)).toEqual([]);
    expect(belowBaseline({ retrievalHitRate: 1, factAccuracy: 0.99, citationValidity: 1, groundedRate: 1 }, baseline)).toEqual([]);
  });
  it('names each score that fell further, with both figures', () => {
    expect(belowBaseline({ ...baseline, factAccuracy: 0.84, groundedRate: 0.9 }, baseline)).toEqual([
      "Fact accuracy is 84%, more than 5 points under the baseline's 90%.",
      "Grounded rate is 90%, more than 5 points under the baseline's 100%.",
    ]);
  });
  it('skips a score either run lacks', () => {
    expect(belowBaseline({ ...baseline, factAccuracy: null }, baseline)).toEqual([]);
  });
});

describe('mapLimit', () => {
  it('keeps the order and never runs more than the limit at once', async () => {
    let running = 0;
    let most = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5 - (n % 3)));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(most).toBe(3);
  });
});

describe('runGoldenSet: through the same path as a real question', () => {
  it('asks every golden question with answerFor, in the configured mode, and scores the lot', async () => {
    const golden = loadGolden();
    ask.mockImplementation(async (question: string) => {
      const q = golden.find((g) => g.question === question)!;
      return {
        passages: [{ id: q.expectedPassages[0], body: 'The answer is here.' }],
        produced: { status: 'shown', level: 0, mode: 'stub', model: 'stub', answer: JSON.stringify(q.facts), citations: [], grounded: true },
      };
    });
    const outcome = await runGoldenSet();
    expect(ask).toHaveBeenCalledTimes(golden.length);
    expect(outcome).toMatchObject({ mode: 'stub', model: 'stub', passed: true, scores: { retrievalHitRate: 1, groundedRate: 1 } });
    expect(outcome.results).toHaveLength(golden.length);
    expect((outcome.summary as any).questions).toBe(golden.length);
  });
});

describe('startRun: once an hour, audited, finished in the background', () => {
  const runRow = { id: '00000000-0000-4000-8000-0000000000aa', kind: 'eval', status: 'running', mode: 'stub', corpus_version: 'abc123def456', is_baseline: false, created_at: new Date().toISOString() };
  const withClient = (runs: number, retryAfter = 1800) => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (/COUNT\(\*\)::int AS runs/.test(sql)) return { rows: [{ runs, retry_after: retryAfter }] };
        if (/INSERT INTO assistant_eval_runs/.test(sql)) return { rows: [runRow] };
        return { rows: [] };
      }),
    };
    transaction.mockImplementation(async (work: any) => work(client));
    return client;
  };
  beforeEach(() => {
    query.mockReset();
    audit.mockClear();
  });

  it('returns the run at once as running, audits the start and stores the outcome when the work is done', async () => {
    withClient(0);
    query.mockResolvedValue({ rows: [{ ...runRow, status: 'completed', passed: true }] });
    let finished!: (run: any) => void;
    const after = new Promise<any>((resolve) => (finished = resolve));
    const run = await startRun('eval', ADMIN, async () => ({ model: 'stub', mode: 'stub', passed: true, summary: {}, results: [] }), async (r) => finished(r));
    expect(run).toMatchObject({ id: runRow.id, kind: 'eval', status: 'running', corpusVersion: 'abc123def456' });
    expect(audit.mock.calls[0].slice(0, 3)).toEqual(['AI_EVAL_RUN', 'assistant', 'success']);
    expect(audit.mock.calls[0][3].details).toMatchObject({ phase: 'started', kind: 'eval' });
    expect((await after).status).toBe('completed');
    expect(audit.mock.calls.at(-1)![3].details).toMatchObject({ phase: 'finished', passed: true });
  });

  it('refuses a second run within the hour with a 429 that says when', async () => {
    withClient(1, 1800);
    const error = await startRun('eval', ADMIN, async () => { throw new Error('should not run'); }).catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.message).toBe('An evaluation run can be started once an hour, because each calls the model. Try again in about 30 minutes.');
    expect(error.retryAfterSeconds).toBe(1800);
    expect(audit).not.toHaveBeenCalled();
  });

  it('marks the run failed when the work throws, without the error leaving the background', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    withClient(0);
    query.mockResolvedValue({ rows: [] });
    const failed = new Promise<void>((resolve) => audit.mockImplementation(async (_a: string, _r: string, status: string, o: any) => { if (o.details.phase === 'failed') resolve(); return {}; }));
    await startRun('fairness', ADMIN, async () => { throw new Error('the model was unreachable'); });
    await failed;
    expect(query.mock.calls.some(([sql]) => /SET status = 'failed'/.test(sql))).toBe(true);
    audit.mockResolvedValue({});
  });
});

describe('markBaseline', () => {
  const ID = '00000000-0000-4000-8000-0000000000bb';
  const withRow = (row: any) => {
    const client = {
      query: jest.fn(async (sql: string, _params?: unknown[]) => {
        if (/FOR UPDATE/.test(sql)) return { rows: row ? [row] : [] };
        if (/SET is_baseline = TRUE/.test(sql)) return { rows: [{ ...row, is_baseline: true }] };
        return { rows: [] };
      }),
    };
    transaction.mockImplementation(async (work: any) => work(client));
    return client;
  };

  it('releases the earlier baseline of the same mode, sets this one and audits it', async () => {
    const client = withRow({ id: ID, kind: 'eval', status: 'completed', mode: 'ai', model: 'claude-opus-5-5', corpus_version: 'abc' });
    const run = await markBaseline(ID, ADMIN);
    expect(run.isBaseline).toBe(true);
    expect(client.query.mock.calls.some(([sql, params]) => /SET is_baseline = FALSE/.test(sql) && params?.[0] === 'ai')).toBe(true);
    expect(audit.mock.calls.at(-1)!.slice(0, 2)).toEqual(['AI_EVAL_BASELINE', 'assistant']);
  });

  it('refuses a run that is not completed, is a fairness run, does not exist, or an id that is not one', async () => {
    withRow({ id: ID, kind: 'eval', status: 'running', mode: 'ai' });
    await expect(markBaseline(ID, ADMIN)).rejects.toThrow('completed');
    withRow({ id: ID, kind: 'fairness', status: 'completed', mode: 'ai' });
    await expect(markBaseline(ID, ADMIN)).rejects.toThrow('evaluation run');
    withRow(null);
    await expect(markBaseline(ID, ADMIN)).rejects.toThrow('does not exist');
    await expect(markBaseline('nope', ADMIN)).rejects.toBeInstanceOf(ValidationError);
  });
});

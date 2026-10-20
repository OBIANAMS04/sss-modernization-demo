// STORY-021: drift alerts and the signals read from the database. The SQL itself is checked against a real database by
// scripts/e2e/ai-quality.mjs; here the database is mocked and what is checked is what the code decides.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('./auditService', () => ({ AuditAction: { AI_DRIFT_ALERT: 'AI_DRIFT_ALERT' }, logAuditEvent: jest.fn().mockResolvedValue({}) }));
jest.mock('./changeMarkers', () => ({ noteChange: jest.fn().mockResolvedValue(false), listMarkers: jest.fn().mockResolvedValue([]) }));

import pool from '../database/connection';
import { logAuditEvent } from './auditService';
import { FAIRNESS_STATEMENT, TREND_DAYS, getDailySignals, getWindowCounts, runProblems, syncAlerts } from './aiQualityService';
import { SignalDrift } from './driftSignals';
import { RunRow } from './evalRunService';

const query = pool.query as unknown as jest.Mock;
const audit = logAuditEvent as jest.Mock;

const drift = (key: string, state: SignalDrift['state'] = 'drift'): SignalDrift =>
  ({ key, label: key, unit: 'percent', description: '', tolerance: '', state, recent: 90, baseline: 100, change: -10, message: state === 'drift' ? `${key} moved from 100% to 90%.` : null }) as SignalDrift;

const run = (change: Partial<RunRow> = {}): RunRow => ({
  id: 'r1', kind: 'eval', status: 'completed', model: 'claude-opus-5-5', corpusVersion: 'abc', mode: 'ai',
  scores: { retrievalHitRate: 1, factAccuracy: 0.9, citationValidity: 1, groundedRate: 1 }, passed: true, summary: null, error: null,
  startedByEmail: 'a@example.com', isBaseline: false, createdAt: '2026-10-20T10:00:00Z', finishedAt: '2026-10-20T10:03:00Z', ...change,
});

describe('runProblems', () => {
  it('has nothing to say about a run that passed, one that has not finished, or no run', () => {
    expect(runProblems(run(), undefined)).toEqual([]);
    expect(runProblems(run({ status: 'running' }), undefined)).toEqual([]);
    expect(runProblems(undefined, undefined)).toEqual([]);
  });
  it('names a threshold the run missed', () => {
    expect(runProblems(run({ scores: { retrievalHitRate: 1, factAccuracy: 0.8, citationValidity: 1, groundedRate: 1 } }), undefined)).toEqual(['Fact accuracy is 80%, under the threshold of 85%.']);
  });
  it('names a score more than 5 points under the baseline of the same mode, even when it still meets the threshold', () => {
    const baseline = run({ id: 'b', isBaseline: true, scores: { retrievalHitRate: 1, factAccuracy: 0.99, citationValidity: 1, groundedRate: 1 } });
    expect(runProblems(run(), baseline)).toEqual(["Fact accuracy is 90%, more than 5 points under the baseline's 99%."]);
    expect(runProblems(run(), { ...baseline, mode: 'stub' })).toEqual([]);
    expect(runProblems(baseline, baseline)).toEqual([]);
  });
  it('a fairness run is a problem only when it missed its criteria', () => {
    expect(runProblems(run({ kind: 'fairness', passed: false }), undefined)).toHaveLength(1);
    expect(runProblems(run({ kind: 'fairness', passed: true }), undefined)).toEqual([]);
  });
});

describe('syncAlerts: once until it clears', () => {
  /** The database, as far as alerts go: which are open, and what the listing at the end returns. */
  const database = (open: { id: string; kind: string; key: string }[], inserted = true) => {
    query.mockReset();
    query.mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM assistant_quality_alerts WHERE cleared_at IS NULL$/.test(sql.trim())) return { rows: open };
      if (/INSERT INTO assistant_quality_alerts/.test(sql)) return { rows: inserted ? [{ id: 'new-alert' }] : [] };
      if (/UPDATE assistant_quality_alerts/.test(sql)) return { rows: [{ id: 'x' }] };
      return { rows: [] };
    });
  };
  const sqls = () => query.mock.calls.map(([sql]) => String(sql));
  beforeEach(() => audit.mockClear());

  it('opens an alert for a drifted signal: an audit event naming no question, and a notification to the administrators', async () => {
    database([]);
    await syncAlerts([drift('groundedRate'), drift('withheldRate', 'ok')], undefined, undefined, undefined);
    expect(sqls().filter((s) => /INSERT INTO assistant_quality_alerts/.test(s))).toHaveLength(1);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0].slice(0, 3)).toEqual(['AI_DRIFT_ALERT', 'assistant', 'failure']);
    expect(audit.mock.calls[0][3].details).toEqual({ alertId: 'new-alert', kind: 'signal', key: 'groundedRate', phase: 'opened' });
    const notice = query.mock.calls.find(([sql]) => /INSERT INTO notifications/.test(sql))!;
    expect(notice[0]).toContain("role = 'admin'");
    expect(notice[1][0]).toBe('AI quality alert: groundedRate moved from 100% to 90%. Open AI Quality to see it.');
  });

  it('does nothing again while the same drift lasts', async () => {
    database([{ id: 'a1', kind: 'signal', key: 'groundedRate' }]);
    await syncAlerts([drift('groundedRate')], undefined, undefined, undefined);
    expect(sqls().some((s) => /INSERT INTO (assistant_quality_alerts|notifications)/.test(s))).toBe(false);
    expect(sqls().some((s) => /UPDATE assistant_quality_alerts/.test(s))).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it('clears an open alert whose cause is gone, with an audit event', async () => {
    database([{ id: 'a1', kind: 'signal', key: 'groundedRate' }]);
    await syncAlerts([drift('groundedRate', 'ok')], undefined, undefined, undefined);
    expect(sqls().some((s) => /UPDATE assistant_quality_alerts SET cleared_at = NOW\(\)/.test(s))).toBe(true);
    expect(audit.mock.calls[0][3].details).toMatchObject({ kind: 'signal', key: 'groundedRate', phase: 'cleared' });
    expect(audit.mock.calls[0][2]).toBe('success');
  });

  it('does not alert or notify twice when another request opened it first', async () => {
    database([], false);
    await syncAlerts([drift('groundedRate')], undefined, undefined, undefined);
    expect(audit).not.toHaveBeenCalled();
    expect(sqls().some((s) => /INSERT INTO notifications/.test(s))).toBe(false);
  });

  it('alerts for the latest evaluation run and the latest fairness run', async () => {
    database([]);
    await syncAlerts([], run({ scores: { retrievalHitRate: 0.5, factAccuracy: 0.9, citationValidity: 1, groundedRate: 1 } }), undefined, run({ id: 'f1', kind: 'fairness', passed: false }));
    expect(audit.mock.calls.map((c) => [c[3].details.kind, c[3].details.key])).toEqual([['eval', 'latest-run'], ['fairness', 'latest-run']]);
  });
});

describe('the signals read from the database', () => {
  it('fills 35 days, the empty ones with no answers and no values', async () => {
    const today = new Date().toISOString().slice(0, 10);
    query.mockReset().mockResolvedValueOnce({
      rows: [{ day: today, answers: 4, checked: 4, grounded: 3, withheld: 0, level1: 1, no_answer: 0, with_text: 4, citations: 8, characters: 1200, negative: 1, reported: 0, p95: '3500.5' }],
    });
    const days = await getDailySignals();
    expect(days).toHaveLength(TREND_DAYS);
    expect(days[0].answers).toBe(0);
    expect(days[0].values.groundedRate).toBeNull();
    expect(days.at(-1)).toMatchObject({ day: today, answers: 4, values: { groundedRate: 75, level1Share: 25, citationsPerAnswer: 2, answerLength: 300, p95LatencyMs: 3501, negativeFeedbackRate: 25 } });
  });

  it('reads only real answers (mode ai) that were completed, and the two windows apart', async () => {
    query.mockReset().mockResolvedValue({ rows: [{ window_name: 'recent', answers: 5, checked: 5, grounded: 5, withheld: 0, level1: 0, no_answer: 0, with_text: 5, citations: 10, characters: 500, negative: 0, reported: 0, p95: null }] });
    const counts = await getWindowCounts();
    expect(counts.recent.answers).toBe(5);
    expect(counts.baseline.answers).toBe(0);
    expect(String(query.mock.calls[0][0])).toContain("mode = 'ai' AND status NOT IN ('pending', 'error')");
    expect(query.mock.calls[0][1]).toEqual([7, 35]);
  });
});

describe('the fairness statement', () => {
  it('says what is not collected and why, and that age is an input by design', () => {
    expect(FAIRNESS_STATEMENT.notCollected).toEqual(['Race', 'Sex or gender', 'Ethnicity', 'Religion', 'Disability', 'National origin']);
    const text = FAIRNESS_STATEMENT.paragraphs.join(' ');
    expect(text).toContain('does not collect');
    expect(text).toContain('Age is an input to the Type A');
    expect(text).toContain('counterfactual');
  });
});

// STORY-029: the objectives, their evaluation over a window, and the alerts they open and close.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const query = jest.fn();
const audit = jest.fn();
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: (...a: unknown[]) => query(...a), connect: jest.fn() } }));
jest.mock('./auditService', () => ({ AuditAction: { SLO_ALERT: 'SLO_ALERT' }, logAuditEvent: (...a: unknown[]) => audit(...a) }));
jest.mock('../observability/metricsStore', () => ({ flushMetrics: jest.fn(), RETENTION_DAYS: 30 }));

import { MIN_REQUESTS, Measures, RUNBOOK, SLOS, TARGETS, evaluateWindow, runbookIdOf, wantedAlerts } from '../observability/slo';
import { syncSloAlerts } from '../observability/sloService';
import { runTick, QUALITY_EVERY_TICKS } from '../observability/scheduler';

const healthy: Measures = { requests: 1000, errors5xx: 0, p95Ms: 300, worstRoute: { route: 'GET /api/cases', rate: 0, requests: 500 }, aiSpendUsd: 0.1 };
const status = (m: Partial<Measures>, window: '1h' | '24h' = '1h', budget = 2) =>
  Object.fromEntries(evaluateWindow(window, { ...healthy, ...m }, budget).map((r) => [r.id, r.status]));

describe('the objectives', () => {
  it('are defined once: availability 99.5%, p95 under 2 s, error rate under 1%, AI spend, drift and fairness', () => {
    expect(SLOS.map((s) => s.id)).toEqual(['availability', 'latency', 'error-rate', 'ai-spend', 'ai-drift', 'ai-fairness']);
    expect(TARGETS).toMatchObject({ availability: 0.995, p95Ms: 2000, errorRate: 0.01 });
  });
  it('have a runbook entry each, with what it means, what to check first and how to close it', () => {
    expect(RUNBOOK.map((e) => e.id)).toEqual(SLOS.map((s) => s.id));
    for (const e of RUNBOOK) {
      expect(e.meaning.length).toBeGreaterThan(20);
      expect(e.firstChecks.length).toBeGreaterThan(0);
      expect(e.close.length).toBeGreaterThan(20);
    }
  });
  it('are all described in docs/RUNBOOK-ALERTS.md, one entry each', () => {
    const doc = readFileSync(resolve(__dirname, '../../../docs/RUNBOOK-ALERTS.md'), 'utf-8');
    for (const e of RUNBOOK) {
      expect(doc).toContain(`<a id="${e.id}"></a>`);
      expect(doc).toContain(`## ${e.title}`);
    }
  });
  it('map an alert row to its runbook entry', () => {
    expect(runbookIdOf('slo', 'latency:1h')).toBe('latency');
    expect(runbookIdOf('slo', 'ai-spend:24h')).toBe('ai-spend');
    expect(runbookIdOf('signal', 'groundedRate')).toBe('ai-drift');
    expect(runbookIdOf('eval', 'latest-run')).toBe('ai-drift');
    expect(runbookIdOf('fairness', 'latest-run')).toBe('ai-fairness');
  });
});

describe('evaluateWindow', () => {
  it('is healthy when nothing is wrong', () => {
    expect(status({})).toEqual({ availability: 'ok', latency: 'ok', 'error-rate': 'ok', 'ai-spend': 'ok' });
  });
  it('breaches availability under 99.5% non-5xx: 6 in 1000 is a breach, 5 in 1000 is not', () => {
    expect(status({ errors5xx: 6 }).availability).toBe('breach');
    expect(status({ errors5xx: 5 }).availability).toBe('ok');
  });
  it('breaches latency when p95 reaches 2 s', () => {
    expect(status({ p95Ms: 1999 }).latency).toBe('ok');
    expect(status({ p95Ms: 2000 }).latency).toBe('breach');
  });
  it('breaches the error rate when one route fails 1% or more, even if the service as a whole is fine', () => {
    const m = { worstRoute: { route: 'POST /api/cases', rate: 0.02, requests: 50 } };
    expect(status(m)['error-rate']).toBe('breach');
    expect(evaluateWindow('1h', { ...healthy, ...m }, 2).find((r) => r.id === 'error-rate')!.message).toContain('POST /api/cases');
  });
  it('has no data, and so no breach, under 20 requests', () => {
    const s = status({ requests: MIN_REQUESTS - 1, errors5xx: 5, p95Ms: 9000, worstRoute: null });
    expect([s.availability, s.latency, s['error-rate']]).toEqual(['no-data', 'no-data', 'no-data']);
  });
  it('breaches AI spend over the daily budget in 24 hours, and over a quarter of it in one hour', () => {
    expect(status({ aiSpendUsd: 2.01 }, '24h')['ai-spend']).toBe('breach');
    expect(status({ aiSpendUsd: 1.99 }, '24h')['ai-spend']).toBe('ok');
    expect(status({ aiSpendUsd: 0.51 }, '1h')['ai-spend']).toBe('breach');
    expect(status({ aiSpendUsd: 0.49 }, '1h')['ai-spend']).toBe('ok');
    expect(status({ aiSpendUsd: 6 }, '24h', 10)['ai-spend']).toBe('ok');
  });
  it('turns each breach into an alert keyed objective:window', () => {
    const wanted = wantedAlerts(evaluateWindow('24h', { ...healthy, errors5xx: 50, p95Ms: 2500 }, 2));
    expect(wanted.map((w) => w.key)).toEqual(['availability:24h', 'latency:24h']);
    expect(wanted[0].message).toContain('Availability in the last 24 hours is 95%');
  });
});

describe('syncSloAlerts: once until it recovers', () => {
  const breach = (window: '1h' | '24h' = '1h') => evaluateWindow(window, { ...healthy, errors5xx: 50 }, 2);
  const database = (open: { id: string; key: string }[]) => {
    query.mockReset();
    query.mockImplementation(async (sql: string) => {
      if (/SELECT id, key FROM assistant_quality_alerts/.test(sql)) return { rows: open };
      if (/INSERT INTO assistant_quality_alerts/.test(sql)) return { rows: [{ id: 'new-alert' }] };
      if (/UPDATE assistant_quality_alerts/.test(sql)) return { rows: [{ id: 'x' }] };
      return { rows: [] };
    });
  };
  beforeEach(() => audit.mockClear());

  it('opens an alert for a breach: an audit event and a notification to every administrator', async () => {
    database([]);
    expect((await syncSloAlerts(breach())).opened).toEqual(['availability:1h']);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0].slice(0, 3)).toEqual(['SLO_ALERT', 'observability', 'failure']);
    expect(audit.mock.calls[0][3].details).toMatchObject({ key: 'availability:1h', phase: 'opened' });
    const notice = query.mock.calls.find(([sql]) => /INSERT INTO notifications/.test(sql))!;
    expect(notice[0]).toContain("role = 'admin'");
    expect(notice[1][0]).toMatch(/^Service alert: Availability in the last hour is 95%.* Open Observability to see it\.$/);
  });
  it('does nothing again while the breach lasts (deduplicated)', async () => {
    database([{ id: 'a1', key: 'availability:1h' }]);
    const changed = await syncSloAlerts(breach());
    expect(changed).toEqual({ opened: [], cleared: [] });
    expect(query.mock.calls.some(([sql]) => /INSERT INTO (assistant_quality_alerts|notifications)/.test(sql))).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });
  it('closes the alert when the objective recovers, with an audit event', async () => {
    database([{ id: 'a1', key: 'availability:1h' }]);
    const changed = await syncSloAlerts(evaluateWindow('1h', healthy, 2));
    expect(changed.cleared).toEqual(['availability:1h']);
    expect(audit.mock.calls[0].slice(0, 3)).toEqual(['SLO_ALERT', 'observability', 'success']);
    expect(audit.mock.calls[0][3].details).toMatchObject({ phase: 'cleared' });
  });
  it('handles only its own alerts (kind slo): the query never touches drift or fairness alerts', async () => {
    database([]);
    await syncSloAlerts(breach());
    expect(String(query.mock.calls[0][0])).toContain("kind = 'slo'");
  });
});

describe('the timer tick', () => {
  it('runs the AI-quality check only every few ticks, and a failure of one check does not stop the next', async () => {
    jest.resetModules();
    expect(QUALITY_EVERY_TICKS).toBeGreaterThan(1);
    query.mockReset().mockRejectedValue(new Error('db down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runTick(1)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith('Objective check failed', expect.anything());
    spy.mockRestore();
  });
});

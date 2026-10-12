jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));

import pool from '../database/connection';
import { MeasurementRow, percentile, summarize, trackWrite, versionOf, waitForNewVersion } from './freshnessService';

const query = pool.query as unknown as jest.Mock;

const row = (type: string, totalMs: number, extra: Partial<MeasurementRow> = {}): MeasurementRow => ({
  type,
  operation: 'update',
  totalMs,
  writeMs: totalMs,
  visibleMs: 0,
  visible: true,
  at: new Date('2026-10-12T10:00:00Z'),
  ...extra,
});

describe('percentile (nearest rank)', () => {
  it('picks the value at the rank, and the largest value for high percentiles of short lists', () => {
    const sorted = [10, 20, 30, 40, 50];
    expect([percentile(sorted, 50), percentile(sorted, 95), percentile(sorted, 99)]).toEqual([30, 50, 50]);
  });

  it('is null for no data', () => {
    expect(percentile([], 95)).toBeNull();
  });
});

describe('summarize', () => {
  it('reports every data type, with "none" where nothing was measured, and no alert when all are on target', () => {
    const s = summarize([row('profile', 12), row('profile', 30), row('case_status', 40)]);
    expect(s.types.map((t) => [t.type, t.status, t.count])).toEqual([
      ['profile', 'ok', 2],
      ['eligibility', 'none', 0],
      ['application', 'none', 0],
      ['case_status', 'ok', 1],
      ['probe', 'none', 0],
    ]);
    expect([s.overall.count, s.overall.withinRate, s.overall.p95Ms]).toEqual([3, 100, 40]);
    expect(s.alert).toBeNull();
  });

  it('raises the alert when a data type p95 is over 30 seconds, naming the type and the figure', () => {
    const rows = [row('profile', 50), row('profile', 31_200), ...Array.from({ length: 30 }, () => row('eligibility', 20))];
    const s = summarize(rows);
    expect(s.types.find((t) => t.type === 'profile')?.status).toBe('over');
    expect(s.alert).toBe('Profile updates: p95 is 31.2 s, over the 30 s target.');
    expect(s.slowest[0]).toMatchObject({ type: 'profile', totalMs: 31_200, label: 'Profile updates' });
  });

  it('flags the overall SLO when fewer than 95% of updates were readable within 30 seconds', () => {
    const rows = [...Array.from({ length: 18 }, () => row('application', 100)), row('application', 40_000), row('application', 45_000)];
    expect(summarize(rows).alert).toContain('Overall, only 90% of updates were readable within 30 s (target 95%).');
  });

  it('counts a change that never became visible as a miss, even if it was quick to write', () => {
    const s = summarize([row('case_status', 5, { visible: false }), row('case_status', 5)]);
    expect([s.overall.withinTarget, s.overall.withinRate]).toEqual([1, 50]);
  });

  it('keeps end-to-end probes out of the overall figures', () => {
    const s = summarize([row('probe', 90_000), row('profile', 10)]);
    expect([s.overall.count, s.overall.maxMs]).toEqual([1, 10]);
    expect(s.types.find((t) => t.type === 'probe')?.status).toBe('over');
  });
});

describe('waitForNewVersion', () => {
  it('reports visible once a different version appears', async () => {
    const versions = ['100', '100', '101'];
    const result = await waitForNewVersion(async () => versions.shift() ?? '101', '100', { pollMs: 1 });
    expect(result.visible).toBe(true);
    expect(versions).toHaveLength(0);
  });

  it('treats a row that did not exist before as visible as soon as it exists', async () => {
    const versions = [null, '7'];
    expect((await waitForNewVersion(async () => versions.shift() ?? '7', null, { pollMs: 1 })).visible).toBe(true);
  });

  it('keeps polling through read errors and gives up when the change never shows', async () => {
    const read = jest.fn().mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue('100');
    const result = await waitForNewVersion(read, '100', { pollMs: 1, timeoutMs: 20 });
    expect(result.visible).toBe(false);
    expect(read.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('trackWrite', () => {
  beforeEach(() => query.mockReset());

  it('returns the write result at once and records the measurement once the new version is readable', async () => {
    let version = '500';
    query.mockImplementation(async (sql: string) => (sql.startsWith('INSERT') ? { rows: [] } : { rows: [{ v: version }] }));

    const result = await trackWrite('case_status', 'status_change', () => versionOf.case('case-1'), async () => {
      version = '501';
      return { id: 'case-1', status: 'In Review' };
    });
    expect(result).toEqual({ id: 'case-1', status: 'In Review' });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const insert = query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO latency_metrics'));
    expect(insert?.[1].slice(0, 2)).toEqual(['case_status', 'status_change']);
    expect(insert?.[1][5]).toBe(true);
  });

  it('records nothing when the write fails', async () => {
    query.mockResolvedValue({ rows: [{ v: '1' }] });
    await expect(
      trackWrite('profile', 'update', () => versionOf.user('u-1'), async () => {
        throw new Error('validation failed');
      })
    ).rejects.toThrow('validation failed');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });
});

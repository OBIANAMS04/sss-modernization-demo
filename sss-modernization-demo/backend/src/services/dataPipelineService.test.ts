// STORY-005: the data status a person sees. The database is mocked; the bands and the arithmetic are checked here, the route end to end
// by the access tests (it is signed-in only).
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));

import pool from '../database/connection';
import { GREEN_UNDER_MS, YELLOW_UNDER_MS, getPipelineStatus, levelFor } from './dataPipelineService';

const query = pool.query as jest.Mock;

describe('levelFor', () => {
  it.each([
    [null, 'unknown'],
    [0, 'green'],
    [GREEN_UNDER_MS - 1, 'green'],
    [GREEN_UNDER_MS, 'yellow'],
    [YELLOW_UNDER_MS, 'yellow'],
    [YELLOW_UNDER_MS + 1, 'red'],
  ])('%p ms is %s', (ms, level) => {
    expect(levelFor(ms as number | null)).toBe(level);
  });
});

describe('getPipelineStatus', () => {
  beforeEach(() => query.mockReset());

  it("reports the caller's last change, its age, and the p95 of the last hour's measured writes", async () => {
    const now = new Date('2026-10-21T12:00:00.000Z');
    query
      .mockResolvedValueOnce({ rows: [{ last_change: '2026-10-21T11:59:30.000Z' }] })
      .mockResolvedValueOnce({ rows: Array.from({ length: 20 }, (_, i) => ({ latency_ms: (i + 1) * 100 })) });
    const status = await getPipelineStatus('user-1', now);
    expect(status).toMatchObject({ source: 'database', lastChange: '2026-10-21T11:59:30.000Z', dataAgeMs: 30_000, readAt: now.toISOString() });
    expect(status.freshness).toMatchObject({ level: 'green', measured: 20, windowMinutes: 60, targetMs: 30_000 });
    expect(status.freshness.p95Ms).toBeGreaterThanOrEqual(1900);
    // Only the caller's own records are read
    expect(query.mock.calls[0][1]).toEqual(['user-1']);
  });

  it('says unknown with no measured writes, and null with no records yet', async () => {
    query.mockResolvedValueOnce({ rows: [{ last_change: null }] }).mockResolvedValueOnce({ rows: [] });
    const status = await getPipelineStatus('user-2');
    expect(status).toMatchObject({ lastChange: null, dataAgeMs: null });
    expect(status.freshness).toMatchObject({ level: 'unknown', p95Ms: null, measured: 0 });
  });
});

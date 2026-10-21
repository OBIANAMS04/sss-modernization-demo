// STORY-027: the per-route, per-minute rollups: how a duration is counted, what a minute holds, what is written and what is kept.
const clientQuery = jest.fn();
const poolQuery = jest.fn();
jest.mock('../database/connection', () => ({
  __esModule: true,
  default: { query: (...a: unknown[]) => poolQuery(...a), connect: async () => ({ query: (...a: unknown[]) => clientQuery(...a), release: jest.fn() }) },
}));

import { BOUNDS_MS, emptyHist, mergeHist, quantileFromHist, quantileFromSorted, addToHist } from '../observability/histogram';
import { MAX_ROUTES_PER_MINUTE, SAMPLE_CAP, memoryFootprint, minuteOf, pendingRows, recordQuery, recordRequest, resetRecorder, setPoolProbe } from '../observability/metricsRecorder';
import { cleanupMetrics, flushMetrics, recordServerError } from '../observability/metricsStore';

const T0 = Date.UTC(2026, 9, 20, 10, 0, 30); // 10:00:30
beforeEach(() => {
  resetRecorder();
  clientQuery.mockReset().mockResolvedValue({ rows: [] });
  poolQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('histogram', () => {
  it('puts a duration in the first bucket whose bound it does not exceed', () => {
    const h = emptyHist();
    for (const ms of [1, 5, 6, 2000, 2001, 99999]) addToHist(h, ms);
    expect(h[0]).toBe(2); // 1 and 5
    expect(h[1]).toBe(1); // 6
    expect(h[BOUNDS_MS.indexOf(2000)]).toBe(1);
    expect(h[BOUNDS_MS.indexOf(3000)]).toBe(1);
    expect(h[h.length - 1]).toBe(1);
  });
  it('reads a window percentile from the added-up buckets, which is not the percentile of the minutes', () => {
    const quiet = emptyHist();
    const busy = emptyHist();
    for (let i = 0; i < 95; i++) addToHist(quiet, 20);
    for (let i = 0; i < 5; i++) addToHist(quiet, 900);
    for (let i = 0; i < 100; i++) addToHist(busy, 20);
    const both = mergeHist(mergeHist(emptyHist(), quiet), busy);
    expect(quantileFromHist(both, 0.5)!).toBeLessThan(30);
    expect(quantileFromHist(both, 0.99)!).toBeGreaterThan(500);
    expect(quantileFromHist(emptyHist(), 0.95)).toBeNull();
  });
  it('is exact about the 2-second target: all requests at 1.9 s have a p95 under it, all at 2.1 s do not', () => {
    const fast = emptyHist();
    const slow = emptyHist();
    for (let i = 0; i < 50; i++) {
      addToHist(fast, 1900);
      addToHist(slow, 2100);
    }
    expect(quantileFromHist(fast, 0.95)!).toBeLessThanOrEqual(2000);
    expect(quantileFromHist(slow, 0.95)!).toBeGreaterThan(2000);
  });
  it('takes a nearest-rank quantile of sorted samples', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect([quantileFromSorted(sorted, 0.5), quantileFromSorted(sorted, 0.95), quantileFromSorted(sorted, 0.99)]).toEqual([50, 95, 99]);
    expect(quantileFromSorted([], 0.5)).toBeNull();
  });
});

describe('the recorder', () => {
  it('counts requests, 4xx and 5xx apart, per route template and per minute, with p50/p95/p99', () => {
    for (let i = 1; i <= 100; i++) recordRequest('GET /api/cases/:id', i === 100 ? 500 : i > 90 ? 404 : 200, i, T0);
    recordRequest('GET /api/cases/:id', 200, 5, T0 + 60_000);
    recordRequest('POST /api/cases', 201, 40, T0);
    const { route } = pendingRows(true, T0 + 120_000);
    const row = route.find((r) => r.route === 'GET /api/cases/:id' && r.minute.getTime() === minuteOf(T0))!;
    expect(row).toMatchObject({ requests: 100, errors4xx: 9, errors5xx: 1, p50: 50, p95: 95, p99: 99, maxMs: 100 });
    expect(row.hist.reduce((a, b) => a + b, 0)).toBe(100);
    expect(route).toHaveLength(3);
  });
  it('holds at most SAMPLE_CAP durations per route and minute, and still counts them all', () => {
    for (let i = 0; i < SAMPLE_CAP * 3; i++) recordRequest('GET /health', 200, i % 50, T0);
    const row = pendingRows(true, T0).route[0];
    expect(row.requests).toBe(SAMPLE_CAP * 3);
    expect(row.hist.reduce((a, b) => a + b, 0)).toBe(SAMPLE_CAP * 3);
  });
  it('holds at most MAX_ROUTES_PER_MINUTE labels; the rest are one bucket', () => {
    for (let i = 0; i < MAX_ROUTES_PER_MINUTE + 50; i++) recordRequest(`GET /made/up/${i}`, 404, 1, T0);
    const { route } = pendingRows(true, T0);
    expect(route).toHaveLength(MAX_ROUTES_PER_MINUTE + 1);
    expect(route.find((r) => r.route === '(other)')!.requests).toBe(50);
    expect(memoryFootprint().routeBuckets).toBe(MAX_ROUTES_PER_MINUTE + 1);
  });
  it('leaves the minute in progress out unless asked', () => {
    recordRequest('GET /health', 200, 1, T0);
    expect(pendingRows(false, T0 + 10_000).route).toHaveLength(0);
    expect(pendingRows(false, T0 + 60_000).route).toHaveLength(1);
  });
  it('records query time and the pool in use (the most at once) per minute', () => {
    let inUse = 1;
    setPoolProbe(() => ({ size: 5, idle: 5 - inUse, waiting: inUse > 2 ? 3 : 0 }));
    recordQuery(4, false, T0);
    inUse = 3;
    recordQuery(30, true, T0 + 1000);
    const db = pendingRows(true, T0).db[0];
    expect(db).toMatchObject({ queries: 2, failed: 1, maxMs: 30, poolSize: 5, poolInUseMax: 3, poolWaitingMax: 3 });
  });
});

describe('flushMetrics', () => {
  it('writes each closed minute and route in one transaction, then forgets them', async () => {
    const closed = Date.now() - 5 * 60_000;
    recordRequest('GET /api/cases/:id', 200, 12, closed);
    recordRequest('GET /api/cases/:id', 500, 40, closed);
    await flushMetrics(false);
    const sql = clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sql[0]).toBe('BEGIN');
    expect(sql.some((s) => s.includes('INSERT INTO route_metrics_minute'))).toBe(true);
    expect(sql[sql.length - 1]).toBe('COMMIT');
    const insert = clientQuery.mock.calls.find((c) => String(c[0]).includes('route_metrics_minute'))!;
    expect(insert[1][1]).toBe('GET /api/cases/:id');
    expect(insert[1].slice(2, 6)).toEqual([2, 0, 1, 52]);
    expect(pendingRows(true).route).toHaveLength(0);
  });
  it('keeps the minutes in memory when the write fails, to try again', async () => {
    recordRequest('GET /health', 200, 1, Date.now() - 5 * 60_000);
    clientQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('INSERT')) throw new Error('db down');
      return { rows: [] };
    });
    await flushMetrics(false);
    expect(pendingRows(true).route).toHaveLength(1);
  });
});

describe('retention and server errors', () => {
  it('removes metrics and errors older than 30 days', async () => {
    poolQuery.mockResolvedValue({ rows: [], rowCount: 2 });
    expect(await cleanupMetrics()).toBe(6);
    expect(poolQuery.mock.calls.map((c) => String(c[0]).match(/FROM (\w+)/)![1])).toEqual(['route_metrics_minute', 'db_metrics_minute', 'server_errors']);
    expect(poolQuery.mock.calls[0][1]).toEqual([30]);
  });
  it('keeps a server error with its trace id and no message, and no more than 60 a minute', async () => {
    const now = Date.UTC(2026, 9, 20, 11, 0, 0);
    for (let i = 0; i < 75; i++) recordServerError({ route: 'GET /api/cases/:id', status: 500, traceId: 'a'.repeat(32), durationMs: 5, errorName: 'error', errorCode: '22P02' }, now);
    expect(poolQuery).toHaveBeenCalledTimes(60);
    expect(poolQuery.mock.calls[0][1]).toEqual(['GET /api/cases/:id', 500, 'a'.repeat(32), 5, 'error', '22P02']);
    recordServerError({ route: 'GET /health', status: 503, durationMs: 1 }, now + 60_000);
    expect(poolQuery).toHaveBeenCalledTimes(61);
  });
});

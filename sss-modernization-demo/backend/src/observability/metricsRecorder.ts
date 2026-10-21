import { metrics } from '@opentelemetry/api';
import { addToHist, emptyHist, quantileFromSorted } from './histogram';

// STORY-027: what the service measures about itself, held in memory for the minute in progress and written to PostgreSQL by
// metricsStore.ts. Bounded: a route's minute keeps at most SAMPLE_CAP durations (a random sample beyond that, so its percentiles stay
// fair) plus a fixed-size histogram; routes are templates, so the number of routes is the number of routes in the app.

export const SAMPLE_CAP = 500;
/** The most distinct route labels held for one minute; a request beyond that is counted under "(other)", so labels cannot grow without bound. */
export const MAX_ROUTES_PER_MINUTE = 200;
const MINUTE = 60_000;

export interface Bucket {
  count: number;
  failed: number;
  errors4xx: number;
  errors5xx: number;
  totalMs: number;
  maxMs: number;
  samples: number[];
  hist: number[];
}

const newBucket = (): Bucket => ({ count: 0, failed: 0, errors4xx: 0, errors5xx: 0, totalMs: 0, maxMs: 0, samples: [], hist: emptyHist() });

function add(bucket: Bucket, ms: number, random: () => number = Math.random): void {
  bucket.count += 1;
  bucket.totalMs += ms;
  bucket.maxMs = Math.max(bucket.maxMs, ms);
  addToHist(bucket.hist, ms);
  if (bucket.samples.length < SAMPLE_CAP) bucket.samples.push(ms);
  else {
    // Reservoir sampling: each of the count durations seen is equally likely to be in the sample
    const j = Math.floor(random() * bucket.count);
    if (j < SAMPLE_CAP) bucket.samples[j] = ms;
  }
}

export const minuteOf = (at: number): number => Math.floor(at / MINUTE) * MINUTE;

const routes = new Map<number, Map<string, Bucket>>();
const database = new Map<number, Bucket & { poolSize: number; poolInUseMax: number; poolWaitingMax: number }>();

export function recordRequest(route: string, status: number, ms: number, now: number = Date.now()): void {
  const minute = minuteOf(now);
  let perRoute = routes.get(minute);
  if (!perRoute) routes.set(minute, (perRoute = new Map()));
  const key = perRoute.has(route) || perRoute.size < MAX_ROUTES_PER_MINUTE ? route : '(other)';
  let bucket = perRoute.get(key);
  if (!bucket) perRoute.set(key, (bucket = newBucket()));
  add(bucket, ms);
  if (status >= 500) bucket.errors5xx += 1;
  else if (status >= 400) bucket.errors4xx += 1;
  statusHistogram().record(ms, { 'http.route': key, 'http.response.status_class': `${Math.floor(status / 100)}xx` });
}

// ---- Database

let poolProbe: (() => { size: number; idle: number; waiting: number }) | undefined;
/** Tells the recorder how to read the connection pool (connection.ts does, so this file never imports the pool). */
export function setPoolProbe(probe: () => { size: number; idle: number; waiting: number }): void {
  poolProbe = probe;
}

export function samplePool(now: number = Date.now()): void {
  const minute = minuteOf(now);
  let bucket = database.get(minute);
  if (!bucket) database.set(minute, (bucket = { ...newBucket(), poolSize: 0, poolInUseMax: 0, poolWaitingMax: 0 }));
  if (!poolProbe) return;
  const pool = poolProbe();
  bucket.poolSize = Math.max(bucket.poolSize, pool.size);
  bucket.poolInUseMax = Math.max(bucket.poolInUseMax, pool.size - pool.idle);
  bucket.poolWaitingMax = Math.max(bucket.poolWaitingMax, pool.waiting);
}

export function recordQuery(ms: number, failed: boolean, now: number = Date.now()): void {
  samplePool(now);
  const bucket = database.get(minuteOf(now))!;
  add(bucket, ms);
  if (failed) bucket.failed += 1;
  queryHistogram().record(ms, { 'db.system.name': 'postgresql', 'error.type': failed ? 'error' : 'none' });
}

// ---- OpenTelemetry instruments (no-ops unless an exporter is configured; see tracing.ts)

let httpHistogram: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']> | undefined;
let dbHistogram: typeof httpHistogram;
const statusHistogram = () =>
  (httpHistogram ??= metrics.getMeter('sss-demo-api').createHistogram('http.server.request.duration', { unit: 'ms', description: 'Request duration by route template' }));
const queryHistogram = () => (dbHistogram ??= metrics.getMeter('sss-demo-api').createHistogram('db.client.operation.duration', { unit: 'ms', description: 'Query duration' }));

// ---- What is waiting to be written

export interface RouteRow {
  minute: Date;
  route: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  totalMs: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  maxMs: number;
  hist: number[];
}

export interface DbRow {
  minute: Date;
  queries: number;
  failed: number;
  totalMs: number;
  p50: number | null;
  p95: number | null;
  maxMs: number;
  hist: number[];
  poolSize: number;
  poolInUseMax: number;
  poolWaitingMax: number;
}

const percentiles = (b: Bucket) => {
  const sorted = [...b.samples].sort((x, y) => x - y);
  return { p50: quantileFromSorted(sorted, 0.5), p95: quantileFromSorted(sorted, 0.95), p99: quantileFromSorted(sorted, 0.99) };
};

/**
 * The minutes to write. Closed minutes are taken out of memory once `forget` is called for them; the minute in progress is only included
 * when asked (a page showing the last few minutes, or an evaluation), and stays in memory because it will change again.
 */
export function pendingRows(includeCurrent: boolean, now: number = Date.now()): { route: RouteRow[]; db: DbRow[]; closed: number[]; closedDb: number[] } {
  const current = minuteOf(now);
  const route: RouteRow[] = [];
  const closed: number[] = [];
  for (const [minute, perRoute] of routes) {
    if (minute >= current && !includeCurrent) continue;
    if (minute < current) closed.push(minute);
    for (const [name, b] of perRoute) {
      const p = percentiles(b);
      route.push({ minute: new Date(minute), route: name, requests: b.count, errors4xx: b.errors4xx, errors5xx: b.errors5xx, totalMs: b.totalMs, p50: p.p50, p95: p.p95, p99: p.p99, maxMs: b.maxMs, hist: b.hist });
    }
  }
  const db: DbRow[] = [];
  const closedDb: number[] = [];
  for (const [minute, b] of database) {
    if (minute >= current && !includeCurrent) continue;
    if (minute < current) closedDb.push(minute);
    if (b.count === 0 && b.poolSize === 0) continue;
    const p = percentiles(b);
    db.push({ minute: new Date(minute), queries: b.count, failed: b.failed, totalMs: b.totalMs, p50: p.p50, p95: p.p95, maxMs: b.maxMs, hist: b.hist, poolSize: b.poolSize, poolInUseMax: b.poolInUseMax, poolWaitingMax: b.poolWaitingMax });
  }
  return { route, db, closed, closedDb };
}

export function forget(closed: number[], closedDb: number[]): void {
  for (const m of closed) routes.delete(m);
  for (const m of closedDb) database.delete(m);
}

/** For tests. */
export function resetRecorder(): void {
  routes.clear();
  database.clear();
}

export function memoryFootprint(): { routeMinutes: number; routeBuckets: number } {
  let buckets = 0;
  for (const perRoute of routes.values()) buckets += perRoute.size;
  return { routeMinutes: routes.size, routeBuckets: buckets };
}

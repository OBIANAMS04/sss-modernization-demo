import pool from '../database/connection';
import { emptyHist, mergeHist, quantileFromHist } from './histogram';
import { MIN_REQUESTS } from './slo';

// STORY-027 and 028: reading the rollups back. Percentiles of a window come from histograms added together in the database, never from
// averaging the percentiles of single minutes.

export interface Traffic {
  requests: number;
  errors4xx: number;
  errors5xx: number;
  totalMs: number;
  maxMs: number;
  hist: number[];
}

export interface RouteTraffic extends Traffic {
  route: string;
}

const toTraffic = (r: any, hist: number[]): Traffic => ({
  requests: Number(r.requests),
  errors4xx: Number(r.errors_4xx),
  errors5xx: Number(r.errors_5xx),
  totalMs: Number(r.total_ms),
  maxMs: Number(r.max_ms ?? 0),
  hist,
});

/** Bucket counts summed over rows, by a grouping expression (a route, an hour). One row per group and bucket. */
async function histBy(group: string, since: Date): Promise<Map<string, number[]>> {
  const result = await pool.query(
    `SELECT ${group} AS g, u.ord::int AS ord, SUM(u.v)::int AS c
     FROM route_metrics_minute r CROSS JOIN LATERAL unnest(r.hist) WITH ORDINALITY AS u(v, ord)
     WHERE r.minute >= $1 GROUP BY 1, 2`,
    [since]
  );
  const map = new Map<string, number[]>();
  for (const row of result.rows) {
    const key = String(row.g instanceof Date ? row.g.toISOString() : row.g);
    if (!map.has(key)) map.set(key, emptyHist());
    map.get(key)![row.ord - 1] = row.c;
  }
  return map;
}

/** Everything the service did since `since`, in total. */
export async function trafficSince(since: Date): Promise<Traffic> {
  const [counts, hists] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(errors_4xx), 0) AS errors_4xx, COALESCE(SUM(errors_5xx), 0) AS errors_5xx,
              COALESCE(SUM(total_ms), 0) AS total_ms, COALESCE(MAX(max_ms), 0) AS max_ms
       FROM route_metrics_minute WHERE minute >= $1`,
      [since]
    ),
    histBy(`'all'`, since),
  ]);
  return toTraffic(counts.rows[0], hists.get('all') ?? emptyHist());
}

/** Each route since `since`. */
export async function routesSince(since: Date): Promise<RouteTraffic[]> {
  const [counts, hists] = await Promise.all([
    pool.query(
      `SELECT route, SUM(requests) AS requests, SUM(errors_4xx) AS errors_4xx, SUM(errors_5xx) AS errors_5xx, SUM(total_ms) AS total_ms, MAX(max_ms) AS max_ms
       FROM route_metrics_minute WHERE minute >= $1 GROUP BY route`,
      [since]
    ),
    histBy('r.route', since),
  ]);
  return counts.rows.map((r: any) => ({ route: r.route, ...toTraffic(r, hists.get(r.route) ?? emptyHist()) }));
}

export interface SeriesPoint {
  at: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  p95Ms: number | null;
}

/** Requests and errors per hour or per day since `since`, oldest first, with a point for every period (zero when nothing happened). */
export async function seriesSince(since: Date, unit: 'hour' | 'day', periods: number): Promise<SeriesPoint[]> {
  const step = unit === 'hour' ? 3_600_000 : 86_400_000;
  // Periods are UTC hours or days, counted from the epoch, so they do not depend on the database's time zone
  const group = `floor(extract(epoch FROM r.minute) / ${step / 1000})::bigint`;
  const [counts, hists] = await Promise.all([
    pool.query(
      `SELECT ${group} AS g, SUM(requests) AS requests, SUM(errors_4xx) AS errors_4xx, SUM(errors_5xx) AS errors_5xx
       FROM route_metrics_minute r WHERE minute >= $1 GROUP BY 1`,
      [since]
    ),
    histBy(group, since),
  ]);
  const byPeriod = new Map<string, any>(counts.rows.map((r: any) => [String(r.g), r]));
  const lastPeriod = Math.floor(Date.now() / step);
  const points: SeriesPoint[] = [];
  for (let i = periods - 1; i >= 0; i--) {
    const period = String(lastPeriod - i);
    const row = byPeriod.get(period);
    points.push({
      at: new Date((lastPeriod - i) * step).toISOString(),
      requests: row ? Number(row.requests) : 0,
      errors4xx: row ? Number(row.errors_4xx) : 0,
      errors5xx: row ? Number(row.errors_5xx) : 0,
      p95Ms: hists.get(period) ? quantileFromHist(hists.get(period)!, 0.95) : null,
    });
  }
  return points;
}

export interface DbFigures {
  queries: number;
  failed: number;
  avgMs: number | null;
  p95Ms: number | null;
  maxMs: number;
  poolSize: number;
  poolInUseMax: number;
  poolWaitingMax: number;
}

export async function databaseSince(since: Date): Promise<DbFigures> {
  const [counts, hist] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(queries), 0) AS queries, COALESCE(SUM(failed), 0) AS failed, COALESCE(SUM(total_ms), 0) AS total_ms, COALESCE(MAX(max_ms), 0) AS max_ms,
              COALESCE(MAX(pool_size), 0) AS pool_size, COALESCE(MAX(pool_in_use_max), 0) AS in_use, COALESCE(MAX(pool_waiting_max), 0) AS waiting
       FROM db_metrics_minute WHERE minute >= $1`,
      [since]
    ),
    pool.query(
      `SELECT u.ord::int AS ord, SUM(u.v)::int AS c FROM db_metrics_minute d CROSS JOIN LATERAL unnest(d.hist) WITH ORDINALITY AS u(v, ord)
       WHERE d.minute >= $1 GROUP BY 1`,
      [since]
    ),
  ]);
  const merged = emptyHist();
  for (const row of hist.rows) merged[row.ord - 1] = row.c;
  const r = counts.rows[0];
  const queries = Number(r.queries);
  return {
    queries,
    failed: Number(r.failed),
    avgMs: queries > 0 ? Number(r.total_ms) / queries : null,
    p95Ms: quantileFromHist(merged, 0.95),
    maxMs: Number(r.max_ms),
    poolSize: Number(r.pool_size),
    poolInUseMax: Number(r.in_use),
    poolWaitingMax: Number(r.waiting),
  };
}

export interface LatencyRow {
  route: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  avgMs: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number;
}

export const latencyRows = (routes: RouteTraffic[]): LatencyRow[] =>
  routes.map((r) => ({
    route: r.route,
    requests: r.requests,
    errors4xx: r.errors4xx,
    errors5xx: r.errors5xx,
    avgMs: r.requests > 0 ? r.totalMs / r.requests : 0,
    p50Ms: quantileFromHist(r.hist, 0.5),
    p95Ms: quantileFromHist(r.hist, 0.95),
    p99Ms: quantileFromHist(r.hist, 0.99),
    maxMs: r.maxMs,
  }));

/** The route with the highest 5xx share among routes with enough requests to judge. */
export function worstRoute(routes: RouteTraffic[]): { route: string; rate: number; requests: number } | null {
  let worst: { route: string; rate: number; requests: number } | null = null;
  for (const r of routes) {
    if (r.requests < MIN_REQUESTS) continue;
    const rate = r.errors5xx / r.requests;
    if (!worst || rate > worst.rate) worst = { route: r.route, rate, requests: r.requests };
  }
  return worst;
}

export const mergeAll = (parts: number[][]): number[] => parts.reduce((acc, h) => mergeHist(acc, h), emptyHist());

export interface ServerErrorRow {
  at: string;
  route: string;
  status: number;
  traceId: string | null;
  durationMs: number | null;
  errorName: string | null;
  errorCode: string | null;
}

export async function recentServerErrors(limit = 20): Promise<ServerErrorRow[]> {
  const result = await pool.query(
    'SELECT at, route, status, trace_id, duration_ms, error_name, error_code FROM server_errors ORDER BY at DESC, id DESC LIMIT $1',
    [limit]
  );
  return result.rows.map((r: any) => ({
    at: r.at, route: r.route, status: r.status, traceId: r.trace_id, durationMs: r.duration_ms, errorName: r.error_name, errorCode: r.error_code,
  }));
}

// ---- AI usage

export interface AiDay {
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

/** AI usage per UTC day for the last `days` days, today last: assistant questions and evaluation / fairness runs together. */
export async function aiUsageByDay(days: number): Promise<AiDay[]> {
  const result = await pool.query(
    `WITH usage AS (
       SELECT created_at, ai_calls, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd FROM assistant_interactions WHERE ai_calls > 0
       UNION ALL
       SELECT created_at, ai_calls, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd FROM assistant_eval_runs WHERE ai_calls > 0
     )
     SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, SUM(ai_calls)::int AS calls, SUM(input_tokens)::bigint AS input_tokens,
            SUM(output_tokens)::bigint AS output_tokens, SUM(cache_read_tokens)::bigint AS cache_read_tokens, SUM(cache_creation_tokens)::bigint AS cache_creation_tokens,
            SUM(cost_usd)::float AS cost_usd
     FROM usage WHERE created_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') - make_interval(days => $1::int - 1)) AT TIME ZONE 'UTC'
     GROUP BY 1`,
    [days]
  );
  const byDay = new Map<string, any>(result.rows.map((r: any) => [r.day, r]));
  const out: AiDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const r = byDay.get(day);
    out.push({
      day,
      calls: r ? Number(r.calls) : 0,
      inputTokens: r ? Number(r.input_tokens) : 0,
      outputTokens: r ? Number(r.output_tokens) : 0,
      cacheReadTokens: r ? Number(r.cache_read_tokens) : 0,
      cacheCreationTokens: r ? Number(r.cache_creation_tokens) : 0,
      costUsd: r ? Number(r.cost_usd) : 0,
    });
  }
  return out;
}

/** Estimated AI spend since `since` in US dollars. */
export async function aiSpendSince(since: Date): Promise<number> {
  const result = await pool.query(
    `SELECT (COALESCE((SELECT SUM(cost_usd) FROM assistant_interactions WHERE created_at >= $1), 0)
           + COALESCE((SELECT SUM(cost_usd) FROM assistant_eval_runs WHERE created_at >= $1), 0))::float AS spend`,
    [since]
  );
  return Number(result.rows[0].spend);
}

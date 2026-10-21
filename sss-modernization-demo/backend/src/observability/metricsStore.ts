import pool from '../database/connection';
import { forget, pendingRows } from './metricsRecorder';

// STORY-027: writes the recorder's minutes to PostgreSQL (once a minute, for the minutes that have closed) and removes what is older than
// the retention period. Nothing here throws at its caller: losing a minute of metrics must never fail a request or stop the timer.

export const RETENTION_DAYS = 30;

let flushing: Promise<void> | undefined;

/**
 * Writes the closed minutes (and the one in progress, when `includeCurrent`: the minute's row is replaced as it fills, so it is complete
 * once the minute closes). A flush already running is waited for, not repeated.
 */
export function flushMetrics(includeCurrent = false): Promise<void> {
  const run = async () => {
    const { route, db, closed, closedDb } = pendingRows(includeCurrent);
    if (route.length === 0 && db.length === 0) {
      forget(closed, closedDb);
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of route) {
        await client.query(
          `INSERT INTO route_metrics_minute (minute, route, requests, errors_4xx, errors_5xx, total_ms, p50_ms, p95_ms, p99_ms, max_ms, hist)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (minute, route) DO UPDATE SET requests = EXCLUDED.requests, errors_4xx = EXCLUDED.errors_4xx, errors_5xx = EXCLUDED.errors_5xx,
             total_ms = EXCLUDED.total_ms, p50_ms = EXCLUDED.p50_ms, p95_ms = EXCLUDED.p95_ms, p99_ms = EXCLUDED.p99_ms, max_ms = EXCLUDED.max_ms, hist = EXCLUDED.hist`,
          [r.minute, r.route.slice(0, 160), r.requests, r.errors4xx, r.errors5xx, r.totalMs, r.p50, r.p95, r.p99, r.maxMs, r.hist]
        );
      }
      for (const d of db) {
        await client.query(
          `INSERT INTO db_metrics_minute (minute, queries, failed, total_ms, p50_ms, p95_ms, max_ms, hist, pool_size, pool_in_use_max, pool_waiting_max)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (minute) DO UPDATE SET queries = EXCLUDED.queries, failed = EXCLUDED.failed, total_ms = EXCLUDED.total_ms, p50_ms = EXCLUDED.p50_ms,
             p95_ms = EXCLUDED.p95_ms, max_ms = EXCLUDED.max_ms, hist = EXCLUDED.hist, pool_size = EXCLUDED.pool_size,
             pool_in_use_max = EXCLUDED.pool_in_use_max, pool_waiting_max = EXCLUDED.pool_waiting_max`,
          [d.minute, d.queries, d.failed, d.totalMs, d.p50, d.p95, d.maxMs, d.hist, d.poolSize, d.poolInUseMax, d.poolWaitingMax]
        );
      }
      await client.query('COMMIT');
      forget(closed, closedDb);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  // One flush at a time; a caller that arrives while one runs gets a second, so the minute it cares about is in the database when it returns
  const next = (flushing ?? Promise.resolve()).then(run, run).catch((error) => {
    console.error('Metrics not written', { message: (error as Error).message });
  });
  flushing = next;
  return next;
}

/** Removes metrics and server errors older than the retention period. Returns how many rows went. */
export async function cleanupMetrics(retentionDays = RETENTION_DAYS): Promise<number> {
  let removed = 0;
  for (const table of ['route_metrics_minute', 'db_metrics_minute']) {
    removed += (await pool.query(`DELETE FROM ${table} WHERE minute < NOW() - make_interval(days => $1::int)`, [retentionDays])).rowCount ?? 0;
  }
  removed += (await pool.query('DELETE FROM server_errors WHERE at < NOW() - make_interval(days => $1::int)', [retentionDays])).rowCount ?? 0;
  return removed;
}

// ---- Server errors

export interface ServerErrorEntry {
  route: string;
  status: number;
  traceId?: string;
  durationMs: number;
  errorName?: string;
  errorCode?: string;
}

const ERRORS_PER_MINUTE = 60;
let errorWindow = { minute: 0, n: 0 };

/** Keeps a response of 500 or more with its trace id. At most 60 a minute are kept, so a failing route cannot fill the table. Never throws. */
export function recordServerError(entry: ServerErrorEntry, now: number = Date.now()): void {
  const minute = Math.floor(now / 60_000);
  if (errorWindow.minute !== minute) errorWindow = { minute, n: 0 };
  if (errorWindow.n >= ERRORS_PER_MINUTE) return;
  errorWindow.n += 1;
  pool
    .query(
      `INSERT INTO server_errors (route, status, trace_id, duration_ms, error_name, error_code) VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.route.slice(0, 160), entry.status, entry.traceId ?? null, entry.durationMs, entry.errorName?.slice(0, 80) ?? null, entry.errorCode?.slice(0, 40) ?? null]
    )
    .catch((error) => console.error('Server error not recorded', { message: (error as Error).message }));
}

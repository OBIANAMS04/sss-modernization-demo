import { performance } from 'node:perf_hooks';
import pool from '../database/connection';
import { AuditAction, recordAudit } from './auditService';

/**
 * STORY-009 data freshness: how long until a change is readable by the next request.
 *
 * Each tracked write reads the affected row's version (Postgres xmin) before it starts, runs, and
 * then, in the background, polls a separate read until a new version is visible. The total time,
 * split into the write itself and the wait for visibility, goes to latency_metrics. The demo reads
 * straight from the primary database, so the wait is one read; the same check measures replica or
 * cache lag once those exist.
 */

export const FRESHNESS_TARGET_MS = 30_000; // a change must be readable within 30 seconds
export const FRESHNESS_SLO_PERCENT = 95; // for at least 95% of updates
const GIVE_UP_MS = 60_000;
const POLL_MS = 25;

export type DataType = 'profile' | 'eligibility' | 'application' | 'case_status' | 'probe';

export const DATA_TYPES: { type: DataType; label: string }[] = [
  { type: 'profile', label: 'Profile updates' },
  { type: 'eligibility', label: 'Eligibility checks' },
  { type: 'application', label: 'Applications' },
  { type: 'case_status', label: 'Case status and assignment' },
  { type: 'probe', label: 'End-to-end check' },
];

/** A query returning one row whose text column `v` changes on every write to the data it covers. */
export interface VersionQuery {
  sql: string;
  params: unknown[];
}

export const versionOf = {
  user: (userId: string): VersionQuery => ({ sql: 'SELECT xmin::text AS v FROM users WHERE id = $1', params: [userId] }),
  eligibility: (userId: string): VersionQuery => ({
    sql: `SELECT string_agg(xmin::text, ',' ORDER BY exemption_type) AS v FROM exemptions WHERE user_id = $1`,
    params: [userId],
  }),
  case: (caseId: string): VersionQuery => ({ sql: 'SELECT xmin::text AS v FROM cases WHERE id = $1', params: [caseId] }),
  probe: (id: string): VersionQuery => ({ sql: 'SELECT xmin::text AS v FROM freshness_probes WHERE id = $1', params: [id] }),
};

export interface Measurement {
  type: DataType;
  operation: string;
  writeMs: number;
  visibleMs: number;
  totalMs: number;
  visible: boolean;
}

async function readVersion(query: VersionQuery | null): Promise<string | null> {
  if (!query) return null;
  const result = await pool.query(query.sql, query.params);
  return result.rows[0]?.v ?? null;
}

/** Polls `read` until it returns a version that is not null and differs from `before`, or gives up. */
export async function waitForNewVersion(
  read: () => Promise<string | null>,
  before: string | null,
  { pollMs = POLL_MS, timeoutMs = GIVE_UP_MS } = {}
): Promise<{ visible: boolean; waitedMs: number }> {
  const start = performance.now();
  for (;;) {
    const version = await read().catch(() => null);
    const waitedMs = performance.now() - start;
    if (version !== null && version !== before) return { visible: true, waitedMs };
    if (waitedMs >= timeoutMs) return { visible: false, waitedMs };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function confirmAndRecord(
  type: DataType,
  operation: string,
  read: () => Promise<string | null>,
  before: string | null,
  writeMs: number
): Promise<Measurement> {
  const { visible, waitedMs } = await waitForNewVersion(read, before);
  const measurement: Measurement = {
    type,
    operation,
    writeMs: Math.round(writeMs),
    visibleMs: Math.round(waitedMs),
    totalMs: Math.round(writeMs + waitedMs),
    visible,
  };
  await pool.query(
    `INSERT INTO latency_metrics (entity_type, operation, latency_ms, write_ms, visible_ms, visible)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [type, operation, measurement.totalMs, measurement.writeMs, measurement.visibleMs, visible]
  );
  // STORY-010: an update that misses the target is an alert, and alerts are audited
  if (!visible || measurement.totalMs > FRESHNESS_TARGET_MS) {
    recordAudit(AuditAction.ALERT_TRIGGERED, 'freshness', 'failure', { details: { ...measurement, targetMs: FRESHNESS_TARGET_MS } });
  }
  return measurement;
}

/**
 * Runs `write` and measures how long until its change is readable. The caller gets the result
 * straight away; confirming visibility and recording the measurement happen in the background.
 * `version(undefined)` names the data before the write (null when it does not exist yet, as for a
 * new application); `version(result)` names it afterwards. Only call this for writes that always
 * change the data: a write that changes nothing is recorded as never becoming visible.
 */
export async function trackWrite<T>(
  type: DataType,
  operation: string,
  version: (result?: T) => VersionQuery | null,
  write: () => Promise<T>
): Promise<T> {
  const before = await readVersion(version()).catch(() => null);
  const started = performance.now();
  const result = await write();
  const writeMs = performance.now() - started;
  confirmAndRecord(type, operation, () => readVersion(version(result)), before, writeMs).catch((error) =>
    console.error('Freshness measurement not recorded', { type, operation, message: (error as Error).message })
  );
  return result;
}

/** End-to-end check: writes a probe row and waits until a separate read sees it. */
export async function runProbe(): Promise<Measurement> {
  await pool.query(`DELETE FROM freshness_probes WHERE created_at < NOW() - INTERVAL '1 day'`);
  const started = performance.now();
  const inserted = await pool.query('INSERT INTO freshness_probes DEFAULT VALUES RETURNING id');
  const writeMs = performance.now() - started;
  const id = String(inserted.rows[0].id);
  return confirmAndRecord('probe', 'write_then_read', () => readVersion(versionOf.probe(id)), null, writeMs);
}

export interface MeasurementRow {
  type: string;
  operation: string;
  totalMs: number;
  writeMs: number | null;
  visibleMs: number | null;
  visible: boolean;
  at: Date;
}

/** Nearest-rank percentile of an ascending list; null when the list is empty. */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sortedAsc.length));
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const formatMs = (ms: number) => {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
};

function stats(rows: MeasurementRow[], targetMs: number) {
  const sorted = rows.map((r) => r.totalMs).sort((a, b) => a - b);
  const within = rows.filter((r) => r.visible && r.totalMs <= targetMs).length;
  return {
    count: rows.length,
    avgMs: rows.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / rows.length) : null,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
    withinTarget: within,
    withinRate: rows.length ? round2((within / rows.length) * 100) : null,
  };
}

/**
 * Freshness per data type and overall (probes are reported on their own and left out of the
 * overall figures). A type is over target when its p95 exceeds the target or fewer than the SLO
 * share of its updates were readable in time; any such type, or the overall share falling short,
 * raises the alert.
 */
export function summarize(rows: MeasurementRow[], targetMs = FRESHNESS_TARGET_MS, sloPercent = FRESHNESS_SLO_PERCENT) {
  const updates = rows.filter((r) => r.type !== 'probe');
  const overall = stats(updates, targetMs);

  const types = DATA_TYPES.map(({ type, label }) => {
    const ofType = rows.filter((r) => r.type === type).sort((a, b) => b.at.getTime() - a.at.getTime());
    const s = stats(ofType, targetMs);
    const over = s.count > 0 && ((s.p95Ms ?? 0) > targetMs || (s.withinRate ?? 100) < sloPercent);
    return {
      type,
      label,
      ...s,
      lastAt: ofType[0]?.at ?? null,
      lastMs: ofType[0]?.totalMs ?? null,
      status: s.count === 0 ? 'none' : over ? 'over' : 'ok',
    };
  });

  const problems = types
    .filter((t) => t.status === 'over')
    .map((t) =>
      (t.p95Ms ?? 0) > targetMs
        ? `${t.label}: p95 is ${formatMs(t.p95Ms ?? 0)}, over the ${formatMs(targetMs)} target.`
        : `${t.label}: only ${t.withinRate}% readable within ${formatMs(targetMs)} (target ${sloPercent}%).`
    );
  if (overall.withinRate !== null && overall.withinRate < sloPercent) {
    problems.push(`Overall, only ${overall.withinRate}% of updates were readable within ${formatMs(targetMs)} (target ${sloPercent}%).`);
  }

  const slowest = [...rows]
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 10)
    .map((r) => ({
      at: r.at,
      type: r.type,
      label: DATA_TYPES.find((t) => t.type === r.type)?.label ?? r.type,
      operation: r.operation,
      writeMs: r.writeMs,
      visibleMs: r.visibleMs,
      totalMs: r.totalMs,
      visible: r.visible,
    }));

  return { targetMs, sloPercent, overall, types, slowest, alert: problems.length ? problems.join(' ') : null };
}

export async function getFreshnessDashboard(hours = 24) {
  const windowHours = Math.min(Math.max(Math.floor(hours) || 24, 1), 720);
  // latency_metrics.timestamp has no time zone: read it in the session's zone so it stays exact.
  const result = await pool.query(
    `SELECT entity_type, operation, latency_ms, write_ms, visible_ms, visible,
            timestamp AT TIME ZONE current_setting('TimeZone') AS at
     FROM latency_metrics
     WHERE write_ms IS NOT NULL AND timestamp > NOW() - make_interval(hours => $1::int)
     ORDER BY timestamp DESC
     LIMIT 20000`,
    [windowHours]
  );
  const rows: MeasurementRow[] = result.rows.map((r: any) => ({
    type: r.entity_type,
    operation: r.operation,
    totalMs: r.latency_ms,
    writeMs: r.write_ms,
    visibleMs: r.visible_ms,
    visible: r.visible,
    at: new Date(r.at),
  }));
  return { windowHours, ...summarize(rows) };
}

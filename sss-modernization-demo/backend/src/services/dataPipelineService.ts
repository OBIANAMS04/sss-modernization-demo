import pool from '../database/connection';
import { FRESHNESS_TARGET_MS, percentile } from './freshnessService';

// STORY-005 (R0): the status of the data a person sees. The demo reads every page straight from the database, with no cache in between,
// so there is nothing to refresh: what the story asked a Redis cache and a pipeline to do (data current within 30 seconds) is met by
// reading the source, and STORY-009 measures it on every real write (from the start of the write until a separate read sees it).
// A cache would add a way to show stale data, not remove one. This reports the two things a person can use: when their own records
// last changed, and how quickly changes have been becoming visible across the service, as green, yellow or red.

/** The story's bands: green under 10 s, yellow 10 to 20 s, red over 20 s (the target is 30 s for 95% of updates, STORY-009). */
export const GREEN_UNDER_MS = 10_000;
export const YELLOW_UNDER_MS = 20_000;
/** How far back the service-wide figure looks. */
export const WINDOW_MINUTES = 60;

export type FreshnessLevel = 'green' | 'yellow' | 'red' | 'unknown';

export function levelFor(p95Ms: number | null): FreshnessLevel {
  if (p95Ms === null) return 'unknown';
  if (p95Ms < GREEN_UNDER_MS) return 'green';
  if (p95Ms <= YELLOW_UNDER_MS) return 'yellow';
  return 'red';
}

export interface PipelineStatus {
  /** When this answer was read from the database. */
  readAt: string;
  /** Where the data comes from: always the database itself. */
  source: 'database';
  /** When the caller's own records last changed (profile, eligibility, cases); null if nothing yet. */
  lastChange: string | null;
  /** Milliseconds between the caller's last change and this read. */
  dataAgeMs: number | null;
  freshness: {
    level: FreshnessLevel;
    /** The 95th percentile of the time for a change to become readable, over the window; null with no measured writes. */
    p95Ms: number | null;
    measured: number;
    windowMinutes: number;
    targetMs: number;
  };
}

/** The caller's data status. Reads only the caller's own timestamps and service-wide timings; no other person's data. */
export async function getPipelineStatus(userId: string, now: Date = new Date()): Promise<PipelineStatus> {
  const [own, timings] = await Promise.all([
    pool.query(
      `SELECT GREATEST(
         (SELECT updated_at FROM users WHERE id = $1),
         (SELECT MAX(updated_at) FROM exemptions WHERE user_id = $1),
         (SELECT MAX(updated_at) FROM cases WHERE user_id = $1)
       ) AT TIME ZONE current_setting('TimeZone') AS last_change`,
      [userId]
    ),
    pool.query(
      `SELECT latency_ms FROM latency_metrics
       WHERE write_ms IS NOT NULL AND visible AND timestamp > NOW() - make_interval(mins => $1::int)
       ORDER BY latency_ms`,
      [WINDOW_MINUTES]
    ),
  ]);
  const last: Date | null = own.rows[0]?.last_change ? new Date(own.rows[0].last_change) : null;
  const sorted = timings.rows.map((r: any) => Number(r.latency_ms));
  const p95 = percentile(sorted, 95);
  return {
    readAt: now.toISOString(),
    source: 'database',
    lastChange: last ? last.toISOString() : null,
    dataAgeMs: last ? Math.max(0, now.getTime() - last.getTime()) : null,
    freshness: { level: levelFor(p95), p95Ms: p95, measured: sorted.length, windowMinutes: WINDOW_MINUTES, targetMs: FRESHNESS_TARGET_MS },
  };
}

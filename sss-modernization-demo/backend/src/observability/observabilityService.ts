import pool from '../database/connection';
import { dailyBudgetUsd } from '../services/aiPricing';
import { quantileFromHist } from './histogram';
import { flushMetrics, RETENTION_DAYS } from './metricsStore';
import {
  AiDay, DbFigures, LatencyRow, SeriesPoint, ServerErrorRow, aiUsageByDay, databaseSince, latencyRows, recentServerErrors, routesSince, seriesSince, trafficSince,
} from './metricsQueries';
import { RUNBOOK, RunbookEntry, SLOS, SloDefinition, SloId, SloResult, TARGETS, runbookIdOf } from './slo';
import { evaluateAll } from './sloService';
import { exportEndpoint } from './exportSetting';

// STORY-028: everything the Observability page shows, in one response for administrators.

const startedAt = Date.now();

export interface Health {
  status: 'ok' | 'degraded';
  database: { ok: boolean; latencyMs: number | null };
  migrations: { applied: number; latest: string | null } | null;
  commit: string;
  startedAt: string;
  uptimeSeconds: number;
  memoryRssMb: number;
  pool: { size: number; idle: number; waiting: number };
  tracing: { exportsTo: 'nowhere' | 'an OTLP endpoint'; };
}

export interface WindowSummary {
  requests: number;
  errors4xx: number;
  errors5xx: number;
  /** Server errors as a share of requests, 0 to 1. */
  errorRate: number;
  /** Requests that did not end in a server error, 0 to 1; null when there were none. */
  availability: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface AlertView {
  id: string;
  kind: string;
  key: string;
  message: string;
  openedAt: string;
  clearedAt: string | null;
  /** The runbook entry that says what the alert means and what to check first. */
  runbook: SloId;
}

export interface ObservabilityView {
  generatedAt: string;
  health: Health;
  objectives: { definitions: SloDefinition[]; traffic: SloResult[]; aiQuality: { id: SloId; open: number }[] };
  traffic: { last24h: WindowSummary; last7d: WindowSummary; hourly: SeriesPoint[]; daily: SeriesPoint[] };
  latency: { targetMs: number; routes: LatencyRow[]; slowest: LatencyRow[] };
  database: { last24h: DbFigures };
  recentErrors: ServerErrorRow[];
  ai: { budgetUsd: number; days: AiDay[]; today: AiDay };
  alerts: { open: AlertView[]; history: AlertView[] };
  runbook: RunbookEntry[];
  retentionDays: number;
}

async function healthNow(): Promise<Health> {
  const probe = Date.now();
  let database = { ok: true, latencyMs: null as number | null };
  let migrations: Health['migrations'] = null;
  try {
    const r = await pool.query('SELECT COUNT(*)::int AS applied, MAX(filename) AS latest FROM schema_migrations');
    database = { ok: true, latencyMs: Date.now() - probe };
    migrations = { applied: r.rows[0].applied, latest: r.rows[0].latest };
  } catch {
    database = { ok: false, latencyMs: null };
  }
  return {
    status: database.ok ? 'ok' : 'degraded',
    database,
    migrations,
    commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7),
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    pool: { size: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    tracing: { exportsTo: exportEndpoint() ? 'an OTLP endpoint' : 'nowhere' },
  };
}

function summarise(t: { requests: number; errors4xx: number; errors5xx: number; hist: number[] }): WindowSummary {
  return {
    requests: t.requests,
    errors4xx: t.errors4xx,
    errors5xx: t.errors5xx,
    errorRate: t.requests > 0 ? t.errors5xx / t.requests : 0,
    availability: t.requests > 0 ? 1 - t.errors5xx / t.requests : null,
    p50Ms: quantileFromHist(t.hist, 0.5),
    p95Ms: quantileFromHist(t.hist, 0.95),
    p99Ms: quantileFromHist(t.hist, 0.99),
  };
}

const toAlertView = (r: any): AlertView => ({
  id: r.id, kind: r.kind, key: r.key, message: r.message, openedAt: r.opened_at, clearedAt: r.cleared_at, runbook: runbookIdOf(r.kind, r.key),
});

export async function getObservability(): Promise<ObservabilityView> {
  // The minute in progress is written first so the page is current to the second
  await flushMetrics(true);
  const day = new Date(Date.now() - 24 * 3_600_000);
  const week = new Date(Date.now() - 7 * 86_400_000);
  const [health, t24, t7, routes, hourly, daily, db, errors, aiDays, evaluated, alertRows] = await Promise.all([
    healthNow(),
    trafficSince(day),
    trafficSince(week),
    routesSince(day),
    seriesSince(new Date(Date.now() - 24 * 3_600_000), 'hour', 24),
    seriesSince(week, 'day', 7),
    databaseSince(day),
    recentServerErrors(20),
    aiUsageByDay(7),
    evaluateAll(),
    pool.query(`SELECT * FROM assistant_quality_alerts WHERE cleared_at IS NULL OR cleared_at >= NOW() - INTERVAL '30 days' ORDER BY opened_at DESC LIMIT 60`),
  ]);
  const alerts = alertRows.rows.map(toAlertView);
  const rows = latencyRows(routes).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));
  const open = (kinds: string[]) => alerts.filter((a: AlertView) => !a.clearedAt && kinds.includes(a.kind)).length;
  return {
    generatedAt: new Date().toISOString(),
    health,
    objectives: {
      definitions: SLOS,
      traffic: evaluated.results,
      aiQuality: [
        { id: 'ai-drift', open: open(['signal', 'eval']) },
        { id: 'ai-fairness', open: open(['fairness']) },
      ],
    },
    traffic: { last24h: summarise(t24), last7d: summarise(t7), hourly, daily },
    latency: { targetMs: TARGETS.p95Ms, routes: rows, slowest: rows.filter((r) => r.requests > 0).slice(0, 5) },
    database: { last24h: db },
    recentErrors: errors,
    ai: { budgetUsd: dailyBudgetUsd(), days: aiDays, today: aiDays[aiDays.length - 1] },
    alerts: { open: alerts.filter((a: AlertView) => !a.clearedAt), history: alerts.filter((a: AlertView) => a.clearedAt) },
    runbook: RUNBOOK,
    retentionDays: RETENTION_DAYS,
  };
}

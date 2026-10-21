import pool from '../database/connection';
import { AuditAction, logAuditEvent } from '../services/auditService';
import { dailyBudgetUsd } from '../services/aiPricing';
import { flushMetrics } from './metricsStore';
import { aiSpendSince, routesSince, trafficSince, worstRoute } from './metricsQueries';
import { quantileFromHist } from './histogram';
import { Measures, SLO_WINDOWS, SloResult, SloWindow, evaluateWindow, wantedAlerts } from './slo';

// STORY-029: measures the service over the 1-hour and 24-hour windows, evaluates every objective, and keeps the alerts in step: a breach
// opens an alert (an audit event and a notification to every administrator) unless one is already open, and an alert whose objective
// has recovered is closed (an audit event). Alerts are rows of assistant_quality_alerts with kind 'slo', the table of STORY-021.

export async function measure(window: SloWindow, now: number = Date.now()): Promise<Measures> {
  const since = new Date(now - SLO_WINDOWS[window] * 60_000);
  const [total, routes, spend] = await Promise.all([trafficSince(since), routesSince(since), aiSpendSince(since)]);
  return {
    requests: total.requests,
    errors5xx: total.errors5xx,
    p95Ms: quantileFromHist(total.hist, 0.95),
    worstRoute: worstRoute(routes),
    aiSpendUsd: spend,
  };
}

/** Every traffic and spend objective over both windows. */
export async function evaluateAll(now: number = Date.now()): Promise<{ results: SloResult[]; measures: Record<SloWindow, Measures> }> {
  const windows = Object.keys(SLO_WINDOWS) as SloWindow[];
  const measured = await Promise.all(windows.map((w) => measure(w, now)));
  const budget = dailyBudgetUsd();
  const measures = Object.fromEntries(windows.map((w, i) => [w, measured[i]])) as Record<SloWindow, Measures>;
  return { results: windows.flatMap((w) => evaluateWindow(w, measures[w], budget)), measures };
}

export interface OpenedOrCleared {
  opened: string[];
  cleared: string[];
}

/** Opens an alert for each breach that has none open and closes the open ones that have recovered. A lasting breach alerts once. */
export async function syncSloAlerts(results: SloResult[]): Promise<OpenedOrCleared> {
  const wanted = new Map(wantedAlerts(results).map((a) => [a.key, a]));
  const open = (await pool.query(`SELECT id, key FROM assistant_quality_alerts WHERE kind = 'slo' AND cleared_at IS NULL`)).rows as { id: string; key: string }[];
  const openKeys = new Set(open.map((a) => a.key));
  const changed: OpenedOrCleared = { opened: [], cleared: [] };

  for (const [key, alert] of wanted) {
    if (openKeys.has(key)) continue;
    const inserted = await pool.query(
      `INSERT INTO assistant_quality_alerts (kind, key, message) VALUES ('slo', $1, $2) ON CONFLICT (kind, key) WHERE cleared_at IS NULL DO NOTHING RETURNING id`,
      [key, alert.message]
    );
    if (inserted.rows.length === 0) continue; // another check opened it first
    changed.opened.push(key);
    await logAuditEvent(AuditAction.SLO_ALERT, 'observability', 'failure', {
      resourceId: inserted.rows[0].id,
      details: { alertId: inserted.rows[0].id, objective: alert.id, key, phase: 'opened', message: alert.message },
    });
    await pool.query(`INSERT INTO notifications (user_id, message) SELECT id, $1 FROM users WHERE role = 'admin'`, [`Service alert: ${alert.message} Open Observability to see it.`]);
  }
  for (const a of open) {
    if (wanted.has(a.key)) continue;
    const cleared = await pool.query('UPDATE assistant_quality_alerts SET cleared_at = NOW() WHERE id = $1 AND cleared_at IS NULL RETURNING id', [a.id]);
    if (cleared.rows.length) {
      changed.cleared.push(a.key);
      await logAuditEvent(AuditAction.SLO_ALERT, 'observability', 'success', {
        resourceId: a.id,
        details: { alertId: a.id, objective: a.key.split(':')[0], key: a.key, phase: 'cleared' },
      });
    }
  }
  return changed;
}

let running: Promise<{ results: SloResult[]; changed: OpenedOrCleared }> | undefined;

/**
 * Writes the minute in progress, measures, evaluates and syncs the alerts. One at a time: a second caller gets the run in progress.
 * Used by the timer and by the administrator's "Check now".
 */
export function checkSlos(): Promise<{ results: SloResult[]; changed: OpenedOrCleared }> {
  running ??= (async () => {
    await flushMetrics(true);
    const { results } = await evaluateAll();
    return { results, changed: await syncSloAlerts(results) };
  })().finally(() => {
    running = undefined;
  });
  return running;
}

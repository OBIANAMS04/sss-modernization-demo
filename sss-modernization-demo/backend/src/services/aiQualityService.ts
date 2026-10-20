import pool from '../database/connection';
import { AuditAction, logAuditEvent } from './auditService';
import { ChangeMarker, listMarkers, noteChange } from './changeMarkers';
import { BASELINE_DAYS, RECENT_DAYS, SIGNALS, SignalCounts, SignalDrift, SignalKey, evaluateDrift, signalValues } from './driftSignals';
import { Failure, RunRow, belowBaseline, checkThresholds, failuresOf, listRuns, toRun } from './evalRunService';
import { OutcomeReport, getOutcomes } from './outcomeMonitoring';
import { getCorpusInfo } from './policyCorpus';

// STORY-021 and 025: the AI Quality page's data, and the drift alerts. Quality signals are computed from the real answers (mode 'ai') in
// assistant_interactions: a day's counts for the trend, and the last 7 days against the 28 before them for drift. An alert opens once
// (an audit event and a notification to every administrator) and stays open until what raised it clears.

export const TREND_DAYS = RECENT_DAYS + BASELINE_DAYS;

// The counts that make up a SignalCounts, over the completed answers in 'ai' mode. A withheld answer is level 2; "level 1" is an answer that
// was shown with the case-manager note (a question the documents do not answer has level 1 as well, but it is counted as a no-answer).
const COUNTS = `
  COUNT(*)::int AS answers,
  COUNT(*) FILTER (WHERE grounding->>'grounded' IS NOT NULL)::int AS checked,
  COUNT(*) FILTER (WHERE grounding->>'grounded' = 'true')::int AS grounded,
  COUNT(*) FILTER (WHERE level = 2)::int AS withheld,
  COUNT(*) FILTER (WHERE level = 1 AND status = 'shown')::int AS level1,
  COUNT(*) FILTER (WHERE status = 'no-answer')::int AS no_answer,
  COUNT(*) FILTER (WHERE status = 'shown' AND answer IS NOT NULL)::int AS with_text,
  COALESCE(SUM(jsonb_array_length(citations)) FILTER (WHERE status = 'shown' AND answer IS NOT NULL), 0)::int AS citations,
  COALESCE(SUM(length(answer)) FILTER (WHERE status = 'shown' AND answer IS NOT NULL), 0)::int AS characters,
  COUNT(*) FILTER (WHERE feedback IN ('not-helpful', 'problem'))::int AS negative,
  COUNT(*) FILTER (WHERE feedback = 'problem')::int AS reported,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS p95`;

const REAL_ANSWERS = `mode = 'ai' AND status NOT IN ('pending', 'error')`;

const toCounts = (r: any): SignalCounts => ({
  answers: r.answers, checked: r.checked, grounded: r.grounded, withheld: r.withheld, level1: r.level1, noAnswer: r.no_answer,
  withText: r.with_text, citations: r.citations, characters: r.characters, negative: r.negative, reported: r.reported,
  p95LatencyMs: r.p95 === null || r.p95 === undefined ? null : Number(r.p95),
});

const EMPTY: SignalCounts = { answers: 0, checked: 0, grounded: 0, withheld: 0, level1: 0, noAnswer: 0, withText: 0, citations: 0, characters: 0, negative: 0, reported: 0, p95LatencyMs: null };

export interface TrendDay {
  /** YYYY-MM-DD, UTC. */
  day: string;
  answers: number;
  values: Record<SignalKey, number | null>;
}

/** The last 35 days (UTC), oldest first, the empty ones included, each with its answers and signal values. */
export async function getDailySignals(): Promise<TrendDay[]> {
  const result = await pool.query(
    `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, ${COUNTS}
     FROM assistant_interactions
     WHERE ${REAL_ANSWERS} AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - make_interval(days => $1::int)
     GROUP BY 1`,
    [TREND_DAYS - 1]
  );
  const byDay = new Map<string, SignalCounts>(result.rows.map((r: any) => [r.day, toCounts(r)]));
  const today = new Date();
  return Array.from({ length: TREND_DAYS }, (_, i) => {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (TREND_DAYS - 1 - i))).toISOString().slice(0, 10);
    const counts = byDay.get(day) ?? EMPTY;
    return { day, answers: counts.answers, values: signalValues(counts) };
  });
}

/** The last 7 days and the 28 days before, as counts (p95 over each window's own answers). */
export async function getWindowCounts(): Promise<{ recent: SignalCounts; baseline: SignalCounts }> {
  const result = await pool.query(
    `SELECT window_name, ${COUNTS}
     FROM (
       SELECT CASE WHEN created_at >= NOW() - make_interval(days => $1::int) THEN 'recent' ELSE 'baseline' END AS window_name, *
       FROM assistant_interactions
       WHERE ${REAL_ANSWERS} AND created_at >= NOW() - make_interval(days => $2::int)
     ) windowed
     GROUP BY window_name`,
    [RECENT_DAYS, RECENT_DAYS + BASELINE_DAYS]
  );
  const named = (name: string): SignalCounts => {
    const row = result.rows.find((r: any) => r.window_name === name);
    return row ? toCounts(row) : EMPTY;
  };
  return { recent: named('recent'), baseline: named('baseline') };
}

// ---- Alerts

export interface QualityAlert {
  id: string;
  kind: 'signal' | 'eval' | 'fairness';
  key: string;
  message: string;
  openedAt: string;
  clearedAt: string | null;
}

const toAlert = (r: any): QualityAlert => ({ id: r.id, kind: r.kind, key: r.key, message: r.message, openedAt: r.opened_at, clearedAt: r.cleared_at });

/** What is wrong with the latest completed run of a kind: a threshold or criterion it missed, or (evaluation) a score far under the baseline. */
export function runProblems(run: RunRow | undefined, baseline: RunRow | undefined): string[] {
  if (!run || run.status !== 'completed') return [];
  if (run.kind === 'fairness') return run.passed === false ? ['The latest counterfactual fairness run missed its criteria.'] : [];
  const misses = checkThresholds(run.scores, run.mode)
    .filter((c) => !c.passed)
    .map((c) => `${c.name} is ${c.value === null ? 'missing' : `${Math.round(c.value * 1000) / 10}%`}, under the threshold of ${c.min * 100}%.`);
  const under = baseline && baseline.id !== run.id && baseline.mode === run.mode ? belowBaseline(run.scores, baseline.scores) : [];
  return [...misses, ...under];
}

/**
 * Opens an alert for each thing that has drifted and has none open, and clears the open ones whose cause is gone. Opening is an audit
 * event and a notification to every administrator; so is clearing an audit event. A drift that lasts alerts once. Never throws at its
 * caller: a failure here is logged and the page still loads.
 */
export async function syncAlerts(drift: SignalDrift[], evalRun: RunRow | undefined, baseline: RunRow | undefined, fairnessRun: RunRow | undefined): Promise<QualityAlert[]> {
  const wanted = new Map<string, { kind: QualityAlert['kind']; key: string; message: string }>();
  for (const d of drift.filter((x) => x.state === 'drift')) wanted.set(`signal:${d.key}`, { kind: 'signal', key: d.key, message: d.message! });
  const evalProblems = runProblems(evalRun, baseline);
  if (evalProblems.length) wanted.set('eval:latest-run', { kind: 'eval', key: 'latest-run', message: `The latest evaluation run is a drift: ${evalProblems.join(' ')}` });
  const fairnessProblems = runProblems(fairnessRun, undefined);
  if (fairnessProblems.length) wanted.set('fairness:latest-run', { kind: 'fairness', key: 'latest-run', message: fairnessProblems.join(' ') });

  const open = (await pool.query('SELECT * FROM assistant_quality_alerts WHERE cleared_at IS NULL')).rows;
  const openKeys = new Set(open.map((a: any) => `${a.kind}:${a.key}`));

  for (const [id, alert] of wanted) {
    if (openKeys.has(id)) continue;
    const inserted = await pool.query(
      `INSERT INTO assistant_quality_alerts (kind, key, message) VALUES ($1, $2, $3) ON CONFLICT (kind, key) WHERE cleared_at IS NULL DO NOTHING RETURNING id`,
      [alert.kind, alert.key, alert.message]
    );
    if (inserted.rows.length === 0) continue; // another request opened it first
    await logAuditEvent(AuditAction.AI_DRIFT_ALERT, 'assistant', 'failure', { resourceId: inserted.rows[0].id, details: { alertId: inserted.rows[0].id, kind: alert.kind, key: alert.key, phase: 'opened' } });
    await pool.query(`INSERT INTO notifications (user_id, message) SELECT id, $1 FROM users WHERE role = 'admin'`, [`AI quality alert: ${alert.message} Open AI Quality to see it.`]);
  }
  for (const a of open) {
    if (wanted.has(`${a.kind}:${a.key}`)) continue;
    const cleared = await pool.query('UPDATE assistant_quality_alerts SET cleared_at = NOW() WHERE id = $1 AND cleared_at IS NULL RETURNING id', [a.id]);
    if (cleared.rows.length) {
      await logAuditEvent(AuditAction.AI_DRIFT_ALERT, 'assistant', 'success', { resourceId: a.id, details: { alertId: a.id, kind: a.kind, key: a.key, phase: 'cleared' } });
    }
  }

  const now = await pool.query(
    `SELECT * FROM assistant_quality_alerts WHERE cleared_at IS NULL OR cleared_at >= NOW() - INTERVAL '30 days' ORDER BY opened_at DESC LIMIT 30`
  );
  return now.rows.map(toAlert);
}

// ---- The page

export interface TrendSeries {
  key: SignalKey;
  label: string;
  unit: string;
  values: (number | null)[];
}

export interface EvaluationView {
  runs: RunRow[];
  latest: RunRow | null;
  baseline: RunRow | null;
  /** How the latest run reads against the thresholds and the baseline. */
  thresholds: ReturnType<typeof checkThresholds>;
  belowBaseline: string[];
  failures: Failure[];
}

export interface QualityView {
  generatedAt: string;
  windows: { recentDays: number; baselineDays: number; minAnswers: number };
  signals: SignalDrift[];
  trend: { days: string[]; answers: number[]; series: TrendSeries[] };
  markers: ChangeMarker[];
  alerts: QualityAlert[];
  evaluation: EvaluationView;
}

/** Everything the AI Quality page shows apart from fairness. Also keeps the change markers and the alerts up to date. */
export async function getQualityView(): Promise<QualityView> {
  const [daily, windows, evalRuns, fairnessRuns, corpus, latestModel] = await Promise.all([
    getDailySignals(),
    getWindowCounts(),
    listRuns('eval', 10),
    listRuns('fairness', 5),
    getCorpusInfo(),
    pool.query(`SELECT model, created_at FROM assistant_interactions WHERE mode IN ('ai', 'stub') AND model IS NOT NULL ORDER BY created_at DESC LIMIT 1`),
  ]);
  // Markers: the policy documents' version now, and the model that answered last
  await noteChange('corpus', corpus.version).catch(() => {});
  if (latestModel.rows[0]) await noteChange('model', latestModel.rows[0].model, new Date(latestModel.rows[0].created_at)).catch(() => {});

  const signals = evaluateDrift(windows.recent, windows.baseline);
  const completed = evalRuns.filter((r) => r.status === 'completed');
  const latest = completed[0];
  const baseline = latest ? completed.find((r) => r.isBaseline && r.mode === latest.mode) ?? (await baselineFor(latest)) : undefined;
  const alerts = await syncAlerts(signals, latest, baseline, fairnessRuns.find((r) => r.status === 'completed')).catch((error) => {
    console.error('AI quality alert check failed', { message: error instanceof Error ? error.message : String(error) });
    return [] as QualityAlert[];
  });
  const markers = await listMarkers(TREND_DAYS);

  return {
    generatedAt: new Date().toISOString(),
    windows: { recentDays: RECENT_DAYS, baselineDays: BASELINE_DAYS, minAnswers: 20 },
    signals,
    trend: {
      days: daily.map((d) => d.day),
      answers: daily.map((d) => d.answers),
      series: SIGNALS.map((s) => ({ key: s.key, label: s.label, unit: s.unit, values: daily.map((d) => d.values[s.key]) })),
    },
    markers,
    alerts,
    evaluation: {
      runs: evalRuns,
      latest: latest ?? null,
      baseline: baseline ?? null,
      thresholds: latest ? checkThresholds(latest.scores, latest.mode) : [],
      belowBaseline: latest && baseline && baseline.id !== latest.id && baseline.mode === latest.mode ? belowBaseline(latest.scores, baseline.scores) : [],
      failures: latest ? await failuresOf(latest.id) : [],
    },
  };
}

/** The baseline run of a mode, which may be older than the ten runs listed. */
async function baselineFor(run: RunRow): Promise<RunRow | undefined> {
  const result = await pool.query(
    `SELECT id, kind, status, model, corpus_version, mode, retrieval_hit_rate, fact_accuracy, citation_validity, grounded_rate, passed, summary, error,
            started_by_email, is_baseline, created_at, finished_at
     FROM assistant_eval_runs WHERE kind = 'eval' AND mode = $1 AND is_baseline AND status = 'completed' LIMIT 1`,
    [run.mode]
  );
  return result.rows[0] ? toRun(result.rows[0]) : undefined;
}

// ---- Fairness

export interface FairnessView {
  /** The latest counterfactual run, with the figures of the assistant check; null before the first. */
  latest: RunRow | null;
  runs: RunRow[];
  /** Outcomes of real decisions by age band and region. */
  outcomes: OutcomeReport;
  /** What the demo does not collect, and why: shown on the page as it is written here. */
  statement: { heading: string; paragraphs: string[]; notCollected: string[] };
}

export const FAIRNESS_STATEMENT = {
  heading: 'What this demo does not collect, and why',
  notCollected: ['Race', 'Sex or gender', 'Ethnicity', 'Religion', 'Disability', 'National origin'],
  paragraphs: [
    'The demo does not collect any of these, and this page does not add them. Nothing in an exemption or a compliance decision needs them, and holding them would create a risk without a purpose. So no result here is split by them.',
    'Fairness is checked in two ways instead. First, counterfactual tests: the rules and the assistant are given the same question or the same person with only an irrelevant detail changed (a name that suggests a gender or an ethnicity, a place, how a phone number or address is written, a mention of a disability or of English fluency), and the outcome must not change. Second, monitoring of the groups the demo already holds: age band (from the date of birth) and region (from the state in the address).',
    'Age is an input to the Type A (senior) exemption by design, so a lower approval rate for younger people is expected there, and the table shows it rather than hiding it. A flag means "look at this", not "this is unfair".',
    'The limits are plain. Counterfactual tests catch a rule or an answer that reacts to a detail; they cannot find a difference between groups the demo does not record. A real deployment would need a lawful, separately governed way to measure those groups, with the people\'s consent where the law requires it.',
  ],
};

export async function getFairnessView(): Promise<FairnessView> {
  const [runs, outcomes] = await Promise.all([listRuns('fairness', 10), getOutcomes()]);
  return {
    latest: runs.find((r) => r.status === 'completed') ?? runs[0] ?? null,
    runs,
    outcomes,
    statement: FAIRNESS_STATEMENT,
  };
}


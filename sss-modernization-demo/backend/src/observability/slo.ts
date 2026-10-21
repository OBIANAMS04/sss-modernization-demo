// STORY-029: the service level objectives, defined in one place. Everything that evaluates, shows or documents an objective reads this
// file: the timer (scheduler.ts), the Observability page, and the runbook (docs/RUNBOOK-ALERTS.md has one entry per id below; a test
// fails when they drift apart).
//
// Each traffic objective is evaluated over a 1-hour and a 24-hour window. With fewer than MIN_REQUESTS requests in a window there is
// not enough to judge, so the objective is "no data" (not breached): a quiet demo must not alert on one failed request.

export const MIN_REQUESTS = 20;
export const SLO_WINDOWS = { '1h': 60, '24h': 1440 } as const;
export type SloWindow = keyof typeof SLO_WINDOWS;

export const TARGETS = {
  /** Share of requests that did not end in a server error (5xx). */
  availability: 0.995,
  /** The 95th percentile of request duration, in milliseconds, must be under this. */
  p95Ms: 2000,
  /** No route may fail more than this share of its requests with a server error. */
  errorRate: 0.01,
  /** Spend in the last hour may not exceed this share of the daily budget (a burn rate of six times the daily average). */
  aiHourShareOfDaily: 0.25,
} as const;

export type SloId = 'availability' | 'latency' | 'error-rate' | 'ai-spend' | 'ai-drift' | 'ai-fairness';

export interface SloDefinition {
  id: SloId;
  title: string;
  objective: string;
  /** Where it comes from: evaluated here over the windows, or raised by the AI quality checks of STORY-021 and 025. */
  source: 'traffic' | 'ai-quality';
}

export const SLOS: SloDefinition[] = [
  { id: 'availability', title: 'Availability', objective: 'At least 99.5% of requests do not end in a server error (5xx).', source: 'traffic' },
  { id: 'latency', title: 'Latency', objective: 'The 95th percentile of request duration is under 2 seconds.', source: 'traffic' },
  { id: 'error-rate', title: 'Error rate', objective: 'No route fails more than 1% of its requests with a server error.', source: 'traffic' },
  { id: 'ai-spend', title: 'AI spend', objective: 'AI spend stays under the daily budget (AI_DAILY_BUDGET_USD, default $2), and no hour uses more than a quarter of it.', source: 'traffic' },
  { id: 'ai-drift', title: 'Answer quality (drift)', objective: 'No AI quality signal or evaluation run has drifted from its baseline (STORY-021).', source: 'ai-quality' },
  { id: 'ai-fairness', title: 'Answer fairness', objective: 'The latest counterfactual fairness run meets its criteria (STORY-025).', source: 'ai-quality' },
];

export interface RunbookEntry {
  id: SloId;
  title: string;
  meaning: string;
  firstChecks: string[];
  close: string;
}

/** One entry per alert. docs/RUNBOOK-ALERTS.md says the same at more length. */
export const RUNBOOK: RunbookEntry[] = [
  {
    id: 'availability',
    title: 'Availability below 99.5%',
    meaning: 'More than 0.5% of requests in the window ended in a server error (5xx): people were shown "Internal server error" or the service was unavailable.',
    firstChecks: [
      'Open "Recent server errors" on this page: which routes, and are they one route or many?',
      'Copy a trace id from there and find it in the logs (every line carries trace_id).',
      'Check the database: the health panel above, and whether a deploy or restart happened (the audit log shows DEPLOYMENT and SERVER_START).',
    ],
    close: 'Fix the cause. The alert closes by itself once the window is back at 99.5% or better; the 1-hour alert clears within the hour, the 24-hour one when the errors age out of the day.',
  },
  {
    id: 'latency',
    title: 'p95 latency over 2 seconds',
    meaning: 'One request in twenty or more took longer than 2 seconds in the window.',
    firstChecks: [
      'See "Latency by route" and "Slowest routes": is one route responsible?',
      'Check "Database" on this page: slow queries or a pool with requests waiting point at PostgreSQL, not the code.',
      'On the free Render plan, check whether the service had just woken from idle; the first requests after a wake are slow.',
    ],
    close: 'Fix or scale the slow route or query. The alert closes when the window\'s p95 is under 2 seconds again.',
  },
  {
    id: 'error-rate',
    title: 'A route failing more than 1% of requests',
    meaning: 'One route (named in the alert) ended more than 1% of its requests in a server error, even if the whole service looks healthy.',
    firstChecks: [
      'The alert names the route. Find its entries under "Recent server errors" and note the error class and code (for example 22P02 is an invalid value sent to the database).',
      'Reproduce with the trace id\'s log lines; the route template tells which code path.',
    ],
    close: 'Fix the route. The alert closes when no route is above 1% in the window.',
  },
  {
    id: 'ai-spend',
    title: 'AI spend over budget',
    meaning: 'The estimated cost of model calls in the last 24 hours is over the daily budget, or the last hour alone used more than a quarter of it.',
    firstChecks: [
      'See "AI usage per day": calls, tokens and cost, and whether an evaluation or fairness run (each asks the model every question) caused it.',
      'Check the assistant questions per person (the daily limit is AI_DAILY_LIMIT) and whether the prompt cache is being read (cache read tokens near zero means every call paid full price).',
    ],
    close: 'Wait for the spend to age out of the window, or raise AI_DAILY_BUDGET_USD in the hosting dashboard if the spend was intended. Estimates are not invoices: the provider\'s billing page is the source of truth.',
  },
  {
    id: 'ai-drift',
    title: 'Answer quality drift',
    meaning: 'A quality signal of the assistant (for example the grounded rate) moved away from its recent baseline, or the latest evaluation run fell under its thresholds or its baseline (STORY-021).',
    firstChecks: [
      'Open AI Quality: which signal, and is there a change marker (a new model or a new version of the policy documents) just before it?',
      'Open the failures of the latest evaluation run.',
    ],
    close: 'Fix the cause (restore the model setting or the documents, or correct the prompt), run a new evaluation, and mark it as the baseline if the new level is intended. The alert closes when the signal is back inside its bounds.',
  },
  {
    id: 'ai-fairness',
    title: 'Answer fairness check failed',
    meaning: 'The latest counterfactual run (the same question asked about different people or situations) gave different answers where it should not (STORY-025).',
    firstChecks: ['Open AI Quality, Fairness: which question and which variants differ.', 'Check whether the model or the documents changed just before the run.'],
    close: 'Fix the cause and start a new fairness run (an administrator, once an hour). The alert closes when the latest run meets its criteria.',
  },
];

export const runbookFor = (id: SloId): RunbookEntry => RUNBOOK.find((e) => e.id === id)!;

/** The runbook entry of an alert row (the table of STORY-021 plus the 'slo' kind of STORY-029). */
export function runbookIdOf(kind: string, key: string): SloId {
  if (kind === 'slo') return (key.split(':')[0] as SloId) in Object.fromEntries(SLOS.map((s) => [s.id, 1])) ? (key.split(':')[0] as SloId) : 'availability';
  if (kind === 'fairness') return 'ai-fairness';
  return 'ai-drift';
}

// ---- Evaluation

export interface Measures {
  requests: number;
  errors5xx: number;
  p95Ms: number | null;
  /** The route with the highest 5xx share among routes with at least MIN_REQUESTS requests in the window. */
  worstRoute: { route: string; rate: number; requests: number } | null;
  aiSpendUsd: number;
}

export type SloStatus = 'ok' | 'breach' | 'no-data';

export interface SloResult {
  id: SloId;
  window: SloWindow;
  status: SloStatus;
  /** The measured value in words ("98.7%", "2.4 s"). */
  value: string;
  target: string;
  /** The alert text when breached. */
  message: string;
}

const pct = (n: number, digits = 2) => `${(n * 100).toFixed(digits).replace(/\.?0+$/, '')}%`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(2).replace(/\.?0+$/, '')} s`;
const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
const windowName = (w: SloWindow) => (w === '1h' ? 'last hour' : 'last 24 hours');

/** The traffic and spend objectives for one window. Pure. */
export function evaluateWindow(window: SloWindow, m: Measures, dailyBudgetUsd: number): SloResult[] {
  const enough = m.requests >= MIN_REQUESTS;
  const results: SloResult[] = [];

  const availability = enough ? 1 - m.errors5xx / m.requests : null;
  results.push({
    id: 'availability',
    window,
    status: availability === null ? 'no-data' : availability < TARGETS.availability ? 'breach' : 'ok',
    value: availability === null ? 'not enough requests' : pct(availability),
    target: `at least ${pct(TARGETS.availability)}`,
    message: availability === null ? '' : `Availability in the ${windowName(window)} is ${pct(availability)} (target ${pct(TARGETS.availability)}): ${m.errors5xx} of ${m.requests} requests ended in a server error.`,
  });

  const slow = enough && m.p95Ms !== null && m.p95Ms >= TARGETS.p95Ms;
  results.push({
    id: 'latency',
    window,
    status: !enough || m.p95Ms === null ? 'no-data' : slow ? 'breach' : 'ok',
    value: !enough || m.p95Ms === null ? 'not enough requests' : seconds(m.p95Ms),
    target: `p95 under ${seconds(TARGETS.p95Ms)}`,
    message: m.p95Ms === null ? '' : `The p95 request duration in the ${windowName(window)} is ${seconds(m.p95Ms)} (target under ${seconds(TARGETS.p95Ms)}).`,
  });

  const worst = m.worstRoute;
  results.push({
    id: 'error-rate',
    window,
    status: worst === null ? (enough ? 'ok' : 'no-data') : worst.rate >= TARGETS.errorRate ? 'breach' : 'ok',
    value: worst === null ? (enough ? 'no route with enough requests' : 'not enough requests') : `${pct(worst.rate)} on ${worst.route}`,
    target: `under ${pct(TARGETS.errorRate)} on every route`,
    message: worst === null ? '' : `${worst.route} ended ${pct(worst.rate)} of its requests in a server error in the ${windowName(window)} (${Math.round(worst.rate * worst.requests)} of ${worst.requests}; target under ${pct(TARGETS.errorRate)}).`,
  });

  const limit = window === '1h' ? dailyBudgetUsd * TARGETS.aiHourShareOfDaily : dailyBudgetUsd;
  results.push({
    id: 'ai-spend',
    window,
    status: m.aiSpendUsd > limit ? 'breach' : 'ok',
    value: usd(m.aiSpendUsd),
    target: `at most ${usd(limit)}${window === '1h' ? ' (a quarter of the daily budget)' : ' (the daily budget)'}`,
    message: `Estimated AI spend in the ${windowName(window)} is ${usd(m.aiSpendUsd)}, over ${usd(limit)}${window === '1h' ? ', a quarter of the' : ', the'} daily budget of ${usd(dailyBudgetUsd)}.`,
  });
  return results;
}

/** The traffic results that are breached, as the alerts that should be open: key "<objective>:<window>". Pure. */
export function wantedAlerts(results: SloResult[]): { key: string; message: string; id: SloId }[] {
  return results.filter((r) => r.status === 'breach').map((r) => ({ key: `${r.id}:${r.window}`, message: r.message, id: r.id }));
}

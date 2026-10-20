// STORY-021: the daily quality signals of the assistant's real answers (mode 'ai'), and drift: the last 7 days against the 28 days
// before. Pure: the counts come from aiQualityService.ts, which reads them from assistant_interactions.

export const RECENT_DAYS = 7;
export const BASELINE_DAYS = 28;
/** A window with fewer answers than this says "not enough data" instead of a verdict. */
export const MIN_ANSWERS = 20;

/** What is counted over a set of answers (one day, or a whole window). Every answer counted is one that was completed in 'ai' mode. */
export interface SignalCounts {
  answers: number;
  /** Answers whose grounding was checked, and those that passed. */
  checked: number;
  grounded: number;
  withheld: number;
  level1: number;
  noAnswer: number;
  /** Answers that have text, the citations on them and their total length in characters. */
  withText: number;
  citations: number;
  characters: number;
  /** Answers rated not helpful or reported, and the reported ones alone. */
  negative: number;
  reported: number;
  p95LatencyMs: number | null;
}

export type SignalKey = 'groundedRate' | 'withheldRate' | 'level1Share' | 'noAnswerRate' | 'citationsPerAnswer' | 'answerLength' | 'p95LatencyMs' | 'negativeFeedbackRate' | 'reportRate';

export interface SignalDefinition {
  key: SignalKey;
  label: string;
  unit: 'percent' | 'count' | 'characters' | 'ms';
  /** Which way is worse. 'either' for a signal where a large change in any direction matters. */
  worse: 'down' | 'up' | 'either';
  /** How far it may move before it is drift: percentage points for a percent signal, a share of the earlier value for the others. */
  tolerance: number;
  toleranceIn: 'points' | 'relative';
  description: string;
}

export const SIGNALS: SignalDefinition[] = [
  { key: 'groundedRate', label: 'Grounded rate', unit: 'percent', worse: 'down', tolerance: 2, toleranceIn: 'points', description: 'Answers that passed the grounding check, of those checked.' },
  { key: 'withheldRate', label: 'Withheld rate', unit: 'percent', worse: 'up', tolerance: 5, toleranceIn: 'points', description: 'Answers withheld for a case manager.' },
  { key: 'level1Share', label: 'Level 1 share', unit: 'percent', worse: 'up', tolerance: 10, toleranceIn: 'points', description: 'Answers shown with "check with a case manager".' },
  { key: 'noAnswerRate', label: 'No-answer rate', unit: 'percent', worse: 'up', tolerance: 5, toleranceIn: 'points', description: 'Questions the documents did not answer.' },
  { key: 'citationsPerAnswer', label: 'Citations per answer', unit: 'count', worse: 'down', tolerance: 0.2, toleranceIn: 'relative', description: 'Citations on the answers that have text.' },
  { key: 'answerLength', label: 'Answer length', unit: 'characters', worse: 'either', tolerance: 0.3, toleranceIn: 'relative', description: 'Characters per answer that has text.' },
  { key: 'p95LatencyMs', label: 'p95 latency', unit: 'ms', worse: 'up', tolerance: 0.5, toleranceIn: 'relative', description: 'The slowest 5% of answers took at least this long.' },
  { key: 'negativeFeedbackRate', label: 'Negative feedback rate', unit: 'percent', worse: 'up', tolerance: 5, toleranceIn: 'points', description: 'Answers rated not helpful or reported.' },
  { key: 'reportRate', label: 'Report rate', unit: 'percent', worse: 'up', tolerance: 3, toleranceIn: 'points', description: 'Answers a person reported as a problem.' },
];

const share = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : null);
const mean = (total: number, count: number): number | null => (count > 0 ? Math.round((total / count) * 100) / 100 : null);

/** Every signal's value for a set of counts; null where there is nothing to divide by. */
export function signalValues(c: SignalCounts): Record<SignalKey, number | null> {
  return {
    groundedRate: share(c.grounded, c.checked),
    withheldRate: share(c.withheld, c.answers),
    level1Share: share(c.level1, c.answers),
    noAnswerRate: share(c.noAnswer, c.answers),
    citationsPerAnswer: mean(c.citations, c.withText),
    answerLength: c.withText > 0 ? Math.round(c.characters / c.withText) : null,
    p95LatencyMs: c.p95LatencyMs === null ? null : Math.round(c.p95LatencyMs),
    negativeFeedbackRate: share(c.negative, c.answers),
    reportRate: share(c.reported, c.answers),
  };
}

export type DriftState = 'ok' | 'drift' | 'not-enough-data';

export interface SignalDrift {
  key: SignalKey;
  label: string;
  unit: SignalDefinition['unit'];
  description: string;
  /** The tolerance in words, e.g. "down more than 2 points". */
  tolerance: string;
  state: DriftState;
  recent: number | null;
  baseline: number | null;
  /** recent minus baseline: points for a percent signal, otherwise in the signal's own unit. */
  change: number | null;
  message: string | null;
}

const toleranceWords = (d: SignalDefinition): string => {
  const direction = d.worse === 'down' ? 'down' : d.worse === 'up' ? 'up' : 'up or down';
  const amount = d.toleranceIn === 'points' ? `${d.tolerance} points` : `${Math.round(d.tolerance * 100)}%`;
  return `${direction} more than ${amount}`;
};

const withUnit = (unit: SignalDefinition['unit'], value: number): string => (unit === 'percent' ? `${value}%` : unit === 'ms' ? `${value} ms` : unit === 'characters' ? `${value} characters` : String(value));

/** Whether a move from `baseline` to `recent` is past the signal's tolerance in the direction that is worse. Pure. */
export function isDrift(d: SignalDefinition, recent: number, baseline: number): boolean {
  const change = recent - baseline;
  const size = d.toleranceIn === 'points' ? Math.abs(change) : baseline > 0 ? Math.abs(change) / baseline : change === 0 ? 0 : Infinity;
  if (size <= d.tolerance) return false;
  return d.worse === 'either' || (d.worse === 'down' ? change < 0 : change > 0);
}

/**
 * Drift for every signal: the last 7 days against the 28 before them. A window with fewer than 20 answers says "not enough data" for
 * every signal (the share of a handful of answers means nothing).
 */
export function evaluateDrift(recent: SignalCounts, baseline: SignalCounts): SignalDrift[] {
  const enough = recent.answers >= MIN_ANSWERS && baseline.answers >= MIN_ANSWERS;
  const now = signalValues(recent);
  const before = signalValues(baseline);
  return SIGNALS.map((d) => {
    const r = now[d.key];
    const b = before[d.key];
    const base = { key: d.key, label: d.label, unit: d.unit, description: d.description, tolerance: toleranceWords(d), recent: r, baseline: b };
    if (!enough || r === null || b === null) return { ...base, state: 'not-enough-data' as const, change: null, message: null };
    const change = Math.round((r - b) * 100) / 100;
    const drifted = isDrift(d, r, b);
    return {
      ...base,
      state: drifted ? ('drift' as const) : ('ok' as const),
      change,
      message: drifted ? `${d.label} moved from ${withUnit(d.unit, b)} to ${withUnit(d.unit, r)} (${toleranceWords(d)} is drift).` : null,
    };
  });
}

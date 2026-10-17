import pool from '../database/connection';
import { weekStarts } from '../utils/weeks';

// STORY-024: how often a person goes against what the system said. Shown on the admin and leadership dashboards, against a target.
//
//   override rate = overrides / reviewed items, over the last 30 days, in percent, with a target below 20%.
//
// DENOMINATOR. A reviewed item is something the system decided or drafted that a person then looked at, so the person could have agreed
// or not. There are three kinds, each read where it is recorded, so the rate cannot drift from the work it counts:
//   assistant    an assistant answer a case manager reviewed (assistant_interactions.review_outcome): approved, corrected or declined.
//                Only answers the oversight ladder sent to a person are reviewed (withheld, or reported by the person).
//   compliance   a compliance review (a decision that failed a control) that a second case manager resolved
//                (compliance_reviews): exception accepted, or case reopened.
//   eligibility  a case decision, approved or denied, made where the automatic eligibility check had said Eligible or Not Eligible
//                (case_events.eligibility_status, kept at the moment of the decision).
// A decision made while the check said Pending Review (the system sent it to a person) is not counted: there was no automatic result
// to go against. Neither is a decision made before the result was recorded.
//
// NUMERATOR. An override is a reviewed item where the person went against the system:
//   assistant    corrected or declined (approved agrees with the draft)
//   compliance   exception accepted (the OVERRIDE audit action, written in the same step); a reopened case upholds the failed control
//   eligibility  approved while Not Eligible, or denied while Eligible
// A period holds the items reviewed in it (the time of the review, of the resolution, or of the decision).

export const OVERRIDE_TARGET = 20;
export const OVERRIDE_WINDOW_DAYS = 30;
export const OVERRIDE_TREND_WEEKS = 12;

export type OverrideSource = 'assistant' | 'compliance' | 'eligibility';

export const SOURCES: { source: OverrideSource; label: string; description: string }[] = [
  {
    source: 'assistant',
    label: 'Assistant answers',
    description: 'Answers a case manager reviewed. An override is an answer they corrected or declined.',
  },
  {
    source: 'compliance',
    label: 'Compliance exceptions',
    description: 'Compliance reviews a second case manager resolved. An override is an exception they accepted.',
  },
  {
    source: 'eligibility',
    label: 'Case decisions',
    description: 'Decisions made where eligibility had been checked automatically. An override is an approval of someone found Not Eligible, or a denial of someone found Eligible.',
  },
];

/** Whether the person went against the system, from where the item came and what they decided. */
const IS_OVERRIDE: Record<OverrideSource, (outcome: string) => boolean> = {
  assistant: (outcome) => outcome === 'corrected' || outcome === 'declined',
  compliance: (outcome) => outcome === 'Exception accepted',
  // "Approved while Not Eligible", "Denied while Eligible"; the other two combinations agree with the check
  eligibility: (outcome) => outcome === 'Approved while Not Eligible' || outcome === 'Denied while Eligible',
};

export const isOverride = (source: string, outcome: string): boolean => IS_OVERRIDE[source as OverrideSource]?.(outcome) ?? false;

/** One reviewed item: where it came from, what the person decided, the Monday of its week, and whether it falls in the last 30 days. */
export interface ReviewedRow {
  source: string;
  outcome: string;
  week: string;
  recent: boolean;
}

export interface SourceBreakdown {
  source: OverrideSource;
  label: string;
  description: string;
  reviewed: number;
  overrides: number;
  /** Percent; null when nothing was reviewed. */
  rate: number | null;
}

export interface OverrideWeek {
  /** The Monday the week starts on, YYYY-MM-DD. */
  weekStart: string;
  reviewed: number;
  overrides: number;
  rate: number | null;
}

export interface OverrideRateReport {
  /** Percent. The rate has to stay below it. */
  target: number;
  windowDays: number;
  reviewed: number;
  overrides: number;
  rate: number | null;
  alert: boolean;
  alertMessage: string | null;
  bySource: SourceBreakdown[];
  /** The last twelve weeks, oldest first, empty weeks included. */
  weeks: OverrideWeek[];
}

/** A share as a percentage with two decimals; null when there is nothing to divide by. */
export function overrideRate(overrides: number, reviewed: number): number | null {
  return reviewed > 0 ? Math.round((overrides / reviewed) * 10000) / 100 : null;
}

/**
 * The report from the reviewed items of the last twelve weeks. Pure. The rate has to stay below the target, so a rate exactly at it
 * already raises the alert, as the 2% hallucination target does. A source or a week with nothing reviewed has no rate, not a zero.
 */
export function summariseOverrides(rows: ReviewedRow[], currentWeek: string, target: number = OVERRIDE_TARGET): OverrideRateReport {
  const tally = () => ({ reviewed: 0, overrides: 0 });
  const bySource = new Map(SOURCES.map((s) => [s.source, tally()]));
  const byWeek = new Map(weekStarts(currentWeek, OVERRIDE_TREND_WEEKS).map((week) => [week, tally()]));
  const total = tally();

  for (const row of rows) {
    const source = bySource.get(row.source as OverrideSource);
    if (!source) continue; // not one of the three kinds
    const overridden = isOverride(row.source, row.outcome) ? 1 : 0;
    const week = byWeek.get(row.week);
    if (week) {
      week.reviewed += 1;
      week.overrides += overridden;
    }
    if (row.recent) {
      source.reviewed += 1;
      source.overrides += overridden;
      total.reviewed += 1;
      total.overrides += overridden;
    }
  }

  const rate = overrideRate(total.overrides, total.reviewed);
  const alert = rate !== null && rate >= target;
  return {
    target,
    windowDays: OVERRIDE_WINDOW_DAYS,
    reviewed: total.reviewed,
    overrides: total.overrides,
    rate,
    alert,
    alertMessage: alert
      ? `The override rate is ${rate}% for the last ${OVERRIDE_WINDOW_DAYS} days (${total.overrides} of ${total.reviewed} reviewed items). The target is below ${target}%.`
      : null,
    bySource: SOURCES.map((s) => {
      const { reviewed, overrides } = bySource.get(s.source)!;
      return { ...s, reviewed, overrides, rate: overrideRate(overrides, reviewed) };
    }),
    weeks: [...byWeek].map(([weekStart, { reviewed, overrides }]) => ({ weekStart, reviewed, overrides, rate: overrideRate(overrides, reviewed) })),
  };
}

// Every reviewed item of the three kinds, with what the person decided. Casts make the three times one type; weeks are the database's,
// like the leadership trend.
const REVIEWED_ITEMS = `
  SELECT 'assistant' AS source, review_outcome AS outcome, reviewed_at AS at
  FROM assistant_interactions WHERE review_outcome IS NOT NULL
  UNION ALL
  SELECT 'compliance', resolution, resolved_at::timestamptz
  FROM compliance_reviews WHERE status = 'Resolved' AND resolution IS NOT NULL
  UNION ALL
  SELECT 'eligibility', to_status || ' while ' || eligibility_status, created_at::timestamptz
  FROM case_events
  WHERE event_type = 'status_change' AND to_status IN ('Approved', 'Denied') AND eligibility_status IN ('Eligible', 'Not Eligible')`;

// A safety bound on how many items are read: the twelve weeks hold the thirty days, and a person reviewed every one of them
const ITEMS_READ = 20000;

/** The override rate for the last 30 days, its weekly trend and where it comes from, read from the three places the work is recorded. */
export async function getOverrideRate(): Promise<OverrideRateReport> {
  const [items, thisWeek] = await Promise.all([
    pool.query(
      `SELECT source, outcome, to_char(date_trunc('week', at), 'YYYY-MM-DD') AS week, (at >= NOW() - make_interval(days => $2::int)) AS recent
       FROM (${REVIEWED_ITEMS}) items
       WHERE at >= date_trunc('week', NOW()) - make_interval(weeks => $1::int)
       ORDER BY at DESC
       LIMIT $3`,
      [OVERRIDE_TREND_WEEKS - 1, OVERRIDE_WINDOW_DAYS, ITEMS_READ]
    ),
    pool.query(`SELECT to_char(date_trunc('week', NOW()), 'YYYY-MM-DD') AS week`),
  ]);
  return summariseOverrides(
    items.rows.map((r: any) => ({ source: r.source, outcome: r.outcome, week: r.week, recent: Boolean(r.recent) })),
    thisWeek.rows[0].week
  );
}

import pool from '../database/connection';

// STORY-025 (3): are decisions reached differently for different groups? The demo does not hold race, sex, ethnicity, religion,
// disability or national origin and does not add them, so outcomes are watched on the two groups it already holds: the age band (from the
// date of birth) and the region (from the state in the address). Age is an input to the Type A rule by design, so an age band with a lower
// approval rate is expected to need explaining, not necessarily fixing; the monitor shows it and does not hide it.
//
// For each group: decisions (approved or denied), the approval rate, the average days from submission to decision, and the override rate
// (as STORY-024: a decision against the automatic eligibility result, of the decisions that had one). The four-fifths rule flags a group
// whose approval rate is under 80% of the highest group's. A group with fewer than 10 decisions has its counts shown and no rates and is
// never flagged or compared: a rate of a handful of decisions means nothing.

export const MIN_DECISIONS = 10;
export const FOUR_FIFTHS = 0.8;
/** Decisions of this many days are read; older ones are not part of the monitor. */
export const WINDOW_DAYS = 365;
const DECISIONS_READ = 20000;

export const AGE_BANDS = ['18 to 24', '25 to 34', '35 to 44', '45 to 54', '55 to 64', '65 and over'] as const;
export const REGIONS = ['Northeast', 'Midwest', 'South', 'West'] as const;
export const UNKNOWN = 'Unknown';

export function ageBand(age: number): string {
  if (age >= 65) return '65 and over';
  if (age >= 55) return '55 to 64';
  if (age >= 45) return '45 to 54';
  if (age >= 35) return '35 to 44';
  if (age >= 25) return '25 to 34';
  return age >= 18 ? '18 to 24' : 'Under 18';
}

// The U.S. Census Bureau's four regions
const STATE_REGION: Record<string, (typeof REGIONS)[number]> = {};
const STATES: [string, string, (typeof REGIONS)[number]][] = [
  ['CT', 'Connecticut', 'Northeast'], ['ME', 'Maine', 'Northeast'], ['MA', 'Massachusetts', 'Northeast'], ['NH', 'New Hampshire', 'Northeast'],
  ['RI', 'Rhode Island', 'Northeast'], ['VT', 'Vermont', 'Northeast'], ['NJ', 'New Jersey', 'Northeast'], ['NY', 'New York', 'Northeast'],
  ['PA', 'Pennsylvania', 'Northeast'],
  ['IL', 'Illinois', 'Midwest'], ['IN', 'Indiana', 'Midwest'], ['MI', 'Michigan', 'Midwest'], ['OH', 'Ohio', 'Midwest'], ['WI', 'Wisconsin', 'Midwest'],
  ['IA', 'Iowa', 'Midwest'], ['KS', 'Kansas', 'Midwest'], ['MN', 'Minnesota', 'Midwest'], ['MO', 'Missouri', 'Midwest'], ['NE', 'Nebraska', 'Midwest'],
  ['ND', 'North Dakota', 'Midwest'], ['SD', 'South Dakota', 'Midwest'],
  ['DE', 'Delaware', 'South'], ['DC', 'District of Columbia', 'South'], ['FL', 'Florida', 'South'], ['GA', 'Georgia', 'South'], ['MD', 'Maryland', 'South'],
  ['NC', 'North Carolina', 'South'], ['SC', 'South Carolina', 'South'], ['VA', 'Virginia', 'South'], ['WV', 'West Virginia', 'South'],
  ['AL', 'Alabama', 'South'], ['KY', 'Kentucky', 'South'], ['MS', 'Mississippi', 'South'], ['TN', 'Tennessee', 'South'], ['AR', 'Arkansas', 'South'],
  ['LA', 'Louisiana', 'South'], ['OK', 'Oklahoma', 'South'], ['TX', 'Texas', 'South'],
  ['AZ', 'Arizona', 'West'], ['CO', 'Colorado', 'West'], ['ID', 'Idaho', 'West'], ['MT', 'Montana', 'West'], ['NV', 'Nevada', 'West'],
  ['NM', 'New Mexico', 'West'], ['UT', 'Utah', 'West'], ['WY', 'Wyoming', 'West'], ['AK', 'Alaska', 'West'], ['CA', 'California', 'West'],
  ['HI', 'Hawaii', 'West'], ['OR', 'Oregon', 'West'], ['WA', 'Washington', 'West'],
];
for (const [code, , region] of STATES) STATE_REGION[code] = region;
// Longest names first, so "West Virginia" is not read as "Virginia"
const NAMES_LONGEST_FIRST = [...STATES].sort((a, b) => b[1].length - a[1].length);

/**
 * The region of an address, from its state: the two-letter code before the ZIP code or at the end ("Springfield, IL 62701", "springfield
 * il"), or a state's full name. The address is free text, so one that names no state is Unknown. Pure; the address is read here and
 * never kept or sent anywhere.
 */
export function regionOf(address: string | null | undefined): string {
  if (!address) return UNKNOWN;
  const text = address.replace(/\s+/g, ' ').trim();
  const code = /(?:^|[\s,])([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/.exec(text)?.[1].toUpperCase();
  if (code && STATE_REGION[code]) return STATE_REGION[code];
  const lower = text.toLowerCase();
  const named = NAMES_LONGEST_FIRST.find(([, name]) => new RegExp(`(?:^|[^a-z])${name.toLowerCase()}(?:[^a-z]|$)`).test(lower));
  return named ? named[2] : UNKNOWN;
}

/** One decision: what was decided, at what age, where, how long it took, and whether it went against the automatic result. */
export interface DecisionRow {
  decision: 'Approved' | 'Denied';
  age: number;
  region: string;
  days: number | null;
  eligibility: string | null;
}

export interface GroupOutcome {
  group: string;
  decisions: number;
  approved: number;
  /** Percent; null below the minimum sample. */
  approvalRate: number | null;
  avgDaysToDecide: number | null;
  /** Decisions that had an automatic result, and those that went against it. */
  checked: number;
  overrides: number;
  overrideRate: number | null;
  enough: boolean;
  /** Under four fifths of the highest group's approval rate. */
  flagged: boolean;
  /** This group's approval rate as a share of the highest group's, in percent; null when not compared. */
  ratioToHighest: number | null;
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : null);
const isOverride = (d: DecisionRow): boolean => (d.decision === 'Approved' && d.eligibility === 'Not Eligible') || (d.decision === 'Denied' && d.eligibility === 'Eligible');

/** The outcome table for one way of grouping the decisions, with the four-fifths rule applied. Pure. */
export function summariseGroups(rows: DecisionRow[], groupOf: (row: DecisionRow) => string, order: readonly string[]): GroupOutcome[] {
  const groups = new Map<string, DecisionRow[]>(order.map((g) => [g, []]));
  for (const row of rows) {
    const group = groupOf(row);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(row);
  }
  const table = [...groups]
    .filter(([group, members]) => members.length > 0 || order.includes(group))
    .map(([group, members]): GroupOutcome => {
      const enough = members.length >= MIN_DECISIONS;
      const approved = members.filter((m) => m.decision === 'Approved').length;
      const timed = members.filter((m) => m.days !== null);
      const checked = members.filter((m) => m.eligibility === 'Eligible' || m.eligibility === 'Not Eligible');
      const overrides = checked.filter(isOverride).length;
      return {
        group,
        decisions: members.length,
        approved,
        approvalRate: enough ? pct(approved, members.length) : null,
        avgDaysToDecide: enough && timed.length ? Math.round((timed.reduce((n, m) => n + m.days!, 0) / timed.length) * 10) / 10 : null,
        checked: checked.length,
        overrides,
        overrideRate: enough ? pct(overrides, checked.length) : null,
        enough,
        flagged: false,
        ratioToHighest: null,
      };
    });

  // Compared only among groups with enough decisions, and never the group with no name for it
  const comparable = table.filter((g) => g.enough && g.approvalRate !== null && g.group !== UNKNOWN);
  const highest = Math.max(0, ...comparable.map((g) => g.approvalRate!));
  if (comparable.length >= 2 && highest > 0) {
    for (const g of comparable) {
      g.ratioToHighest = Math.round((g.approvalRate! / highest) * 10000) / 100;
      g.flagged = g.approvalRate! < highest * FOUR_FIFTHS;
    }
  }
  return table;
}

export interface OutcomeReport {
  windowDays: number;
  minDecisions: number;
  fourFifths: number;
  decisions: number;
  byAgeBand: GroupOutcome[];
  byRegion: GroupOutcome[];
  flagged: string[];
}

export function summariseOutcomes(rows: DecisionRow[]): OutcomeReport {
  const byAgeBand = summariseGroups(rows, (r) => ageBand(r.age), AGE_BANDS);
  const byRegion = summariseGroups(rows, (r) => r.region, [...REGIONS, UNKNOWN]);
  return {
    windowDays: WINDOW_DAYS,
    minDecisions: MIN_DECISIONS,
    fourFifths: FOUR_FIFTHS,
    decisions: rows.length,
    byAgeBand,
    byRegion,
    flagged: [...byAgeBand.filter((g) => g.flagged).map((g) => `Age ${g.group}`), ...byRegion.filter((g) => g.flagged).map((g) => `Region ${g.group}`)],
  };
}

/** Every approval and denial of the last year with the age, state and timing the groups need. */
export async function getOutcomes(): Promise<OutcomeReport> {
  const result = await pool.query(
    `SELECT e.to_status AS decision, e.eligibility_status AS eligibility, u.address,
            EXTRACT(YEAR FROM age(e.created_at::date, u.dob))::int AS age,
            EXTRACT(EPOCH FROM (e.created_at - COALESCE(c.submitted_at, c.created_at))) / 86400.0 AS days
     FROM case_events e
     JOIN cases c ON c.id = e.case_id
     JOIN users u ON u.id = c.user_id
     WHERE e.event_type = 'status_change' AND e.to_status IN ('Approved', 'Denied') AND e.created_at >= NOW() - make_interval(days => $1::int)
     ORDER BY e.created_at DESC
     LIMIT $2`,
    [WINDOW_DAYS, DECISIONS_READ]
  );
  return summariseOutcomes(
    result.rows.map((r: any) => ({
      decision: r.decision,
      age: Number(r.age),
      region: regionOf(r.address),
      days: r.days === null ? null : Math.max(0, Number(r.days)),
      eligibility: r.eligibility,
    }))
  );
}

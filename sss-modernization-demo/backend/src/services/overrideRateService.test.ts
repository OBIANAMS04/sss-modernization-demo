// STORY-024: the override rate. The computation is pure, so what counts as a reviewed item and as an override is tested here with
// fixtures; what the SQL reads is checked against a real database by scripts/e2e/assistant-review.mjs.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));

import pool from '../database/connection';
import {
  OVERRIDE_TARGET,
  OVERRIDE_TREND_WEEKS,
  OVERRIDE_WINDOW_DAYS,
  ReviewedRow,
  SOURCES,
  getOverrideRate,
  isOverride,
  overrideRate,
  summariseOverrides,
} from './overrideRateService';

const query = pool.query as unknown as jest.Mock;
const THIS_WEEK = '2026-10-12';
const LAST_WEEK = '2026-10-05';

const item = (source: string, outcome: string, week = THIS_WEEK, recent = true): ReviewedRow => ({ source, outcome, week, recent });
const assistant = (outcome: 'approved' | 'corrected' | 'declined', week?: string, recent?: boolean) => item('assistant', outcome, week, recent);
const compliance = (outcome: 'Exception accepted' | 'Case reopened', week?: string, recent?: boolean) => item('compliance', outcome, week, recent);
const decision = (outcome: string, week?: string, recent?: boolean) => item('eligibility', outcome, week, recent);
const many = (n: number, make: () => ReviewedRow) => Array.from({ length: n }, make);

describe('what counts as an override (STORY-024)', () => {
  it.each([
    ['assistant', 'approved', false],
    ['assistant', 'corrected', true],
    ['assistant', 'declined', true],
    ['compliance', 'Exception accepted', true],
    ['compliance', 'Case reopened', false],
    ['eligibility', 'Approved while Not Eligible', true],
    ['eligibility', 'Denied while Eligible', true],
    ['eligibility', 'Approved while Eligible', false],
    ['eligibility', 'Denied while Not Eligible', false],
  ])('%s: %s -> %s', (source, outcome, expected) => {
    expect(isOverride(source, outcome)).toBe(expected);
  });

  it('is never an override for something it does not know', () => {
    expect(isOverride('somewhere-else', 'corrected')).toBe(false);
    expect(isOverride('assistant', 'Exception accepted')).toBe(false);
    expect(isOverride('eligibility', 'Approved while Pending Review')).toBe(false);
  });
});

describe('overrideRate', () => {
  it('is overrides over reviewed items, in percent with two decimals, and none when nothing was reviewed', () => {
    expect(overrideRate(1, 3)).toBe(33.33);
    expect(overrideRate(2, 3)).toBe(66.67);
    expect(overrideRate(0, 4)).toBe(0);
    expect(overrideRate(4, 4)).toBe(100);
    expect(overrideRate(0, 0)).toBeNull();
  });
});

describe('summariseOverrides: the rate for 30 days', () => {
  it('divides the overrides by the items reviewed, across the three sources', () => {
    const report = summariseOverrides(
      [
        assistant('approved'),
        assistant('corrected'),
        compliance('Case reopened'),
        compliance('Exception accepted'),
        decision('Approved while Eligible'),
        decision('Denied while Eligible'),
        decision('Approved while Not Eligible'),
        decision('Denied while Not Eligible'),
      ],
      THIS_WEEK
    );
    expect([report.reviewed, report.overrides, report.rate]).toEqual([8, 4, 50]);
    expect(report).toMatchObject({ target: OVERRIDE_TARGET, windowDays: OVERRIDE_WINDOW_DAYS });
    expect([OVERRIDE_TARGET, OVERRIDE_WINDOW_DAYS]).toEqual([20, 30]);
  });

  it('counts only the items reviewed in the last 30 days, though the trend keeps twelve weeks', () => {
    const report = summariseOverrides([assistant('corrected', THIS_WEEK, true), assistant('approved', LAST_WEEK, true), assistant('corrected', '2026-08-03', false)], THIS_WEEK);
    expect([report.reviewed, report.overrides, report.rate]).toEqual([2, 1, 50]);
    expect(report.weeks.reduce((n, w) => n + w.reviewed, 0)).toBe(3);
    expect(report.weeks.find((w) => w.weekStart === '2026-08-03')).toMatchObject({ reviewed: 1, overrides: 1, rate: 100 });
  });

  it('has no rate, no alert and no message while nothing has been reviewed', () => {
    const report = summariseOverrides([], THIS_WEEK);
    expect([report.reviewed, report.overrides, report.rate, report.alert, report.alertMessage]).toEqual([0, 0, null, false, null]);
    expect(report.bySource.map((s) => [s.reviewed, s.overrides, s.rate])).toEqual([[0, 0, null], [0, 0, null], [0, 0, null]]);
    expect(report.weeks.every((w) => w.rate === null && w.reviewed === 0)).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/NaN|Infinity/);
  });

  it('is 0% rather than none when items were reviewed and none was overridden', () => {
    const report = summariseOverrides([assistant('approved'), decision('Approved while Eligible')], THIS_WEEK);
    expect([report.rate, report.alert]).toEqual([0, false]);
  });

  it('moves when a correction is made', () => {
    const rows = [...many(9, () => assistant('approved')), assistant('approved')];
    expect(summariseOverrides(rows, THIS_WEEK).rate).toBe(0);
    expect(summariseOverrides([...rows, assistant('corrected')], THIS_WEEK).rate).toBe(9.09);
    expect(summariseOverrides([...rows, assistant('corrected'), assistant('declined')], THIS_WEEK).rate).toBe(16.67);
  });

  it('ignores an item of a kind it does not know', () => {
    const report = summariseOverrides([item('unknown', 'corrected'), assistant('approved')], THIS_WEEK);
    expect([report.reviewed, report.overrides]).toEqual([1, 0]);
    expect(report.weeks.at(-1)!.reviewed).toBe(1);
  });
});

describe('summariseOverrides: the alert against the target below 20%', () => {
  const withRate = (overrides: number, reviewed: number) => [...many(overrides, () => assistant('corrected')), ...many(reviewed - overrides, () => assistant('approved'))];

  it('stays quiet below the target', () => {
    const report = summariseOverrides(withRate(1999, 10000), THIS_WEEK); // 19.99%
    expect([report.rate, report.alert, report.alertMessage]).toEqual([19.99, false, null]);
    expect(summariseOverrides(withRate(1, 6), THIS_WEEK).alert).toBe(false); // 16.67%
  });

  it('is raised at the target, which the rate has to stay below, and above it', () => {
    expect(summariseOverrides(withRate(2, 10), THIS_WEEK)).toMatchObject({ rate: 20, alert: true });
    expect(summariseOverrides(withRate(1, 3), THIS_WEEK)).toMatchObject({ rate: 33.33, alert: true });
    expect(summariseOverrides(withRate(3, 3), THIS_WEEK)).toMatchObject({ rate: 100, alert: true });
  });

  it('says what the rate is, how it was reached and what the target is', () => {
    expect(summariseOverrides(withRate(1, 3), THIS_WEEK).alertMessage).toBe(
      'The override rate is 33.33% for the last 30 days (1 of 3 reviewed items). The target is below 20%.'
    );
  });

  it('takes its target as an argument, and is 20 by default', () => {
    expect(OVERRIDE_TARGET).toBe(20);
    expect(summariseOverrides(withRate(1, 10), THIS_WEEK, 10)).toMatchObject({ rate: 10, alert: true, target: 10 });
    expect(summariseOverrides(withRate(1, 10), THIS_WEEK).alert).toBe(false);
  });

  it('judges the 30 days, not a single week', () => {
    const rows = [...many(9, () => assistant('approved', LAST_WEEK)), assistant('corrected', THIS_WEEK)];
    const report = summariseOverrides(rows, THIS_WEEK);
    expect(report.weeks.at(-1)).toMatchObject({ rate: 100 }); // this week alone is over the target
    expect([report.rate, report.alert]).toEqual([10, false]);
  });
});

describe('summariseOverrides: where it comes from', () => {
  it('breaks the rate down by source, in a fixed order, each with what it counts', () => {
    const report = summariseOverrides(
      [assistant('corrected'), assistant('approved'), assistant('approved'), compliance('Exception accepted'), decision('Approved while Eligible'), decision('Denied while Eligible'), decision('Approved while Eligible'), decision('Approved while Eligible')],
      THIS_WEEK
    );
    expect(report.bySource.map((s) => [s.source, s.reviewed, s.overrides, s.rate])).toEqual([
      ['assistant', 3, 1, 33.33],
      ['compliance', 1, 1, 100],
      ['eligibility', 4, 1, 25],
    ]);
    expect(report.bySource.map((s) => s.label)).toEqual(['Assistant answers', 'Compliance exceptions', 'Case decisions']);
    expect(report.bySource.every((s) => s.description.length > 20)).toBe(true);
    expect(SOURCES.map((s) => s.source)).toEqual(['assistant', 'compliance', 'eligibility']);
    // The sources add up to the whole
    expect(report.bySource.reduce((n, s) => n + s.reviewed, 0)).toBe(report.reviewed);
    expect(report.bySource.reduce((n, s) => n + s.overrides, 0)).toBe(report.overrides);
  });

  it('gives a source with nothing reviewed no rate', () => {
    const report = summariseOverrides([assistant('corrected')], THIS_WEEK);
    expect(report.bySource.map((s) => s.rate)).toEqual([100, null, null]);
  });
});

describe('summariseOverrides: the weekly trend', () => {
  it('lists the last twelve weeks, oldest first, ending with this one, empty weeks included', () => {
    const report = summariseOverrides([], THIS_WEEK);
    expect(OVERRIDE_TREND_WEEKS).toBe(12);
    expect(report.weeks).toHaveLength(12);
    expect([report.weeks[0].weekStart, report.weeks[1].weekStart, report.weeks[10].weekStart, report.weeks[11].weekStart]).toEqual(['2026-07-27', '2026-08-03', '2026-10-05', '2026-10-12']);
  });

  it('counts each week\'s items, and gives a week with nothing no rate', () => {
    const report = summariseOverrides([assistant('corrected', LAST_WEEK), assistant('approved', LAST_WEEK), assistant('approved', LAST_WEEK), compliance('Exception accepted', THIS_WEEK)], THIS_WEEK);
    expect(report.weeks.at(-2)).toEqual({ weekStart: LAST_WEEK, reviewed: 3, overrides: 1, rate: 33.33 });
    expect(report.weeks.at(-1)).toEqual({ weekStart: THIS_WEEK, reviewed: 1, overrides: 1, rate: 100 });
    expect(report.weeks.slice(0, 10).every((w) => w.reviewed === 0 && w.rate === null)).toBe(true);
  });

  it('leaves out weeks outside the twelve', () => {
    const report = summariseOverrides([assistant('corrected', '2026-07-20', false), assistant('corrected', '2026-10-19')], THIS_WEEK);
    expect(report.weeks.reduce((n, w) => n + w.reviewed, 0)).toBe(0);
  });
});

describe('getOverrideRate', () => {
  const rows = (...items: [string, string, string, boolean][]) => ({ rows: items.map(([source, outcome, week, recent]) => ({ source, outcome, week, recent })) });

  it('reads the reviewed items of the last twelve weeks and the current week, and reports them', async () => {
    query
      .mockResolvedValueOnce(rows(['assistant', 'corrected', THIS_WEEK, true], ['compliance', 'Case reopened', THIS_WEEK, true], ['eligibility', 'Approved while Eligible', LAST_WEEK, true]))
      .mockResolvedValueOnce({ rows: [{ week: THIS_WEEK }] });
    const report = await getOverrideRate();
    expect([report.reviewed, report.overrides, report.rate, report.alert]).toEqual([3, 1, 33.33, true]);
    expect(report.weeks.at(-1)).toMatchObject({ weekStart: THIS_WEEK, reviewed: 2, overrides: 1 });
    // This week and the eleven before it; the 30-day window; a bound on the rows
    expect(query.mock.calls[0][1]).toEqual([11, 30, 20000]);
  });

  it('reads all three places the work is recorded, and only what an aggregate needs', async () => {
    query.mockResolvedValueOnce(rows()).mockResolvedValueOnce({ rows: [{ week: THIS_WEEK }] });
    await getOverrideRate();
    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ').trim();
    expect(sql).toContain("FROM assistant_interactions WHERE review_outcome IS NOT NULL");
    expect(sql).toContain("FROM compliance_reviews WHERE status = 'Resolved'");
    expect(sql).toContain("FROM case_events WHERE event_type = 'status_change' AND to_status IN ('Approved', 'Denied') AND eligibility_status IN ('Eligible', 'Not Eligible')");
    // A decision against Pending Review has nothing automatic to go against, so it is not read
    expect(sql).not.toContain('Pending Review');
    // Nothing about a person, a case or an answer leaves the database
    expect(sql).not.toMatch(/email|full_name|question|answer|user_id|actor|case_id|trace_id/i);
    expect(sql).toMatch(/^SELECT source, outcome, to_char\(date_trunc\('week', at\), 'YYYY-MM-DD'\) AS week, \(at >= NOW\(\) - make_interval\(days => \$2::int\)\) AS recent/);
  });

  it('is empty, not broken, for a system where nothing has been reviewed', async () => {
    query.mockResolvedValueOnce(rows()).mockResolvedValueOnce({ rows: [{ week: THIS_WEEK }] });
    const report = await getOverrideRate();
    expect([report.rate, report.alert, report.weeks.length]).toEqual([null, false, 12]);
  });
});

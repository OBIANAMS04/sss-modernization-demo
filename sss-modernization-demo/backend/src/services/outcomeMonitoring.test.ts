// STORY-025 (3): outcome monitoring by age band and region. Grouping and the four-fifths rule are pure; the SQL is checked against a real
// database by scripts/e2e/ai-quality.mjs.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));

import pool from '../database/connection';
import { AGE_BANDS, DecisionRow, MIN_DECISIONS, ageBand, getOutcomes, regionOf, summariseGroups, summariseOutcomes } from './outcomeMonitoring';

const query = pool.query as unknown as jest.Mock;

describe('ageBand', () => {
  it.each([[18, '18 to 24'], [24, '18 to 24'], [25, '25 to 34'], [34, '25 to 34'], [44, '35 to 44'], [54, '45 to 54'], [64, '55 to 64'], [65, '65 and over'], [101, '65 and over'], [17, 'Under 18']])(
    'age %i is %s',
    (age, band) => expect(ageBand(age)).toBe(band)
  );
  it('has six bands in order', () => expect(AGE_BANDS).toHaveLength(6));
});

describe('regionOf: the state in a free-text address', () => {
  it.each([
    ['12 Elm Street, Springfield, IL 62701', 'Midwest'],
    ['12 elm st springfield il 62701', 'Midwest'],
    ['Apt 4B, 12 Elm St.\nSpringfield, NY\n62701-1234', 'Northeast'],
    ['PO Box 77, Austin, TX', 'South'],
    ['500 Pine Avenue Seattle WA', 'West'],
    ['9 Harbor Rd, Portland, Maine', 'Northeast'],
    ['1 Capitol Mall, Charleston, West Virginia 25301', 'South'],
    ['44 Ocean Dr, Miami, florida', 'South'],
  ])('%j is %s', (address, region) => expect(regionOf(address)).toBe(region));

  it.each([[null], [undefined], [''], ['123 Main St'], ['Somewhere in the world'], ['12 Elm Street, Springfield, ZZ 62701']])('%j is Unknown', (address) =>
    expect(regionOf(address as any)).toBe('Unknown')
  );

  it('reaches every state and DC', () => {
    const codes = 'CT ME MA NH RI VT NJ NY PA IL IN MI OH WI IA KS MN MO NE ND SD DE DC FL GA MD NC SC VA WV AL KY MS TN AR LA OK TX AZ CO ID MT NV NM UT WY AK CA HI OR WA'.split(' ');
    expect(codes).toHaveLength(51);
    expect(codes.filter((code) => regionOf(`1 Main Street, Town, ${code} 12345`) === 'Unknown')).toEqual([]);
  });
});

const decisions = (n: number, approved: number, extra: Partial<DecisionRow> = {}): DecisionRow[] =>
  Array.from({ length: n }, (_, i) => ({ decision: i < approved ? 'Approved' : 'Denied', age: 70, region: 'South', days: 2, eligibility: null, ...extra }) as DecisionRow);

describe('summariseGroups: the four-fifths rule', () => {
  const by = (rows: DecisionRow[]) => summariseGroups(rows, (r) => r.region, ['South', 'West', 'Unknown']);

  it('flags a group under 80% of the highest approval rate, and not one at exactly 80%', () => {
    const table = by([...decisions(20, 18, { region: 'South' }), ...decisions(20, 14, { region: 'West' })]);
    expect(table.find((g) => g.group === 'South')).toMatchObject({ approvalRate: 90, flagged: false, ratioToHighest: 100 });
    expect(table.find((g) => g.group === 'West')).toMatchObject({ approvalRate: 70, flagged: true, ratioToHighest: 77.78 });
    const edge = by([...decisions(20, 20, { region: 'South' }), ...decisions(20, 16, { region: 'West' })]);
    expect(edge.find((g) => g.group === 'West')).toMatchObject({ approvalRate: 80, flagged: false });
  });

  it(`shows only counts, and never a rate or a flag, below ${MIN_DECISIONS} decisions`, () => {
    const table = by([...decisions(20, 20, { region: 'South' }), ...decisions(MIN_DECISIONS - 1, 0, { region: 'West' })]);
    expect(table.find((g) => g.group === 'West')).toMatchObject({ decisions: 9, approved: 0, approvalRate: null, avgDaysToDecide: null, overrideRate: null, enough: false, flagged: false });
    expect(table.find((g) => g.group === 'South')!.flagged).toBe(false);
    expect(by(decisions(MIN_DECISIONS, 5, { region: 'West' })).find((g) => g.group === 'West')).toMatchObject({ enough: true, approvalRate: 50 });
  });

  it('compares nothing when only one group has enough decisions, and never compares Unknown', () => {
    expect(by(decisions(30, 30, { region: 'South' })).every((g) => !g.flagged && g.ratioToHighest === null)).toBe(true);
    const table = by([...decisions(20, 20, { region: 'South' }), ...decisions(20, 0, { region: 'Unknown' })]);
    expect(table.find((g) => g.group === 'Unknown')).toMatchObject({ approvalRate: 0, flagged: false, ratioToHighest: null });
  });

  it('averages the days to decide and ignores decisions with no timing', () => {
    const rows = [...decisions(5, 5, { days: 1 }), ...decisions(5, 5, { days: 4 }), ...decisions(2, 2, { days: null })];
    expect(by(rows).find((g) => g.group === 'South')!.avgDaysToDecide).toBe(2.5);
  });

  it('counts an override as STORY-024 does: against the automatic result, of the decisions that had one', () => {
    const rows = [
      ...decisions(4, 4, { eligibility: 'Not Eligible' }), // approved against the check: 4 overrides
      ...decisions(4, 4, { eligibility: 'Eligible' }), // approved with it
      ...decisions(2, 0, { eligibility: 'Eligible' }), // denied against it: 2 overrides
      ...decisions(2, 0, { eligibility: 'Pending Review' }), // no automatic result: not counted
    ];
    expect(by(rows).find((g) => g.group === 'South')).toMatchObject({ decisions: 12, checked: 10, overrides: 6, overrideRate: 60 });
  });
});

describe('summariseOutcomes', () => {
  it('names every flagged group of either grouping', () => {
    const rows = [
      ...decisions(20, 19, { age: 70, region: 'South' }),
      ...decisions(20, 10, { age: 30, region: 'South' }),
    ];
    const report = summariseOutcomes(rows);
    expect(report).toMatchObject({ decisions: 40, minDecisions: 10, fourFifths: 0.8, windowDays: 365 });
    expect(report.flagged).toEqual(['Age 25 to 34']);
    expect(report.byAgeBand.map((g) => g.group)).toEqual([...AGE_BANDS]);
    expect(report.byRegion.map((g) => g.group)).toEqual(['Northeast', 'Midwest', 'South', 'West', 'Unknown']);
  });

  it('is quiet with no decisions', () => {
    expect(summariseOutcomes([])).toMatchObject({ decisions: 0, flagged: [] });
  });
});

describe('getOutcomes', () => {
  it('reads the decisions of the last year and groups them by the state in the address, which it does not return', async () => {
    query.mockResolvedValueOnce({ rows: [{ decision: 'Approved', eligibility: 'Eligible', address: '1 Main St, Dallas, TX 75001', age: 70, days: '2.5' }] });
    const report = await getOutcomes();
    expect(query.mock.calls[0][1]).toEqual([365, 20000]);
    expect(report.byRegion.find((g) => g.group === 'South')).toMatchObject({ decisions: 1, approved: 1 });
    expect(JSON.stringify(report)).not.toContain('Dallas');
  });
});

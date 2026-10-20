// STORY-025 (1): a counterfactual test matrix for the eligibility and compliance rules. The same person is described again and again with
// only things that must not matter changed (a name suggesting a gender or an ethnicity, a state from every US region, a phone number
// and an address written in different ways) and the rules must give identical outcomes. The rules read dates of birth, income,
// hardship, a phone and an address being present, and the facts of a decision; this proves that is all they read. Nothing here is data
// about a real person: the names, numbers and addresses are made up for the test.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));

import { DecisionContext, evaluateControls } from './complianceService';
import { checkExemptionEligibility } from './exemptionService';
import { determineCompliance } from './userService';

// Names that suggest different genders and ethnicities (the lists are examples, not a classification of anyone)
const NAMES = [
  'Jamal Washington', 'Emily Walsh', 'Maria Hernandez', 'Wei Zhang', 'Aaliyah Johnson', 'Connor O\'Brien', 'Priya Patel', 'Mohammed Al-Farsi',
  'Keisha Williams', 'Hiroshi Tanaka', 'Svetlana Petrova', 'Tyrone Jackson', 'Lakota Whitehorse', 'Sofia Rossi', 'Dae-jung Kim', 'Alex Morgan',
];

// Every state and DC, with its Census region
const REGIONS: Record<string, string[]> = {
  Northeast: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT', 'NJ', 'NY', 'PA'],
  Midwest: ['IL', 'IN', 'MI', 'OH', 'WI', 'IA', 'KS', 'MN', 'MO', 'NE', 'ND', 'SD'],
  South: ['DE', 'DC', 'FL', 'GA', 'MD', 'NC', 'SC', 'VA', 'WV', 'AL', 'KY', 'MS', 'TN', 'AR', 'LA', 'OK', 'TX'],
  West: ['AZ', 'CO', 'ID', 'MT', 'NV', 'NM', 'UT', 'WY', 'AK', 'CA', 'HI', 'OR', 'WA'],
};
const STATES = Object.values(REGIONS).flat();

const PHONES = ['(555) 010-1234', '555-010-1234', '555.010.1234', '+1 555 010 1234', '5550101234', '1-555-010-1234', '555 010 1234 ext. 7'];
const addresses = (state: string) => [
  `12 Elm Street, Springfield, ${state} 62701`,
  `12 elm st springfield ${state.toLowerCase()} 62701`,
  `Apt 4B, 12 Elm St.\nSpringfield, ${state}\n62701-1234`,
  `PO Box 77, Springfield, ${state}`,
  `12 Elm Street Springfield ${state}`,
];

describe('the matrix is as wide as it says', () => {
  it('has every state and DC, once, in four regions', () => {
    expect(STATES).toHaveLength(51);
    expect(new Set(STATES).size).toBe(51);
    expect(Object.keys(REGIONS)).toEqual(['Northeast', 'Midwest', 'South', 'West']);
  });
});

/** The eligibility rules' whole outcome for a profile, or the compliance rules' (the status, which is what a decision rests on). */
const eligibility = (profile: Record<string, unknown>) => {
  const { determinedAt, ...rest } = checkExemptionEligibility(profile as any);
  return rest;
};

// The facts the rules do read, in combinations that reach every branch (each exemption type eligible, not eligible and pending)
const FACTS = [
  { label: 'a senior with no income on file', dob: '1950-06-01', income: null, hardship: false },
  { label: 'a senior on a low income with hardship', dob: '1955-03-15', income: 15000, hardship: true },
  { label: 'a younger adult below the income line', dob: '1995-09-09', income: 19999, hardship: false },
  { label: 'a younger adult at the income line with hardship', dob: '1990-01-31', income: 20000, hardship: true },
  { label: 'a younger adult with a high income', dob: '2000-12-25', income: 85000, hardship: false },
];

describe.each(FACTS)('eligibility rules for $label', ({ dob, income, hardship }) => {
  const reference = eligibility({ id: 'ref', dob, income, hasDocumentedHardship: hardship });

  it.each(NAMES)('are the same for %s', (name) => {
    expect(eligibility({ id: 'x', dob, income, hasDocumentedHardship: hardship, fullName: name, name })).toEqual(reference);
  });

  it.each(STATES)('are the same in %s, with the address written five ways', (state) => {
    for (const address of addresses(state)) {
      expect(eligibility({ id: 'x', dob, income, hasDocumentedHardship: hardship, address, state })).toEqual(reference);
    }
  });

  it.each(PHONES)('are the same with the phone %s', (phone) => {
    expect(eligibility({ id: 'x', dob, income, hasDocumentedHardship: hardship, phone })).toEqual(reference);
  });

  it('are the same for every name, state, phone and address together', () => {
    const outcomes = new Set<string>();
    NAMES.forEach((name, i) =>
      STATES.forEach((state, j) => {
        const address = addresses(state)[(i + j) % 5];
        const phone = PHONES[(i + j) % PHONES.length];
        outcomes.add(JSON.stringify(eligibility({ id: 'x', dob, income, hasDocumentedHardship: hardship, fullName: name, address, phone })));
      })
    );
    expect([...outcomes]).toEqual([JSON.stringify(reference)]);
  });
});

describe('the registration compliance check', () => {
  const adult = '1980-02-02';
  const reference = determineCompliance({ dob: adult, phone: PHONES[0], address: addresses('IL')[0] });

  it('finds an adult with a phone and an address Eligible, however the phone and the address are written', () => {
    expect(reference).toBe('Eligible');
    for (const state of STATES) for (const phone of PHONES) for (const address of addresses(state)) {
      expect(determineCompliance({ dob: adult, phone, address })).toBe(reference);
    }
  });

  it('does not look at the name, whoever the person is', () => {
    for (const name of NAMES) expect(determineCompliance({ dob: adult, phone: PHONES[1], address: addresses('TX')[2], full_name: name, fullName: name })).toBe(reference);
  });

  it('gives the same answer for the same missing details, for everyone', () => {
    for (const name of NAMES) {
      expect(determineCompliance({ dob: adult, phone: '', address: addresses('CA')[0], fullName: name })).toBe('Pending Review');
      expect(determineCompliance({ dob: adult, phone: PHONES[0], address: '  ', fullName: name })).toBe('Pending Review');
      expect(determineCompliance({ dob: '2015-01-01', phone: PHONES[0], address: addresses('CA')[0], fullName: name })).toBe('Ineligible');
    }
  });
});

describe('the decision controls', () => {
  const decision = (email: string, change: Partial<DecisionContext> = {}): DecisionContext => ({
    decision: 'Approved', applicantId: 'applicant', deciderId: 'decider', deciderEmail: email, assignedTo: email, fromStatus: 'In Review',
    reason: 'Meets the rule.', exemptionType: 'Type A', exemptionStatus: 'Eligible', exemptionReason: 'Applicant is 65 or older.',
    determinedAt: new Date('2026-10-02T10:00:00Z'), profileUpdatedAt: new Date('2026-10-01T10:00:00Z'), applicantNotified: true, auditLogged: true,
    documentTypes: ['proof_of_age'], ...change,
  });
  const passes = (context: DecisionContext) => evaluateControls(context).map((r) => [r.controlId, r.passed]);

  // The deciders' addresses suggest different genders and ethnicities; the controls look at who decided, never at who they are
  const EMAILS = NAMES.map((name) => `${name.toLowerCase().replace(/[^a-z]/g, '.')}@example.com`);

  it.each([
    ['an approval that meets every control', {}],
    ['an approval from the wrong status, without its document', { fromStatus: 'Submitted', documentTypes: [] }],
    ['a denial with no reason', { decision: 'Denied' as const, reason: '', applicantNotified: false }],
    ['an approval by someone the case is not assigned to', { assignedTo: 'someone.else@example.com' }],
  ] as [string, Partial<DecisionContext>][])('give the same pass and fail for %s whoever decides it', (_label, change) => {
    const reference = passes(decision('reference@example.com', change));
    for (const email of EMAILS) {
      // CTRL-05 compares the assignee with the decider, so the assignee follows the decider except where the case is meant to be someone else's
      const assignedTo = change.assignedTo ?? email;
      expect(passes(decision(email, { ...change, assignedTo }))).toEqual(reference);
    }
  });
});

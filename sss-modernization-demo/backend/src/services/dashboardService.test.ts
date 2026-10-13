jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));

import pool from '../database/connection';
import { APPLICANT_EVENT_TYPES } from './caseService';
import { HISTORY_LIMIT, RECENT_NOTIFICATIONS, getCitizenDashboard, nextStepFor } from './dashboardService';

const query = pool.query as unknown as jest.Mock;

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MY_CASE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CASE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF_EMAIL = 'dana.whitfield@example.com';
const DENIAL_REASON = 'Proof of age does not match the date of birth on file.';
const SECRET_NOTE = 'Applicant sounded evasive on the phone';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 12, 9, minutes));

interface Data {
  users: any[];
  exemptions: any[];
  cases: any[];
  events: any[];
  notifications: any[];
}

const user = (id: string, extra: any = {}) => ({
  id,
  email: `${id.slice(0, 4)}@example.com`,
  full_name: 'Avery Lane',
  dob: '1950-03-14',
  phone: '555-0111',
  address: '12 Elm Street, Dayton, OH',
  annual_income: null,
  has_documented_hardship: false,
  mfa_enabled: false,
  compliance_status: 'Eligible',
  compliance_checked_at: at(0),
  created_at: at(0),
  // Columns the dashboard must never pass on
  ssn: '900-00-0010',
  ssn_hash: '$2b$12$notarealhashnotarealhashnotarealhashnotarealhash',
  password_hash: '$2b$12$notarealpasswordhashnotarealpasswordhashnotreal',
  ...extra,
});

const exemption = (id: string, userId: string, type: string, status: string, reason: string) => ({
  id,
  user_id: userId,
  exemption_type: type,
  status,
  reason,
  determined_at: at(1),
  determined_by: 'system',
});

const caseRow = (id: string, userId: string, exemptionId: string, status: string, extra: any = {}) => ({
  id,
  user_id: userId,
  applicant_name: 'Avery Lane',
  applicant_email: 'avery@example.com',
  exemption_id: exemptionId,
  exemption_type: 'Type A',
  status,
  assigned_to: null,
  created_at: at(2),
  updated_at: at(9),
  submitted_at: at(2),
  approved_at: null,
  ...extra,
});

const event = (id: string, caseId: string, type: string, minutes: number, extra: any = {}) => ({
  id,
  case_id: caseId,
  event_type: type,
  from_status: null,
  to_status: null,
  actor_email: STAFF_EMAIL,
  detail: null,
  created_at: at(minutes),
  ...extra,
});

/** A registrant with a Denied Type A case, plus a staff note and assignment on it, and another registrant's data beside it. */
function seed(): Data {
  return {
    users: [user(ME), user(OTHER, { full_name: 'Jordan Rivera' })],
    exemptions: [
      exemption('ex-a', ME, 'Type A', 'Eligible', 'Applicant is 65 or older.'),
      exemption('ex-b', ME, 'Type B', 'Not Eligible', 'No annual income on file. Add it to your profile to be considered.'),
      exemption('ex-other', OTHER, 'Type A', 'Eligible', 'Applicant is 65 or older.'),
    ],
    cases: [
      caseRow(MY_CASE, ME, 'ex-a', 'Denied', { assigned_to: STAFF_EMAIL }),
      caseRow(OTHER_CASE, OTHER, 'ex-other', 'Approved', { approved_at: at(8) }),
    ],
    events: [
      event('e1', MY_CASE, 'created', 2, { to_status: 'Submitted', detail: 'Application for Type A' }),
      event('e2', MY_CASE, 'assigned', 3, { detail: `Assigned to ${STAFF_EMAIL}` }),
      event('e3', MY_CASE, 'note', 4, { detail: 'Internal note added' }),
      event('e4', MY_CASE, 'status_change', 5, { from_status: 'Submitted', to_status: 'In Review' }),
      event('e5', MY_CASE, 'status_change', 7, { from_status: 'In Review', to_status: 'Denied', detail: DENIAL_REASON }),
      event('e6', MY_CASE, 'document', 8, { detail: 'Document added: proof_of_age' }),
      event('e7', MY_CASE, 'compliance_review', 9, { detail: 'Compliance exception accepted' }),
      event('x1', OTHER_CASE, 'created', 6, { to_status: 'Submitted' }),
      event('x2', OTHER_CASE, 'status_change', 10, { from_status: 'In Review', to_status: 'Approved' }),
    ],
    notifications: [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `n${i}`,
        user_id: ME,
        case_id: MY_CASE,
        message: `Message ${i}`,
        read_at: i < 4 ? at(30) : null,
        created_at: at(10 + i),
      })),
      { id: 'nx', user_id: OTHER, case_id: OTHER_CASE, message: 'Not mine', read_at: null, created_at: at(40) },
    ],
  };
}

/**
 * Answers the queries the dashboard makes the way the database would: filtered by the user id and
 * event types passed in as parameters. A query nobody expected (case_notes, say) fails the test.
 */
function database(data: Data, { ignoreEventTypeFilter = false } = {}) {
  const newestFirst = (a: any, b: any) => b.created_at.getTime() - a.created_at.getTime();
  query.mockImplementation(async (sql: string, params: any[] = []) => {
    const text = sql.replace(/\s+/g, ' ');
    const [userId] = params;
    const caseOf = (ev: any) => data.cases.find((c) => c.id === ev.case_id);

    if (text.includes('FROM cases c JOIN users u')) {
      const exemptionType = (c: any) => data.exemptions.find((e) => e.id === c.exemption_id)?.exemption_type ?? null;
      return {
        rows: data.cases
          .filter((c) => c.user_id === userId)
          .map((c) => ({ ...c, exemption_type: exemptionType(c) }))
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime()),
      };
    }
    if (text.includes('FROM exemptions WHERE user_id')) {
      return { rows: data.exemptions.filter((e) => e.user_id === userId) };
    }
    if (text.includes('DISTINCT ON (ev.case_id)')) {
      const latest = new Map<string, any>();
      for (const ev of [...data.events].sort(newestFirst)) {
        const c = caseOf(ev);
        if (c?.user_id === userId && c.status === 'Denied' && ev.event_type === 'status_change' && ev.to_status === 'Denied') {
          if (!latest.has(ev.case_id)) latest.set(ev.case_id, ev);
        }
      }
      return { rows: [...latest.values()] };
    }
    if (text.includes('FROM case_events ev JOIN cases c')) {
      const [, eventTypes, limit] = params;
      const rows = data.events
        .filter((ev) => caseOf(ev)?.user_id === userId && (ignoreEventTypeFilter || eventTypes.includes(ev.event_type)))
        .sort(newestFirst)
        .slice(0, limit)
        .map((ev) => ({ ...ev, exemption_type: 'Type A' }));
      return { rows };
    }
    if (text.includes('FROM notifications WHERE user_id = $1 ORDER BY')) {
      return { rows: data.notifications.filter((n) => n.user_id === userId).sort(newestFirst).slice(0, params[1]) };
    }
    if (text.includes('COUNT(*) AS n FROM notifications')) {
      return { rows: [{ n: String(data.notifications.filter((n) => n.user_id === userId && n.read_at === null).length) }] };
    }
    if (text.includes('FROM users WHERE id = $1')) {
      return { rows: data.users.filter((u) => u.id === userId) };
    }
    throw new Error(`Unexpected query: ${text}`);
  });
}

beforeEach(() => query.mockReset());

describe('citizen dashboard data', () => {
  it("reads only the signed-in user's own rows: every query is scoped to their id", async () => {
    database(seed());
    const dashboard = await getCitizenDashboard(ME);

    expect(query.mock.calls.length).toBeGreaterThan(0);
    for (const [, params] of query.mock.calls) expect(params[0]).toBe(ME);
    expect(dashboard.applications.map((a) => a.id)).toEqual([MY_CASE]);
    expect(dashboard.history.every((e) => e.caseId === MY_CASE)).toBe(true);
    expect(dashboard.notifications.recent.every((n) => n.message !== 'Not mine')).toBe(true);
    expect(dashboard.eligibility.map((e) => e.exemptionType)).toEqual(['Type A', 'Type B']);
  });

  it('finds history through the user\'s cases, not through case ids it was handed', async () => {
    database(seed());
    await getCitizenDashboard(ME);

    const history = query.mock.calls.find(([sql]) => String(sql).includes('ev.event_type = ANY($2)'))!;
    expect(history[0]).toContain('c.user_id = $1');
    expect(history[1]).toEqual([ME, APPLICANT_EVENT_TYPES, HISTORY_LIMIT]);
  });

  it('shows the application with its label, status, dates, next step and the denial reason', async () => {
    database(seed());
    const { applications } = await getCitizenDashboard(ME);

    expect(applications).toEqual([
      {
        id: MY_CASE,
        exemptionType: 'Type A',
        label: 'Type A - Senior Exemption',
        status: 'Denied',
        submittedAt: at(2),
        updatedAt: at(9),
        caseManagerAssigned: true,
        decisionReason: DENIAL_REASON,
        nextStep: 'Read the reason; you can appeal from the case page.',
      },
    ]);
  });

  it('gives the reason only while the case is Denied, and says only whether a case manager is assigned', async () => {
    const data = seed();
    data.cases[0] = { ...data.cases[0], status: 'Appealed', assigned_to: null };
    database(data);
    const { applications } = await getCitizenDashboard(ME);

    expect(applications[0]).toMatchObject({ status: 'Appealed', decisionReason: null, caseManagerAssigned: false });
  });

  it('lists the latest determination of each exemption type with its label and reason', async () => {
    database(seed());
    const { eligibility } = await getCitizenDashboard(ME);

    expect(eligibility).toEqual([
      {
        exemptionType: 'Type A',
        label: 'Type A - Senior Exemption',
        status: 'Eligible',
        reason: 'Applicant is 65 or older.',
        determinedAt: at(1),
      },
      {
        exemptionType: 'Type B',
        label: 'Type B - Income-Based Exemption',
        status: 'Not Eligible',
        reason: 'No annual income on file. Add it to your profile to be considered.',
        determinedAt: at(1),
      },
    ]);
  });
});

describe('case history', () => {
  it('never includes internal notes, assignments or compliance reviews, and never asks for case notes', async () => {
    const data = seed();
    database(data);
    const { history } = await getCitizenDashboard(ME);

    // e2 is the assignment, e3 the note and e7 the compliance review: all staff-only
    expect(history.map((e) => e.id)).toEqual(['e6', 'e5', 'e4', 'e1']);
    expect(history.map((e) => e.description)).toEqual([
      'Document added: Proof of age',
      'Status changed: In Review → Denied',
      'Status changed: Submitted → In Review',
      'Application submitted',
    ]);
    const shown = JSON.stringify(history);
    for (const hidden of ['Internal note', 'Assigned to', STAFF_EMAIL, 'Compliance exception']) {
      expect(shown).not.toContain(hidden);
    }
    expect(query.mock.calls.some(([sql]) => /case_notes/.test(String(sql)))).toBe(false);
  });

  it('asks the database only for the event types the case page shows an applicant', () => {
    expect(APPLICANT_EVENT_TYPES).toEqual(['created', 'status_change', 'document']);
    expect(APPLICANT_EVENT_TYPES).not.toContain('note');
    expect(APPLICANT_EVENT_TYPES).not.toContain('assigned');
  });

  it('still drops staff-only events if the database ever returned them', async () => {
    database(seed(), { ignoreEventTypeFilter: true });
    const { history } = await getCitizenDashboard(ME);

    expect(history.map((e) => e.id)).toEqual(['e6', 'e5', 'e4', 'e1']);
  });

  it('keeps the newest events, newest first, up to the limit', async () => {
    const data = seed();
    data.events = Array.from({ length: 14 }, (_, i) =>
      event(`m${i}`, MY_CASE, 'status_change', i, { from_status: 'In Review', to_status: 'Appealed' })
    );
    database(data);
    const { history } = await getCitizenDashboard(ME);

    expect(HISTORY_LIMIT).toBe(10);
    expect(history).toHaveLength(10);
    expect(history.map((e) => e.id)).toEqual(Array.from({ length: 10 }, (_, i) => `m${13 - i}`));
    expect(history[0]).toEqual({
      id: 'm13',
      caseId: MY_CASE,
      exemptionType: 'Type A',
      description: 'Status changed: In Review → Appealed',
      createdAt: at(13),
    });
  });
});

describe('next step for each status', () => {
  it.each([
    ['Draft', 'Submit your application from the case page.'],
    ['Submitted', 'Waiting for a case manager to pick it up.'],
    ['In Review', 'A case manager is reviewing it.'],
    ['Approved', 'Exemption granted. Nothing more to do.'],
    ['Denied', 'Read the reason; you can appeal from the case page.'],
    ['Appealed', 'Your appeal is waiting for review.'],
  ])('%s: %s', async (status, nextStep) => {
    const data = seed();
    data.cases[0] = { ...data.cases[0], status };
    database(data);
    const { applications } = await getCitizenDashboard(ME);

    expect(applications[0].nextStep).toBe(nextStep);
    expect(nextStepFor(status)).toBe(nextStep);
  });

  it('points to the case page for a status it does not know', () => {
    expect(nextStepFor('Archived')).toBe('Open the case page for details.');
  });
});

describe('notifications', () => {
  it('gives the unread count and the five newest', async () => {
    database(seed());
    const { notifications } = await getCitizenDashboard(ME);

    expect(RECENT_NOTIFICATIONS).toBe(5);
    expect(notifications.unread).toBe(3);
    expect(notifications.recent.map((n) => n.message)).toEqual(['Message 6', 'Message 5', 'Message 4', 'Message 3', 'Message 2']);
    expect(notifications.recent[0]).toEqual({ id: 'n6', caseId: MY_CASE, message: 'Message 6', read: false, createdAt: at(16) });
  });
});

describe('profile check', () => {
  it('passes when the user is 18 or older with a phone and an address', async () => {
    database(seed());
    expect((await getCitizenDashboard(ME)).profile).toEqual({ passesComplianceCheck: true, complianceStatus: 'Eligible', missing: [] });
  });

  it.each([
    ['no phone', { phone: null }, ['Phone number']],
    ['a blank phone', { phone: '   ' }, ['Phone number']],
    ['no address', { address: null }, ['Address']],
    ['neither', { phone: null, address: '' }, ['Phone number', 'Address']],
  ])('lists what is missing with %s', async (_label, changes, missing) => {
    const data = seed();
    data.users[0] = { ...data.users[0], ...changes };
    database(data);
    expect((await getCitizenDashboard(ME)).profile).toEqual({ passesComplianceCheck: false, complianceStatus: 'Pending Review', missing });
  });

  it('fails the age rule for someone under 18', async () => {
    const data = seed();
    data.users[0] = { ...data.users[0], dob: `${new Date().getFullYear() - 10}-01-01` };
    database(data);
    expect((await getCitizenDashboard(ME)).profile).toEqual({
      passesComplianceCheck: false,
      complianceStatus: 'Ineligible',
      missing: ['Age 18 or older'],
    });
  });
});

describe('what the dashboard never contains', () => {
  it('has no SSN, password or hash anywhere in the output', async () => {
    database(seed());
    const shown = JSON.stringify(await getCitizenDashboard(ME));

    expect(shown).not.toMatch(/ssn/i);
    expect(shown).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(shown).not.toMatch(/password|\$2b\$/i);
  });

  it('keeps staff identities and note text out of the output', async () => {
    const data = seed();
    data.cases[0].assigned_to = STAFF_EMAIL;
    data.events.push(event('e9', MY_CASE, 'note', 11, { detail: SECRET_NOTE }));
    database(data);
    const shown = JSON.stringify(await getCitizenDashboard(ME));

    expect(shown).not.toContain(STAFF_EMAIL);
    expect(shown).not.toContain(SECRET_NOTE);
    expect(shown).not.toMatch(/actorEmail|assignedTo|noteBy|applicantEmail/);
  });
});

describe('a new user', () => {
  it('gets an empty dashboard, and is told the profile still needs a phone and an address', async () => {
    const data: Data = {
      users: [user(ME, { phone: null, address: null, compliance_status: 'Pending Review' })],
      exemptions: [],
      cases: [],
      events: [],
      notifications: [],
    };
    database(data);

    expect(await getCitizenDashboard(ME)).toEqual({
      applications: [],
      eligibility: [],
      history: [],
      notifications: { unread: 0, recent: [] },
      profile: { passesComplianceCheck: false, complianceStatus: 'Pending Review', missing: ['Phone number', 'Address'] },
    });
  });
});

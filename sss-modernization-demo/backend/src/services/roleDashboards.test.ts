// STORY-013 to 015: the case manager, admin and leadership dashboards. Runs without a database: the mock answers each
// query the way the database would, applying the filters and limits the code passes as parameters, so a rule the code
// gets wrong (the overdue threshold, whose reviews a manager may resolve) shows up here. What the SQL itself computes
// (medians, weeks, stage durations) is checked against a real database by scripts/e2e/dashboards.mjs.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('./freshnessService', () => ({ ...jest.requireActual('./freshnessService'), getFreshnessDashboard: jest.fn() }));
jest.mock('./complianceService', () => ({ ...jest.requireActual('./complianceService'), getDashboard: jest.fn() }));

import pool from '../database/connection';
import { OPEN_STATUSES } from './caseService';
import { getDashboard as getComplianceDashboard } from './complianceService';
import { getFreshnessDashboard } from './freshnessService';
import {
  OVERDUE_DAYS,
  RECENT_DECISIONS,
  TREND_WEEKS,
  UNASSIGNED_SHOWN,
  WORK_LIST_LIMIT,
  getAdminDashboard,
  getCaseManagerDashboard,
  getLeadershipDashboard,
  isOverdue,
  percent,
  weekStarts,
  weeklyTrend,
} from './dashboardService';

const query = pool.query as unknown as jest.Mock;
const freshness = getFreshnessDashboard as jest.Mock;
const compliance = getComplianceDashboard as jest.Mock;

const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.UTC(2026, 9, 13, 12) - days * DAY);

describe('the overdue rule (STORY-013)', () => {
  it('is more than 5 whole days since the last update', () => {
    expect(OVERDUE_DAYS).toBe(5);
    expect([0, 4, 5].map(isOverdue)).toEqual([false, false, false]);
    expect([6, 7, 40].map(isOverdue)).toEqual([true, true, true]);
  });
});

describe('percent', () => {
  it('rounds to two decimals, and is null when there is nothing to divide by', () => {
    expect(percent(2, 3)).toBe(66.67);
    expect(percent(1, 1)).toBe(100);
    expect(percent(0, 4)).toBe(0);
    expect(percent(0, 0)).toBeNull();
    expect(percent(3, 0)).toBeNull();
  });
});

// ---- STORY-013 ----

const ME = { id: '11111111-1111-4111-8111-111111111111', email: 'dana.whitfield@example.com' };
const OTHER_MANAGER = 'sam.ortiz@example.com';

interface CaseRow {
  id: string;
  status: string;
  assigned_to: string | null;
  days: number;
  applicant_name?: string;
  user_id?: string;
  exemption_type?: string | null;
  submitted_days?: number;
}

const caseRow = (id: string, status: string, assigned_to: string | null, days: number, extra: Partial<CaseRow> = {}): CaseRow => ({ id, status, assigned_to, days, ...extra });

interface ReviewRow {
  id: string;
  case_id: string;
  status: string;
  decided_by_email: string | null;
  applicant_id: string;
}

interface DecisionRow {
  case_id: string;
  actor_id: string;
  event_type: string;
  to_status: string;
  days: number;
}

interface WorkData {
  cases: CaseRow[];
  reviews: ReviewRow[];
  decisions: DecisionRow[];
}

/** The columns the code asks for, plus columns it must never pass on (the applicant's email and ids). */
const workRow = (c: CaseRow, total: number) => ({
  id: c.id,
  applicant_name: c.applicant_name ?? `Applicant ${c.id}`,
  applicant_email: `${c.id}@applicant.example.com`,
  user_id: c.user_id ?? `user-of-${c.id}`,
  ssn_hash: '$2b$12$notarealhash',
  exemption_type: c.exemption_type === undefined ? 'Type A' : c.exemption_type,
  status: c.status,
  assigned_to: c.assigned_to,
  submitted_at: daysAgo((c.submitted_days ?? c.days) + 1),
  updated_at: daysAgo(c.days),
  days_since_update: c.days,
  total,
});

function managerDatabase(data: WorkData) {
  const byAge = (a: CaseRow, b: CaseRow) => b.days - a.days || a.id.localeCompare(b.id);
  query.mockImplementation(async (sql: string, params: any[] = []) => {
    const text = normalized(sql);
    if (text.includes('WHERE lower(c.assigned_to) = lower($1) AND c.status = ANY($2)')) {
      const [email, statuses, limit] = params;
      const rows = data.cases.filter((c) => c.assigned_to?.toLowerCase() === email.toLowerCase() && statuses.includes(c.status)).sort(byAge);
      return { rows: rows.slice(0, limit).map((c) => workRow(c, rows.length)) };
    }
    if (text.includes('WHERE c.assigned_to IS NULL AND c.status = ANY($1) ORDER BY COALESCE(c.submitted_at, c.created_at)')) {
      const [statuses, limit] = params;
      const rows = data.cases.filter((c) => c.assigned_to === null && statuses.includes(c.status)).sort((a, b) => (b.submitted_days ?? b.days) - (a.submitted_days ?? a.days) || a.id.localeCompare(b.id));
      return { rows: rows.slice(0, limit).map((c) => workRow(c, rows.length)) };
    }
    if (text.includes('WHERE c.assigned_to IS NULL AND c.status = ANY($1) AND GREATEST(FLOOR(') && text.includes('> $2')) {
      const [statuses, overdueDays, limit] = params;
      const rows = data.cases.filter((c) => c.assigned_to === null && statuses.includes(c.status) && c.days > overdueDays).sort(byAge);
      return { rows: rows.slice(0, limit).map((c) => workRow(c, rows.length)) };
    }
    if (text.includes('FROM compliance_reviews r')) {
      const [email, userId, limit] = params;
      const owner = (r: ReviewRow) => data.cases.find((c) => c.id === r.case_id)?.user_id ?? `user-of-${r.case_id}`;
      const rows = data.reviews.filter((r) => r.status === 'Open' && r.decided_by_email?.toLowerCase() !== email.toLowerCase() && owner(r) !== userId);
      return {
        rows: rows.slice(0, limit).map((r) => ({
          id: r.id,
          case_id: r.case_id,
          decision: 'Approved',
          decided_by_email: r.decided_by_email,
          failed_controls: ['CTRL-05'],
          opened_at: daysAgo(1),
          applicant_name: `Applicant ${r.case_id}`,
          applicant_email: `${r.case_id}@applicant.example.com`,
          exemption_type: 'Type A',
          total: rows.length,
        })),
      };
    }
    if (text.includes("WHERE ev.event_type = 'status_change' AND ev.to_status IN ('Approved', 'Denied') AND ev.actor_id = $1")) {
      const [actorId, limit] = params;
      const rows = data.decisions.filter((d) => d.actor_id === actorId && d.event_type === 'status_change' && ['Approved', 'Denied'].includes(d.to_status)).sort((a, b) => a.days - b.days);
      return {
        rows: rows.slice(0, limit).map((d) => ({ case_id: d.case_id, to_status: d.to_status, created_at: daysAgo(d.days), applicant_name: `Applicant ${d.case_id}`, exemption_type: 'Type A' })),
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  });
}

const emptyWork = (): WorkData => ({ cases: [], reviews: [], decisions: [] });
const idsOf = (list: { id: string }[]) => list.map((c) => c.id);

beforeEach(() => {
  query.mockReset();
  freshness.mockReset();
  compliance.mockReset();
});

describe('case manager dashboard (STORY-013)', () => {
  it('is empty for a case manager with no work', async () => {
    managerDatabase(emptyWork());
    expect(await getCaseManagerDashboard(ME)).toEqual({
      overdueDays: 5,
      myOpenCases: { total: 0, cases: [] },
      waitingOnMe: { toStart: { total: 0, cases: [] }, toDecide: { total: 0, cases: [] }, reviews: { total: 0, reviews: [] } },
      unassigned: { total: 0, oldest: [] },
      overdue: { total: 0, cases: [] },
      recentDecisions: [],
    });
  });

  it("shows only the caller's own cases, and never a decided one: every query is scoped to their email or id", async () => {
    const data = emptyWork();
    data.cases = [
      caseRow('mine-submitted', 'Submitted', ME.email.toUpperCase(), 1), // matched whatever the case
      caseRow('mine-review', 'In Review', ME.email, 2),
      caseRow('mine-approved', 'Approved', ME.email, 9),
      caseRow('mine-denied', 'Denied', ME.email, 9),
      caseRow('theirs', 'In Review', OTHER_MANAGER, 9),
    ];
    managerDatabase(data);
    const dashboard = await getCaseManagerDashboard(ME);

    expect(idsOf(dashboard.myOpenCases.cases)).toEqual(['mine-review', 'mine-submitted']);
    expect(dashboard.myOpenCases.total).toBe(2);
    const scoped = query.mock.calls.filter(([sql]) => /lower\(c\.assigned_to\) = lower\(\$1\)|ev\.actor_id = \$1|lower\(\$1\)/.test(String(sql)));
    expect(scoped.length).toBe(3);
    for (const [, params] of scoped) expect([ME.email, ME.id]).toContain(params[0]);
    expect(query.mock.calls.find(([sql]) => /lower\(c\.assigned_to\) = lower\(\$1\)/.test(String(sql)))![1]).toEqual([ME.email, OPEN_STATUSES, 500]);
  });

  it('describes each case with its applicant name, exemption type, status, days since the last update and overdue flag', async () => {
    const data = emptyWork();
    data.cases = [caseRow('c1', 'In Review', ME.email, 6, { applicant_name: 'Avery Lane', exemption_type: null })];
    managerDatabase(data);
    const [item] = (await getCaseManagerDashboard(ME)).myOpenCases.cases;
    expect(item).toEqual({
      id: 'c1',
      applicantName: 'Avery Lane',
      exemptionType: null,
      status: 'In Review',
      assignedTo: ME.email,
      submittedAt: daysAgo(7),
      updatedAt: daysAgo(6),
      daysSinceUpdate: 6,
      overdue: true,
    });
  });

  it('puts Submitted cases to start and In Review or Appealed cases to decide under waiting on me', async () => {
    const data = emptyWork();
    data.cases = [
      caseRow('start-1', 'Submitted', ME.email, 3),
      caseRow('start-2', 'Submitted', ME.email, 1),
      caseRow('review', 'In Review', ME.email, 2),
      caseRow('appeal', 'Appealed', ME.email, 4),
      caseRow('draft', 'Draft', ME.email, 4),
    ];
    managerDatabase(data);
    const { waitingOnMe, myOpenCases } = await getCaseManagerDashboard(ME);

    expect([waitingOnMe.toStart.total, idsOf(waitingOnMe.toStart.cases)]).toEqual([2, ['start-1', 'start-2']]);
    expect([waitingOnMe.toDecide.total, idsOf(waitingOnMe.toDecide.cases)]).toEqual([2, ['appeal', 'review']]);
    expect(myOpenCases.total).toBe(5); // a Draft is open too, though nothing waits on the case manager for it
  });

  describe('overdue: more than 5 days with no update, among the caller\'s cases and the unassigned ones', () => {
    it('counts 6 days and not 5, for their own cases and for unassigned ones', async () => {
      const data = emptyWork();
      data.cases = [
        caseRow('mine-5', 'In Review', ME.email, 5),
        caseRow('mine-6', 'In Review', ME.email, 6),
        caseRow('free-5', 'Submitted', null, 5),
        caseRow('free-6', 'Submitted', null, 6),
        caseRow('free-9', 'Submitted', null, 9),
        caseRow('theirs-9', 'In Review', OTHER_MANAGER, 9), // someone else's case is not mine to chase
      ];
      managerDatabase(data);
      const { overdue } = await getCaseManagerDashboard(ME);

      expect(idsOf(overdue.cases)).toEqual(['free-9', 'free-6', 'mine-6']);
      expect(overdue.total).toBe(3);
      expect(overdue.cases.map((c) => c.overdue)).toEqual([true, true, true]);
      expect(query.mock.calls.find(([sql]) => String(sql).includes('> $2'))![1][1]).toBe(OVERDUE_DAYS);
    });

    it('lists the least recently updated first, mixing the two sources', async () => {
      const data = emptyWork();
      data.cases = [caseRow('mine-8', 'Submitted', ME.email, 8), caseRow('free-12', 'Submitted', null, 12), caseRow('mine-30', 'Appealed', ME.email, 30), caseRow('free-7', 'In Review', null, 7)];
      managerDatabase(data);
      expect(idsOf((await getCaseManagerDashboard(ME)).overdue.cases)).toEqual(['mine-30', 'free-12', 'mine-8', 'free-7']);
    });

    it('does not count decided cases', async () => {
      const data = emptyWork();
      data.cases = [caseRow('approved', 'Approved', ME.email, 20), caseRow('denied', 'Denied', null, 20)];
      managerDatabase(data);
      expect((await getCaseManagerDashboard(ME)).overdue.total).toBe(0);
    });

    it('keeps the true total when the list is cut to its limit', async () => {
      const data = emptyWork();
      data.cases = Array.from({ length: 30 }, (_, i) => caseRow(`mine-${String(i).padStart(2, '0')}`, 'In Review', ME.email, 10 + i));
      managerDatabase(data);
      const { overdue, myOpenCases } = await getCaseManagerDashboard(ME);
      expect([WORK_LIST_LIMIT, overdue.total, overdue.cases.length, myOpenCases.total, myOpenCases.cases.length]).toEqual([25, 30, 25, 30, 25]);
      expect(overdue.cases[0].id).toBe('mine-29'); // 39 days: the stalest
    });
  });

  describe('the unassigned queue', () => {
    it('is the count and the five oldest open cases, oldest first, and leaves out decided and assigned ones', async () => {
      const data = emptyWork();
      data.cases = [
        ...Array.from({ length: 7 }, (_, i) => caseRow(`free-${i}`, 'Submitted', null, 1, { submitted_days: i + 1 })),
        caseRow('assigned', 'Submitted', ME.email, 1, { submitted_days: 99 }),
        caseRow('decided', 'Approved', null, 1, { submitted_days: 99 }),
      ];
      managerDatabase(data);
      const { unassigned } = await getCaseManagerDashboard(ME);

      expect(UNASSIGNED_SHOWN).toBe(5);
      expect(unassigned.total).toBe(7);
      expect(idsOf(unassigned.oldest)).toEqual(['free-6', 'free-5', 'free-4', 'free-3', 'free-2']);
      expect(unassigned.oldest.every((c) => c.assignedTo === null)).toBe(true);
    });
  });

  describe('compliance reviews the caller may resolve', () => {
    const review = (id: string, caseId: string, decidedBy: string | null, status = 'Open', applicantId = `user-of-${caseId}`): ReviewRow => ({ id, case_id: caseId, status, decided_by_email: decidedBy, applicant_id: applicantId });

    it("lists open reviews of other people's decisions, and not the caller's own decision, their own case or a resolved review", async () => {
      const data = emptyWork();
      data.cases = [caseRow('their-case', 'Approved', null, 1), caseRow('my-own-case', 'Approved', null, 1, { user_id: ME.id })];
      data.reviews = [
        review('r-theirs', 'their-case', OTHER_MANAGER),
        review('r-mine', 'their-case', ME.email.toUpperCase()),
        review('r-my-case', 'my-own-case', OTHER_MANAGER),
        review('r-done', 'their-case', OTHER_MANAGER, 'Resolved'),
        review('r-unknown', 'their-case', null),
      ];
      managerDatabase(data);
      const { waitingOnMe } = await getCaseManagerDashboard(ME);

      expect(waitingOnMe.reviews.reviews.map((r) => r.id)).toEqual(['r-theirs', 'r-unknown']);
      expect(waitingOnMe.reviews.total).toBe(2);
      expect(waitingOnMe.reviews.reviews[0]).toEqual({
        id: 'r-theirs',
        caseId: 'their-case',
        applicantName: 'Applicant their-case',
        exemptionType: 'Type A',
        decision: 'Approved',
        decidedBy: OTHER_MANAGER,
        failedControls: ['CTRL-05'],
        openedAt: daysAgo(1),
      });
      expect(query.mock.calls.find(([sql]) => String(sql).includes('FROM compliance_reviews'))![1]).toEqual([ME.email, ME.id, WORK_LIST_LIMIT]);
    });
  });

  describe('recent decisions', () => {
    it('are the caller\'s five most recent approvals and denials, newest first', async () => {
      const data = emptyWork();
      const decision = (case_id: string, to_status: string, days: number, actor_id = ME.id, event_type = 'status_change'): DecisionRow => ({ case_id, actor_id, event_type, to_status, days });
      data.decisions = [
        ...Array.from({ length: 6 }, (_, i) => decision(`d${i}`, i % 2 ? 'Denied' : 'Approved', i + 1)),
        decision('someone-elses', 'Approved', 0, 'other-id'),
        decision('a-review', 'In Review', 0),
        decision('a-note', 'Approved', 0, ME.id, 'note'),
      ];
      managerDatabase(data);
      const { recentDecisions } = await getCaseManagerDashboard(ME);

      expect(RECENT_DECISIONS).toBe(5);
      expect(recentDecisions.map((d) => [d.caseId, d.decision])).toEqual([['d0', 'Approved'], ['d1', 'Denied'], ['d2', 'Approved'], ['d3', 'Denied'], ['d4', 'Approved']]);
      expect(recentDecisions[0]).toEqual({ caseId: 'd0', applicantName: 'Applicant d0', exemptionType: 'Type A', decision: 'Approved', decidedAt: daysAgo(1) });
    });
  });

  it('passes on only the fields it names: no applicant email, user id or SSN hash', async () => {
    const data = emptyWork();
    data.cases = [caseRow('a', 'In Review', ME.email, 7), caseRow('b', 'Submitted', null, 7)];
    data.reviews = [{ id: 'r', case_id: 'a', status: 'Open', decided_by_email: OTHER_MANAGER, applicant_id: 'x' }];
    managerDatabase(data);
    const shown = JSON.stringify(await getCaseManagerDashboard(ME));
    expect(shown).not.toMatch(/applicant\.example\.com|user-of-|\$2b\$|applicant_email|ssn|userId/i);
  });
});

// ---- STORY-014 ----

interface AdminData {
  byStatus: { status: string; count: number }[];
  byType: { exemption_type: string | null; count: number }[];
  decided: number;
  team: any[];
  migrations: { applied: number; latest: string | null } | Error;
  refusals: number;
  staff: { role: string; n: number }[];
}

const adminData = (): AdminData => ({
  byStatus: [
    { status: 'Submitted', count: 3 },
    { status: 'In Review', count: 2 },
    { status: 'Approved', count: 5 },
    { status: 'Denied', count: 1 },
  ],
  byType: [
    { exemption_type: 'Type A', count: 6 },
    { exemption_type: 'Type C', count: 4 },
    { exemption_type: null, count: 1 },
  ],
  decided: 4,
  team: [],
  migrations: { applied: 17, latest: '017_leadership_role.sql' },
  refusals: 3,
  staff: [
    { role: 'case_manager', n: 2 },
    { role: 'admin', n: 1 },
  ],
});

function adminDatabase(data: AdminData) {
  query.mockImplementation(async (sql: string, params: any[] = []) => {
    const text = normalized(sql);
    if (text.startsWith('SELECT status, COUNT(*)::int AS count FROM cases GROUP BY status')) return { rows: data.byStatus };
    if (text.includes('GROUP BY x.exemption_type')) return { rows: data.byType };
    if (text.startsWith('SELECT COUNT(*)::int AS decided FROM case_events')) return { rows: [{ decided: data.decided }] };
    if (text.includes('FROM users u LEFT JOIN LATERAL')) return { rows: data.team };
    if (text.includes('FROM schema_migrations')) {
      if (data.migrations instanceof Error) throw data.migrations;
      return { rows: [data.migrations] };
    }
    if (text.includes("FROM audit_logs WHERE action = 'ACCESS_DENIED'")) return { rows: [{ n: data.refusals }] };
    if (text.startsWith('SELECT role, COUNT(*)::int AS n FROM users')) return { rows: data.staff };
    throw new Error(`Unexpected query: ${text} ${JSON.stringify(params)}`);
  });
  freshness.mockResolvedValue({ windowHours: 24, targetMs: 30_000, sloPercent: 95, overall: { count: 40, p95Ms: 1200, withinRate: 100 } });
  compliance.mockResolvedValue({ windowDays: 30, target: 99, totalDecisions: 12, complianceRate: 99.5, openReviews: 1 });
}

describe('admin dashboard (STORY-014)', () => {
  it('counts every status, even those with no cases, in workflow order, with the total and the open cases', async () => {
    adminDatabase(adminData());
    const { cases } = await getAdminDashboard();

    expect(cases.byStatus).toEqual([
      { status: 'Draft', count: 0 },
      { status: 'Submitted', count: 3 },
      { status: 'In Review', count: 2 },
      { status: 'Approved', count: 5 },
      { status: 'Denied', count: 1 },
      { status: 'Appealed', count: 0 },
    ]);
    expect(cases.total).toBe(11);
    expect(cases.open).toBe(5); // Draft, Submitted, In Review and Appealed
    expect(cases.decidedLast30Days).toBe(4);
  });

  it('counts each exemption type, those with no cases and any that is not recorded included', async () => {
    adminDatabase(adminData());
    expect((await getAdminDashboard()).cases.byExemptionType).toEqual([
      { exemptionType: 'Type A', count: 6 },
      { exemptionType: 'Type B', count: 0 },
      { exemptionType: 'Type C', count: 4 },
      { exemptionType: 'Not recorded', count: 1 },
    ]);
  });

  it("gives each case manager's open cases, decisions in the last 30 days, median days to decide and compliance pass rate", async () => {
    const data = adminData();
    data.team = [
      { full_name: 'Casey Alder', email: 'casey@example.com', role: 'case_manager', open_assigned: 3, decided: 4, median_days: 2.46, compliant: 3, evaluated: 4 },
      { full_name: 'Morgan Lee', email: 'morgan@example.com', role: 'admin', open_assigned: '0', decided: '0', median_days: null, compliant: '0', evaluated: '0' },
    ];
    adminDatabase(data);
    const { team } = await getAdminDashboard();

    expect(team).toEqual([
      { name: 'Casey Alder', email: 'casey@example.com', role: 'case_manager', openAssigned: 3, decidedLast30Days: 4, medianDaysToDecision: 2.5, compliancePassRate: 75 },
      { name: 'Morgan Lee', email: 'morgan@example.com', role: 'admin', openAssigned: 0, decidedLast30Days: 0, medianDaysToDecision: null, compliancePassRate: null },
    ]);
  });

  describe('system health', () => {
    it('reports the database, migrations, commit, staff by role and refusals', async () => {
      const saved = process.env.RENDER_GIT_COMMIT;
      process.env.RENDER_GIT_COMMIT = 'abcdef0123456789';
      adminDatabase(adminData());
      const { health } = await getAdminDashboard();
      if (saved === undefined) delete process.env.RENDER_GIT_COMMIT;
      else process.env.RENDER_GIT_COMMIT = saved;

      expect([health.database, health.migrations, health.commit]).toEqual(['ok', { applied: 17, latest: '017_leadership_role.sql' }, 'abcdef0']);
      expect(health.auditRefusalsLast24h).toBe(3);
      expect(health.staffByRole).toEqual({ case_manager: 2, leadership: 0, admin: 1 });
    });

    it("says 'local' when no release commit is set, as /health does", async () => {
      const saved = process.env.RENDER_GIT_COMMIT;
      delete process.env.RENDER_GIT_COMMIT;
      adminDatabase(adminData());
      const { health } = await getAdminDashboard();
      if (saved !== undefined) process.env.RENDER_GIT_COMMIT = saved;
      expect(health.commit).toBe('local');
    });

    it('reports the database as unreachable when the migrations cannot be read', async () => {
      const data = adminData();
      data.migrations = new Error('connection refused');
      adminDatabase(data);
      const { health } = await getAdminDashboard();
      expect([health.database, health.migrations]).toEqual(['unreachable', null]);
    });

    it.each([
      [null, 'none'],
      [29_999, 'ok'],
      [30_000, 'ok'],
      [30_001, 'over'],
    ])('freshness p95 %s ms against the 30 s target is %s', async (p95Ms, status) => {
      adminDatabase(adminData());
      freshness.mockResolvedValue({ windowHours: 24, targetMs: 30_000, sloPercent: 95, overall: { count: p95Ms === null ? 0 : 10, p95Ms, withinRate: 100 } });
      const { health } = await getAdminDashboard();
      expect(health.freshness).toEqual({ status, p95Ms, targetMs: 30_000, updates: p95Ms === null ? 0 : 10, withinRate: 100, sloPercent: 95, windowHours: 24 });
    });

    it.each([
      [null, 'none'],
      [98.99, 'below'],
      [99, 'ok'],
      [100, 'ok'],
    ])('compliance rate %s against the 99%% target is %s', async (rate, status) => {
      adminDatabase(adminData());
      compliance.mockResolvedValue({ windowDays: 30, target: 99, totalDecisions: rate === null ? 0 : 50, complianceRate: rate, openReviews: 2 });
      const { health } = await getAdminDashboard();
      expect(health.compliance).toEqual({ status, rate, target: 99, decisions: rate === null ? 0 : 50, openReviews: 2, windowDays: 30 });
    });

    it('reads freshness for the last 24 hours and compliance for the last 30 days', async () => {
      adminDatabase(adminData());
      await getAdminDashboard();
      expect(freshness).toHaveBeenCalledWith(24);
      expect(compliance).toHaveBeenCalledWith(30);
    });
  });

  it('is empty, not broken, for a system with no cases or staff', async () => {
    adminDatabase({ ...adminData(), byStatus: [], byType: [], decided: 0, staff: [], refusals: 0 });
    const { cases, health } = await getAdminDashboard();
    expect([cases.total, cases.open, cases.decidedLast30Days]).toEqual([0, 0, 0]);
    expect(health.staffByRole).toEqual({ case_manager: 0, leadership: 0, admin: 0 });
  });
});

// ---- STORY-015 ----

describe('week bucketing', () => {
  it('lists the Mondays of the last 12 weeks, oldest first, ending with the current week', () => {
    const weeks = weekStarts('2026-10-12');
    expect(TREND_WEEKS).toBe(12);
    expect(weeks).toHaveLength(12);
    expect([weeks[0], weeks[1], weeks[10], weeks[11]]).toEqual(['2026-07-27', '2026-08-03', '2026-10-05', '2026-10-12']);
    expect(weeks.every((week) => new Date(`${week}T00:00:00Z`).getUTCDay() === 1)).toBe(true); // all Mondays
    expect(weeks.every((week, i) => i === 0 || new Date(`${week}T00:00:00Z`).getTime() - new Date(`${weeks[i - 1]}T00:00:00Z`).getTime() === 7 * DAY)).toBe(true);
  });

  it('crosses a year end without skipping or repeating a week', () => {
    expect(weekStarts('2026-01-05', 4)).toEqual(['2025-12-15', '2025-12-22', '2025-12-29', '2026-01-05']);
  });

  it('crosses a daylight-saving change without moving a Monday', () => {
    expect(weekStarts('2026-11-02', 3)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(weekStarts('2026-03-30', 3)).toEqual(['2026-03-16', '2026-03-23', '2026-03-30']);
  });

  it('gives a week with nothing in it a zero, for applications and for decisions separately', () => {
    const trend = weeklyTrend('2026-10-12', [{ week: '2026-10-05', n: 4 }, { week: '2026-10-12', n: '2' }], [{ week: '2026-08-10', n: 7 }]);
    expect(trend).toHaveLength(12);
    expect(trend.find((w) => w.weekStart === '2026-10-05')).toEqual({ weekStart: '2026-10-05', applications: 4, decisions: 0 });
    expect(trend.find((w) => w.weekStart === '2026-10-12')).toEqual({ weekStart: '2026-10-12', applications: 2, decisions: 0 });
    expect(trend.find((w) => w.weekStart === '2026-08-10')).toEqual({ weekStart: '2026-08-10', applications: 0, decisions: 7 });
    expect(trend.filter((w) => w.applications === 0 && w.decisions === 0)).toHaveLength(9);
  });

  it('ignores counts for weeks outside the twelve', () => {
    const trend = weeklyTrend('2026-10-12', [{ week: '2026-07-20', n: 9 }, { week: '2026-10-19', n: 9 }], [{ week: '2025-01-06', n: 9 }]);
    expect(trend.reduce((sum, w) => sum + w.applications + w.decisions, 0)).toBe(0);
  });
});

interface LeadershipData {
  totals: any;
  averageDays: number | null;
  appeals: any;
  currentWeek: string;
  applications: any[];
  decisions: any[];
  stages: any[];
  stuck: any[];
  team: any[];
}

const leadershipData = (): LeadershipData => ({
  totals: { total: 10, open: 4, approved: 4, denied: 2 },
  averageDays: 3.26,
  appeals: { appealed: 1, denied: 4 },
  currentWeek: '2026-10-12',
  applications: [{ week: '2026-10-12', n: 3 }, { week: '2026-10-05', n: 5 }],
  decisions: [{ week: '2026-10-12', n: 2 }],
  stages: [
    { stage: 'reviewToDecision', measured: 6, average_days: 2.04 },
    { stage: 'submittedToReview', measured: 9, average_days: 0.5 },
  ],
  stuck: [{ status: 'Submitted', stuck: 2 }, { status: 'Appealed', stuck: 1 }],
  team: [
    { full_name: 'Casey Alder', decisions: 4, average_days: 1.04, approved: 3 },
    { full_name: 'Blake Bishop', decisions: 2, average_days: null, approved: 1 },
  ],
});

function leadershipDatabase(data: LeadershipData) {
  query.mockImplementation(async (sql: string) => {
    const text = normalized(sql);
    if (text.includes('COUNT(*) FILTER (WHERE status = ANY($1))::int AS open')) return { rows: [data.totals] };
    if (text.startsWith('SELECT AVG(EXTRACT(EPOCH FROM (d.decided_at - c.submitted_at))')) return { rows: [{ average_days: data.averageDays }] };
    if (text.includes('COUNT(DISTINCT case_id)')) return { rows: [data.appeals] };
    if (text.startsWith("SELECT to_char(date_trunc('week', NOW())")) return { rows: [{ week: data.currentWeek }] };
    if (text.includes('FROM cases WHERE COALESCE(submitted_at, created_at) >=')) return { rows: data.applications };
    if (text.includes("FROM case_events WHERE event_type = 'status_change' AND to_status IN ('Approved', 'Denied') AND created_at >=")) return { rows: data.decisions };
    if (text.startsWith('WITH moves AS')) return { rows: data.stages };
    if (text.startsWith('SELECT c.status, COUNT(*)::int AS stuck')) return { rows: data.stuck };
    if (text.includes('GROUP BY u.id, u.full_name')) return { rows: data.team };
    throw new Error(`Unexpected query: ${text}`);
  });
}

describe('leadership dashboard (STORY-015)', () => {
  it('gives the KPIs: applications, approval rate, average processing days, open cases and appeal rate', async () => {
    leadershipDatabase(leadershipData());
    expect((await getLeadershipDashboard()).kpis).toEqual({
      totalApplications: 10,
      openCases: 4,
      approved: 4,
      decided: 6,
      approvalRate: 66.67,
      averageProcessingDays: 3.3,
      appealRate: 25,
      appealed: 1,
      denied: 4,
    });
  });

  it('has no approval rate while nothing is decided, not a zero and not NaN', async () => {
    const data = leadershipData();
    data.totals = { total: 3, open: 3, approved: 0, denied: 0 };
    data.averageDays = null;
    data.appeals = { appealed: 0, denied: 0 };
    leadershipDatabase(data);
    const { kpis } = await getLeadershipDashboard();

    expect([kpis.decided, kpis.approvalRate, kpis.averageProcessingDays, kpis.appealRate]).toEqual([0, null, null, null]);
    expect(JSON.stringify(kpis)).not.toMatch(/NaN|Infinity/);
  });

  it('has a zero approval rate, not none, when every decision was a denial', async () => {
    const data = leadershipData();
    data.totals = { total: 2, open: 0, approved: 0, denied: 2 };
    leadershipDatabase(data);
    expect((await getLeadershipDashboard()).kpis.approvalRate).toBe(0);
  });

  it('has an approval rate of 100 when every decision was an approval', async () => {
    const data = leadershipData();
    data.totals = { total: 2, open: 0, approved: 2, denied: 0 };
    leadershipDatabase(data);
    expect((await getLeadershipDashboard()).kpis.approvalRate).toBe(100);
  });

  it('buckets applications and decisions into the last 12 weeks, empty weeks included, oldest first', async () => {
    leadershipDatabase(leadershipData());
    const { weeks } = (await getLeadershipDashboard()).trends;

    expect(weeks).toHaveLength(12);
    expect(weeks[0].weekStart).toBe('2026-07-27');
    expect(weeks.at(-1)).toEqual({ weekStart: '2026-10-12', applications: 3, decisions: 2 });
    expect(weeks.at(-2)).toEqual({ weekStart: '2026-10-05', applications: 5, decisions: 0 });
    expect(weeks.slice(0, 10).every((w) => w.applications === 0 && w.decisions === 0)).toBe(true);
  });

  it('asks the database for the 12 weeks that end with the current one', async () => {
    leadershipDatabase(leadershipData());
    await getLeadershipDashboard();
    const bounded = query.mock.calls.filter(([sql]) => String(sql).includes('make_interval(weeks'));
    expect(bounded).toHaveLength(2);
    for (const [, params] of bounded) expect(params).toEqual([11]); // this week and the eleven before it
  });

  it('gives the average days and cases measured for each stage in a fixed order, and the cases stuck in each now', async () => {
    leadershipDatabase(leadershipData());
    const { bottlenecks } = await getLeadershipDashboard();

    expect(bottlenecks.stuckDays).toBe(5);
    expect(bottlenecks.stages).toEqual([
      { stage: 'submittedToReview', label: 'Submitted to In Review', averageDays: 0.5, measured: 9, stuck: 2 },
      { stage: 'reviewToDecision', label: 'In Review to decision', averageDays: 2, measured: 6, stuck: 0 },
      { stage: 'appealedToDecision', label: 'Appealed to decision', averageDays: null, measured: 0, stuck: 1 },
    ]);
  });

  it('counts a case as stuck only past the same 5-day limit the case manager dashboard uses', async () => {
    leadershipDatabase(leadershipData());
    await getLeadershipDashboard();
    const stuck = query.mock.calls.find(([sql]) => String(sql).includes('AS stuck'))!;
    expect(stuck[1]).toEqual([OVERDUE_DAYS]);
    expect(normalized(stuck[0])).toMatch(/> \$1 GROUP BY c\.status$/);
  });

  it('shows decisions, average days and approval rate for each case manager, by name', async () => {
    leadershipDatabase(leadershipData());
    expect((await getLeadershipDashboard()).team).toEqual([
      { name: 'Casey Alder', decisions: 4, averageDays: 1, approvalRate: 75 },
      { name: 'Blake Bishop', decisions: 2, averageDays: null, approvalRate: 50 },
    ]);
  });

  it('is empty, not broken, on a system with no cases', async () => {
    leadershipDatabase({
      ...leadershipData(),
      totals: { total: 0, open: 0, approved: 0, denied: 0 },
      averageDays: null,
      appeals: { appealed: 0, denied: 0 },
      applications: [],
      decisions: [],
      stages: [],
      stuck: [],
      team: [],
    });
    const dashboard = await getLeadershipDashboard();
    expect(dashboard.kpis.totalApplications).toBe(0);
    expect(dashboard.trends.weeks).toHaveLength(12);
    expect(dashboard.bottlenecks.stages.map((s) => [s.averageDays, s.measured, s.stuck])).toEqual([[null, 0, 0], [null, 0, 0], [null, 0, 0]]);
    expect(dashboard.team).toEqual([]);
  });

  describe('personal data', () => {
    // Rows with every kind of personal column a join could bring along, to show none of it is passed on
    const leaky = () => {
      const data = leadershipData();
      const personal = { applicant_name: 'Avery Lane', applicant_email: 'avery.lane@applicant.example.com', email: 'casey@staff.example.com', user_id: '22222222-2222-4222-8222-222222222222', ssn_hash: '$2b$12$notarealhash', phone: '555-0111', address: '12 Elm Street, Dayton, OH' };
      data.totals = { ...data.totals, ...personal };
      data.appeals = { ...data.appeals, ...personal };
      data.applications = data.applications.map((r) => ({ ...r, ...personal }));
      data.decisions = data.decisions.map((r) => ({ ...r, ...personal }));
      data.stages = data.stages.map((r) => ({ ...r, ...personal }));
      data.stuck = data.stuck.map((r) => ({ ...r, ...personal }));
      data.team = data.team.map((r) => ({ ...r, ...personal, full_name: r.full_name }));
      return data;
    };

    it('has no applicant name, email or other personal data anywhere in the output', async () => {
      leadershipDatabase(leaky());
      const shown = JSON.stringify(await getLeadershipDashboard());

      for (const value of ['Avery Lane', 'avery.lane@applicant.example.com', 'casey@staff.example.com', '22222222-2222', '$2b$', '555-0111', 'Elm Street']) {
        expect(shown).not.toContain(value);
      }
      expect(shown).not.toMatch(/@|ssn|phone|address|password/i);
    });

    it('names only the case managers, and only beside their own figures', async () => {
      leadershipDatabase(leaky());
      const dashboard = await getLeadershipDashboard();
      expect(dashboard.team.map((t) => Object.keys(t).sort())).toEqual([['approvalRate', 'averageDays', 'decisions', 'name'], ['approvalRate', 'averageDays', 'decisions', 'name']]);
      expect(Object.keys(dashboard).sort()).toEqual(['bottlenecks', 'kpis', 'team', 'trends']);
    });

    it('never reads an applicant name, email or id: none of its queries selects one', async () => {
      leadershipDatabase(leadershipData());
      await getLeadershipDashboard();
      const sql = query.mock.calls.map(([text]) => normalized(String(text))).join(' ');
      expect(sql).not.toMatch(/applicant_name|applicant_email|u\.email|\.email|phone|address|ssn|dob/i);
      // The applicant's row is never joined; the only person read is the case manager who made the decision
      expect(sql).not.toMatch(/ON \w+\.id = c\.user_id/);
      expect(sql).toContain('JOIN users u ON u.id = ev.actor_id');
    });
  });
});

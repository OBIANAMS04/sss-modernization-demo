import pool from '../database/connection';
import { APPLICANT_EVENT_TYPES, CASE_STATUSES, CaseStatus, OPEN_STATUSES, getCasesByUserId } from './caseService';
import { getDashboard as getComplianceDashboard } from './complianceService';
import { getExemptionsByUserId } from './exemptionService';
import { getFreshnessDashboard } from './freshnessService';
import { weekStarts } from '../utils/weeks';
import { Notification, listNotifications } from './notificationService';
import { OverrideRateReport, getOverrideRate } from './overrideRateService';
import { Role } from './roleService';
import { determineCompliance, getUserById } from './userService';

// STORY-012: one response with everything a registrant needs on their dashboard. Every query is scoped
// to the signed-in user's id, and each field is picked by name, so an SSN, a staff member's identity or
// an internal note cannot ride along in a row that gains a column later.

export const HISTORY_LIMIT = 10;
export const RECENT_NOTIFICATIONS = 5;

export interface DashboardApplication {
  id: string;
  exemptionType: string | null;
  label: string;
  status: CaseStatus;
  submittedAt: string | null;
  updatedAt: string;
  /** Whether a case manager has the case; who it is stays staff-only. */
  caseManagerAssigned: boolean;
  /** Why it was denied, while it is Denied. */
  decisionReason: string | null;
  nextStep: string;
}

export interface DashboardEligibility {
  exemptionType: string;
  label: string;
  status: string;
  reason: string | null;
  determinedAt: string;
}

export interface DashboardEvent {
  id: string;
  caseId: string;
  exemptionType: string | null;
  description: string;
  createdAt: string;
}

export interface CitizenDashboard {
  applications: DashboardApplication[];
  eligibility: DashboardEligibility[];
  history: DashboardEvent[];
  notifications: { unread: number; recent: Notification[] };
  profile: { passesComplianceCheck: boolean; complianceStatus: string; missing: string[] };
}

const NEXT_STEPS: Record<CaseStatus, string> = {
  Draft: 'Submit your application from the case page.',
  Submitted: 'Waiting for a case manager to pick it up.',
  'In Review': 'A case manager is reviewing it.',
  Approved: 'Exemption granted. Nothing more to do.',
  Denied: 'Read the reason; you can appeal from the case page.',
  Appealed: 'Your appeal is waiting for review.',
};

export function nextStepFor(status: string): string {
  return NEXT_STEPS[status as CaseStatus] ?? 'Open the case page for details.';
}

// Same wording as the case page, which labels the document links
const DOCUMENT_LABELS: Record<string, string> = {
  proof_of_age: 'Proof of age',
  income_statement: 'Income statement',
  hardship_evidence: 'Hardship evidence',
  identity: 'Identity document',
  other: 'Other',
};

/** The line shown for an event, as on the case page's timeline; null for anything an applicant does not see. */
function describeEvent(row: any): string | null {
  switch (row.event_type) {
    case 'created':
      return 'Application submitted';
    case 'status_change':
      return row.from_status ? `Status changed: ${row.from_status} → ${row.to_status}` : `Status changed to ${row.to_status}`;
    case 'document': {
      const type = (row.detail || '').replace('Document added: ', '');
      return `Document added: ${DOCUMENT_LABELS[type] || type}`;
    }
    default:
      return null;
  }
}

/** The newest events across the user's own cases, limited to the types the case page shows an applicant. */
async function loadHistory(userId: string): Promise<DashboardEvent[]> {
  const result = await pool.query(
    `SELECT ev.id, ev.case_id, ev.event_type, ev.from_status, ev.to_status, ev.detail, ev.created_at, x.exemption_type
     FROM case_events ev
     JOIN cases c ON c.id = ev.case_id
     LEFT JOIN exemptions x ON x.id = c.exemption_id
     WHERE c.user_id = $1 AND ev.event_type = ANY($2)
     ORDER BY ev.created_at DESC, ev.id
     LIMIT $3`,
    [userId, APPLICANT_EVENT_TYPES, HISTORY_LIMIT]
  );
  return result.rows.flatMap((row: any) => {
    const description = describeEvent(row);
    return description
      ? [{ id: row.id, caseId: row.case_id, exemptionType: row.exemption_type, description, createdAt: row.created_at }]
      : [];
  });
}

/** The reason recorded with the latest denial of each of the user's cases that is Denied right now. */
async function loadDenialReasons(userId: string): Promise<Map<string, string | null>> {
  const result = await pool.query(
    `SELECT DISTINCT ON (ev.case_id) ev.case_id, ev.detail
     FROM case_events ev
     JOIN cases c ON c.id = ev.case_id
     WHERE c.user_id = $1 AND c.status = 'Denied' AND ev.event_type = 'status_change' AND ev.to_status = 'Denied'
     ORDER BY ev.case_id, ev.created_at DESC`,
    [userId]
  );
  return new Map(result.rows.map((row: any) => [row.case_id, row.detail]));
}

/** What the profile still needs for the compliance check (determineCompliance: 18+, phone, address). */
function missingProfileItems(user: { phone?: string; address?: string }, complianceStatus: string): string[] {
  if (complianceStatus === 'Ineligible') return ['Age 18 or older'];
  const missing: string[] = [];
  if (!user.phone?.trim()) missing.push('Phone number');
  if (!user.address?.trim()) missing.push('Address');
  return missing;
}

export async function getCitizenDashboard(userId: string): Promise<CitizenDashboard> {
  const [cases, exemptions, history, denialReasons, inbox, user] = await Promise.all([
    getCasesByUserId(userId),
    getExemptionsByUserId(userId),
    loadHistory(userId),
    loadDenialReasons(userId),
    listNotifications(userId, RECENT_NOTIFICATIONS),
    getUserById(userId),
  ]);

  const labels = new Map(exemptions.map((e) => [e.id, e.label]));
  const complianceStatus = determineCompliance(user);

  return {
    applications: cases.map((c) => ({
      id: c.id,
      exemptionType: c.exemptionType,
      label: (c.exemptionId && labels.get(c.exemptionId)) || c.exemptionType || 'Exemption',
      status: c.status,
      submittedAt: c.submittedAt,
      updatedAt: c.updatedAt,
      caseManagerAssigned: !!c.assignedTo,
      decisionReason: c.status === 'Denied' ? denialReasons.get(c.id) ?? null : null,
      nextStep: nextStepFor(c.status),
    })),
    eligibility: exemptions.map((e) => ({
      exemptionType: e.exemptionType,
      label: e.label,
      status: e.status,
      reason: e.reason ?? null,
      determinedAt: e.determinedAt,
    })),
    history,
    notifications: { unread: inbox.unread, recent: inbox.notifications },
    profile: {
      passesComplianceCheck: complianceStatus === 'Eligible',
      complianceStatus,
      missing: missingProfileItems(user, complianceStatus),
    },
  };
}

// STORY-013, 014 and 015: the dashboards of case managers, administrators and leadership. They only read what is
// already recorded (cases, case_events, compliance_checks, audit_logs), so a number cannot drift from the work it
// counts. SQL returns plain rows; the rules that decide what a number means (what is overdue, how a rate is rounded,
// which weeks are shown) are applied here, where they can be tested without a database.

/** A case with no update for more than this many days is overdue (STORY-013), and stuck in its stage (STORY-015). */
export const OVERDUE_DAYS = 5;
/** Rows shown in each list of the case manager dashboard; the total beside each counts every match. */
export const WORK_LIST_LIMIT = 25;
export const UNASSIGNED_SHOWN = 5;
export const RECENT_DECISIONS = 5;
/** "Last 30 days" on the admin dashboard. */
export const DECISION_WINDOW_DAYS = 30;
export const TREND_WEEKS = 12;
// A safety bound on how many of one person's open cases are read
const OPEN_CASES_READ = 500;

const count = (value: unknown): number => Number(value ?? 0);
const round1 = (n: number): number => Math.round(n * 10) / 10;
const averageDays = (value: unknown): number | null => (value === null || value === undefined ? null : round1(Number(value)));

/** A share as a percentage with two decimals, as the compliance rate is given; null when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 10000) / 100 : null;
}

/** Judged in whole days since the last update: a case last touched 5 days and 20 hours ago is at 5 days and not yet overdue. */
export const isOverdue = (daysSinceUpdate: number): boolean => daysSinceUpdate > OVERDUE_DAYS;

// ---- STORY-013: case manager ----

export interface WorkItem {
  id: string;
  applicantName: string;
  exemptionType: string | null;
  status: CaseStatus;
  assignedTo: string | null;
  submittedAt: string | null;
  updatedAt: string;
  daysSinceUpdate: number;
  overdue: boolean;
}

export interface ReviewItem {
  id: string;
  caseId: string;
  applicantName: string;
  exemptionType: string | null;
  decision: string | null;
  decidedBy: string | null;
  failedControls: string[];
  openedAt: string;
}

export interface DecisionItem {
  caseId: string;
  applicantName: string;
  exemptionType: string | null;
  decision: string;
  decidedAt: string;
}

export interface CaseManagerDashboard {
  overdueDays: number;
  /** Assigned to the caller and not decided. */
  myOpenCases: { total: number; cases: WorkItem[] };
  waitingOnMe: {
    /** Submitted cases assigned to the caller, to start reviewing. */
    toStart: { total: number; cases: WorkItem[] };
    /** In Review or Appealed cases assigned to the caller, to decide. */
    toDecide: { total: number; cases: WorkItem[] };
    /** Open compliance reviews the caller may resolve: someone else made the decision. */
    reviews: { total: number; reviews: ReviewItem[] };
  };
  unassigned: { total: number; oldest: WorkItem[] };
  /** Open cases, the caller's or unassigned, with no update for more than OVERDUE_DAYS. */
  overdue: { total: number; cases: WorkItem[] };
  recentDecisions: DecisionItem[];
}

// Whole days are counted in the database, so the lists and the overdue test below agree
const DAYS_SINCE_UPDATE = `GREATEST(FLOOR(EXTRACT(EPOCH FROM (NOW() - c.updated_at)) / 86400), 0)`;
const WORK_COLUMNS = `c.id, u.full_name AS applicant_name, x.exemption_type, c.status, c.assigned_to, c.submitted_at, c.updated_at,
  ${DAYS_SINCE_UPDATE}::int AS days_since_update, (COUNT(*) OVER ())::int AS total`;
const WORK_FROM = `FROM cases c JOIN users u ON u.id = c.user_id LEFT JOIN exemptions x ON x.id = c.exemption_id`;

function toWorkItem(row: any): WorkItem {
  const daysSinceUpdate = Math.max(count(row.days_since_update), 0);
  return {
    id: row.id,
    applicantName: row.applicant_name,
    exemptionType: row.exemption_type ?? null,
    status: row.status,
    assignedTo: row.assigned_to ?? null,
    submittedAt: row.submitted_at ?? null,
    updatedAt: row.updated_at,
    daysSinceUpdate,
    overdue: isOverdue(daysSinceUpdate),
  };
}

const toReviewItem = (row: any): ReviewItem => ({
  id: row.id,
  caseId: row.case_id,
  applicantName: row.applicant_name,
  exemptionType: row.exemption_type ?? null,
  decision: row.decision ?? null,
  decidedBy: row.decided_by_email ?? null,
  failedControls: row.failed_controls ?? [],
  openedAt: row.opened_at,
});

const toDecisionItem = (row: any): DecisionItem => ({
  caseId: row.case_id,
  applicantName: row.applicant_name,
  exemptionType: row.exemption_type ?? null,
  decision: row.to_status,
  decidedAt: row.created_at,
});

/** Least recently updated first. */
const stalestFirst = (a: WorkItem, b: WorkItem) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime() || a.id.localeCompare(b.id);

/** The signed-in case manager's work: their open cases, what waits on them, the unassigned queue, what is overdue. */
export async function getCaseManagerDashboard(manager: { id: string; email: string }): Promise<CaseManagerDashboard> {
  const [mine, queue, staleQueue, reviews, decisions] = await Promise.all([
    pool.query(
      `SELECT ${WORK_COLUMNS} ${WORK_FROM}
       WHERE lower(c.assigned_to) = lower($1) AND c.status = ANY($2)
       ORDER BY c.updated_at ASC, c.id LIMIT $3`,
      [manager.email, OPEN_STATUSES, OPEN_CASES_READ]
    ),
    pool.query(
      `SELECT ${WORK_COLUMNS} ${WORK_FROM}
       WHERE c.assigned_to IS NULL AND c.status = ANY($1)
       ORDER BY COALESCE(c.submitted_at, c.created_at) ASC, c.id LIMIT $2`,
      [OPEN_STATUSES, UNASSIGNED_SHOWN]
    ),
    pool.query(
      `SELECT ${WORK_COLUMNS} ${WORK_FROM}
       WHERE c.assigned_to IS NULL AND c.status = ANY($1) AND ${DAYS_SINCE_UPDATE} > $2
       ORDER BY c.updated_at ASC, c.id LIMIT $3`,
      [OPEN_STATUSES, OVERDUE_DAYS, WORK_LIST_LIMIT]
    ),
    // A review is resolved by someone other than the decider, and never on the resolver's own case (resolveReview)
    pool.query(
      `SELECT r.id, r.case_id, r.decision, r.decided_by_email, r.failed_controls, r.opened_at,
              u.full_name AS applicant_name, x.exemption_type, (COUNT(*) OVER ())::int AS total
       FROM compliance_reviews r
       JOIN cases c ON c.id = r.case_id
       JOIN users u ON u.id = c.user_id
       LEFT JOIN exemptions x ON x.id = c.exemption_id
       WHERE r.status = 'Open' AND lower(r.decided_by_email) IS DISTINCT FROM lower($1) AND c.user_id <> $2
       ORDER BY r.opened_at ASC, r.id LIMIT $3`,
      [manager.email, manager.id, WORK_LIST_LIMIT]
    ),
    pool.query(
      `SELECT ev.case_id, ev.to_status, ev.created_at, u.full_name AS applicant_name, x.exemption_type
       FROM case_events ev
       JOIN cases c ON c.id = ev.case_id
       JOIN users u ON u.id = c.user_id
       LEFT JOIN exemptions x ON x.id = c.exemption_id
       WHERE ev.event_type = 'status_change' AND ev.to_status IN ('Approved', 'Denied') AND ev.actor_id = $1
       ORDER BY ev.created_at DESC, ev.id LIMIT $2`,
      [manager.id, RECENT_DECISIONS]
    ),
  ]);

  const open = mine.rows.map(toWorkItem);
  const toStart = open.filter((c) => c.status === 'Submitted');
  const toDecide = open.filter((c) => c.status === 'In Review' || c.status === 'Appealed');
  const myOverdue = open.filter((c) => c.overdue);
  const overdueQueue = staleQueue.rows.map(toWorkItem);

  return {
    overdueDays: OVERDUE_DAYS,
    myOpenCases: { total: count(mine.rows[0]?.total), cases: open.slice(0, WORK_LIST_LIMIT) },
    waitingOnMe: {
      toStart: { total: toStart.length, cases: toStart.slice(0, WORK_LIST_LIMIT) },
      toDecide: { total: toDecide.length, cases: toDecide.slice(0, WORK_LIST_LIMIT) },
      reviews: { total: count(reviews.rows[0]?.total), reviews: reviews.rows.map(toReviewItem) },
    },
    unassigned: { total: count(queue.rows[0]?.total), oldest: queue.rows.map(toWorkItem) },
    overdue: {
      total: myOverdue.length + count(staleQueue.rows[0]?.total),
      cases: [...myOverdue, ...overdueQueue].sort(stalestFirst).slice(0, WORK_LIST_LIMIT),
    },
    recentDecisions: decisions.rows.map(toDecisionItem),
  };
}

// ---- STORY-014: admin ----

const EXEMPTION_TYPES = ['Type A', 'Type B', 'Type C'];

export interface TeamMember {
  name: string;
  email: string;
  role: Role;
  openAssigned: number;
  decidedLast30Days: number;
  /** Days from submission to decision, for the decisions made in the last 30 days. */
  medianDaysToDecision: number | null;
  /** Share of those decisions that passed every compliance control. */
  compliancePassRate: number | null;
}

export interface AdminDashboard {
  cases: {
    total: number;
    open: number;
    decidedLast30Days: number;
    byStatus: { status: CaseStatus; count: number }[];
    byExemptionType: { exemptionType: string; count: number }[];
  };
  team: TeamMember[];
  health: {
    database: 'ok' | 'unreachable';
    migrations: { applied: number; latest: string | null } | null;
    commit: string;
    freshness: {
      status: 'ok' | 'over' | 'none';
      p95Ms: number | null;
      targetMs: number;
      updates: number;
      withinRate: number | null;
      sloPercent: number;
      windowHours: number;
    };
    compliance: {
      status: 'ok' | 'below' | 'none';
      rate: number | null;
      target: number;
      decisions: number;
      openReviews: number;
      windowDays: number;
    };
    auditRefusalsLast24h: number;
    staffByRole: { case_manager: number; leadership: number; admin: number };
  };
  /** STORY-024: how often staff went against the system in the last 30 days, with its weekly trend and where it comes from. */
  overrideRate: OverrideRateReport;
}

/** What /health reports about the database and the release, read the same way. */
async function readHealth(): Promise<Pick<AdminDashboard['health'], 'database' | 'migrations' | 'commit'>> {
  const commit = (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7);
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS applied, MAX(filename) AS latest FROM schema_migrations');
    return { database: 'ok', migrations: { applied: result.rows[0].applied, latest: result.rows[0].latest }, commit };
  } catch {
    return { database: 'unreachable', migrations: null, commit };
  }
}

const toTeamMember = (row: any): TeamMember => ({
  name: row.full_name,
  email: row.email,
  role: row.role,
  openAssigned: count(row.open_assigned),
  decidedLast30Days: count(row.decided),
  medianDaysToDecision: averageDays(row.median_days),
  compliancePassRate: percent(count(row.compliant), count(row.evaluated)),
});

/** Every case, how each case manager is doing, and whether the system is healthy. */
export async function getAdminDashboard(): Promise<AdminDashboard> {
  const [byStatus, byType, decided, team, health, freshness, compliance, refusals, staff, overrideRate] = await Promise.all([
    pool.query('SELECT status, COUNT(*)::int AS count FROM cases GROUP BY status'),
    pool.query(`SELECT x.exemption_type, COUNT(*)::int AS count FROM cases c LEFT JOIN exemptions x ON x.id = c.exemption_id GROUP BY x.exemption_type`),
    pool.query(
      `SELECT COUNT(*)::int AS decided FROM case_events
       WHERE event_type = 'status_change' AND to_status IN ('Approved', 'Denied') AND created_at >= NOW() - make_interval(days => $1::int)`,
      [DECISION_WINDOW_DAYS]
    ),
    // Everyone who can work cases, including those with nothing to show. A decision is compliant when all its controls passed
    pool.query(
      `SELECT u.full_name, u.email, u.role,
              (SELECT COUNT(*)::int FROM cases c WHERE lower(c.assigned_to) = lower(u.email) AND c.status = ANY($1)) AS open_assigned,
              d.decided, d.median_days, d.compliant, d.evaluated
       FROM users u
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS decided,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ev.created_at - c.submitted_at)) / 86400) AS median_days,
                COUNT(*) FILTER (WHERE k.compliant)::int AS compliant,
                COUNT(*) FILTER (WHERE k.compliant IS NOT NULL)::int AS evaluated
         FROM case_events ev
         JOIN cases c ON c.id = ev.case_id
         LEFT JOIN LATERAL (SELECT BOOL_AND(passed) AS compliant FROM compliance_checks WHERE decision_event_id = ev.id) k ON true
         WHERE ev.actor_id = u.id AND ev.event_type = 'status_change' AND ev.to_status IN ('Approved', 'Denied')
           AND ev.created_at >= NOW() - make_interval(days => $2::int)
       ) d ON true
       WHERE u.role IN ('case_manager', 'admin')
       ORDER BY u.full_name, u.email`,
      [OPEN_STATUSES, DECISION_WINDOW_DAYS]
    ),
    readHealth(),
    getFreshnessDashboard(24),
    getComplianceDashboard(DECISION_WINDOW_DAYS),
    pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'ACCESS_DENIED' AND timestamp >= NOW() - INTERVAL '24 hours'`),
    pool.query(`SELECT role, COUNT(*)::int AS n FROM users WHERE role IN ('case_manager', 'leadership', 'admin') GROUP BY role`),
    getOverrideRate(),
  ]);

  const statusCounts = new Map<string, number>(byStatus.rows.map((r: any) => [r.status, count(r.count)]));
  const typeCounts = new Map<string, number>(byType.rows.map((r: any) => [r.exemption_type ?? 'Not recorded', count(r.count)]));
  const staffCounts = new Map<string, number>(staff.rows.map((r: any) => [r.role, count(r.n)]));
  const p95 = freshness.overall.p95Ms;

  return {
    cases: {
      total: [...statusCounts.values()].reduce((sum, n) => sum + n, 0),
      open: OPEN_STATUSES.reduce((sum, status) => sum + (statusCounts.get(status) ?? 0), 0),
      decidedLast30Days: count(decided.rows[0]?.decided),
      byStatus: CASE_STATUSES.map((status) => ({ status, count: statusCounts.get(status) ?? 0 })),
      byExemptionType: [...new Set([...EXEMPTION_TYPES, ...typeCounts.keys()])].map((exemptionType) => ({
        exemptionType,
        count: typeCounts.get(exemptionType) ?? 0,
      })),
    },
    team: team.rows.map(toTeamMember),
    health: {
      ...health,
      freshness: {
        status: p95 === null ? 'none' : p95 > freshness.targetMs ? 'over' : 'ok',
        p95Ms: p95,
        targetMs: freshness.targetMs,
        updates: freshness.overall.count,
        withinRate: freshness.overall.withinRate,
        sloPercent: freshness.sloPercent,
        windowHours: freshness.windowHours,
      },
      compliance: {
        status: compliance.complianceRate === null ? 'none' : compliance.complianceRate < compliance.target ? 'below' : 'ok',
        rate: compliance.complianceRate,
        target: compliance.target,
        decisions: compliance.totalDecisions,
        openReviews: compliance.openReviews,
        windowDays: compliance.windowDays,
      },
      auditRefusalsLast24h: count(refusals.rows[0]?.n),
      staffByRole: {
        case_manager: staffCounts.get('case_manager') ?? 0,
        leadership: staffCounts.get('leadership') ?? 0,
        admin: staffCounts.get('admin') ?? 0,
      },
    },
    overrideRate,
  };
}

// ---- STORY-015: leadership ----

export interface TrendWeek {
  /** The Monday the week starts on, YYYY-MM-DD. */
  weekStart: string;
  applications: number;
  decisions: number;
}

export interface BottleneckStage {
  stage: 'submittedToReview' | 'reviewToDecision' | 'appealedToDecision';
  label: string;
  /** Average days spent in the stage, from the case timeline; null when no case has left it yet. */
  averageDays: number | null;
  /** How many times a case left the stage, which the average is taken over. */
  measured: number;
  /** Cases in the stage right now for more than OVERDUE_DAYS. */
  stuck: number;
}

/**
 * Aggregates only: no applicant name, email or other personal data, and nothing that names a person but a case manager's
 * own name beside their decisions. Every field is picked by name, so a column a query gains later cannot ride along.
 */
export interface LeadershipDashboard {
  kpis: {
    totalApplications: number;
    openCases: number;
    approved: number;
    /** Approved and denied cases. */
    decided: number;
    /** Approved / decided, in percent; null while nothing is decided. */
    approvalRate: number | null;
    /** From submission to the decision, over decided cases. */
    averageProcessingDays: number | null;
    /** Cases that were appealed / cases that were denied, in percent; null while nothing was denied. */
    appealRate: number | null;
    appealed: number;
    denied: number;
  };
  trends: { weeks: TrendWeek[] };
  bottlenecks: { stuckDays: number; stages: BottleneckStage[] };
  team: { name: string; decisions: number; averageDays: number | null; approvalRate: number | null }[];
  /** STORY-024: counts and rates only, with no case, person or answer in them. */
  overrideRate: OverrideRateReport;
}

const STAGES: { stage: BottleneckStage['stage']; label: string; waiting: CaseStatus }[] = [
  { stage: 'submittedToReview', label: 'Submitted to In Review', waiting: 'Submitted' },
  { stage: 'reviewToDecision', label: 'In Review to decision', waiting: 'In Review' },
  { stage: 'appealedToDecision', label: 'Appealed to decision', waiting: 'Appealed' },
];

// The weeks are listed by utils/weeks.ts, which the override rate (STORY-024) lists them with too
export { weekStarts };

/** One entry per week, empty weeks included, from the per-week counts the database returns for the weeks that had any. */
export function weeklyTrend(
  currentWeek: string,
  applications: { week: string; n: unknown }[],
  decisions: { week: string; n: unknown }[],
  weeks = TREND_WEEKS
): TrendWeek[] {
  const byWeek = (rows: { week: string; n: unknown }[]) => new Map(rows.map((r) => [r.week, count(r.n)]));
  const applied = byWeek(applications);
  const decided = byWeek(decisions);
  return weekStarts(currentWeek, weeks).map((weekStart) => ({
    weekStart,
    applications: applied.get(weekStart) ?? 0,
    decisions: decided.get(weekStart) ?? 0,
  }));
}

// Weeks start on Monday, in the database's time zone, and the current week counts as the last of the twelve
const WEEKS_BACK = TREND_WEEKS - 1;

export async function getLeadershipDashboard(): Promise<LeadershipDashboard> {
  const [totals, processing, appeals, thisWeek, applications, decisions, stages, stuck, team, overrideRate] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = ANY($1))::int AS open,
              COUNT(*) FILTER (WHERE status = 'Approved')::int AS approved,
              COUNT(*) FILTER (WHERE status = 'Denied')::int AS denied
       FROM cases`,
      [OPEN_STATUSES]
    ),
    // Submission to the decision that stands now, for cases that are decided
    pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (d.decided_at - c.submitted_at)) / 86400)::float8 AS average_days
       FROM cases c
       JOIN LATERAL (
         SELECT MAX(ev.created_at) AS decided_at FROM case_events ev
         WHERE ev.case_id = c.id AND ev.event_type = 'status_change' AND ev.to_status = c.status
       ) d ON d.decided_at IS NOT NULL
       WHERE c.status IN ('Approved', 'Denied') AND c.submitted_at IS NOT NULL`
    ),
    pool.query(
      `SELECT COUNT(DISTINCT case_id) FILTER (WHERE to_status = 'Appealed')::int AS appealed,
              COUNT(DISTINCT case_id) FILTER (WHERE to_status = 'Denied')::int AS denied
       FROM case_events WHERE event_type = 'status_change' AND to_status IN ('Appealed', 'Denied')`
    ),
    pool.query(`SELECT to_char(date_trunc('week', NOW()), 'YYYY-MM-DD') AS week`),
    pool.query(
      `SELECT to_char(date_trunc('week', COALESCE(submitted_at, created_at)), 'YYYY-MM-DD') AS week, COUNT(*)::int AS n
       FROM cases
       WHERE COALESCE(submitted_at, created_at) >= date_trunc('week', NOW()) - make_interval(weeks => $1::int)
       GROUP BY 1`,
      [WEEKS_BACK]
    ),
    // A decision is a move to Approved or Denied
    pool.query(
      `SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, COUNT(*)::int AS n
       FROM case_events
       WHERE event_type = 'status_change' AND to_status IN ('Approved', 'Denied')
         AND created_at >= date_trunc('week', NOW()) - make_interval(weeks => $1::int)
       GROUP BY 1`,
      [WEEKS_BACK]
    ),
    // Each time a case entered a stage: how long until its next move out of it (to one of the stages that follow)
    pool.query(
      `WITH moves AS (
         SELECT case_id, to_status, created_at FROM case_events
         WHERE event_type IN ('created', 'status_change') AND to_status IS NOT NULL
       )
       SELECT s.stage, COUNT(*)::int AS measured, AVG(EXTRACT(EPOCH FROM (n.created_at - m.created_at)) / 86400)::float8 AS average_days
       FROM (VALUES ('submittedToReview', 'Submitted', ARRAY['In Review']),
                    ('reviewToDecision', 'In Review', ARRAY['Approved', 'Denied']),
                    ('appealedToDecision', 'Appealed', ARRAY['Approved', 'Denied'])) AS s(stage, from_status, to_statuses)
       JOIN moves m ON m.to_status = s.from_status
       JOIN LATERAL (
         SELECT x.created_at FROM moves x
         WHERE x.case_id = m.case_id AND x.created_at > m.created_at AND x.to_status = ANY(s.to_statuses)
         ORDER BY x.created_at LIMIT 1
       ) n ON true
       GROUP BY s.stage`
    ),
    // Cases still in a stage, by how long since they entered it (their last update if the timeline has no entry)
    pool.query(
      `SELECT c.status, COUNT(*)::int AS stuck
       FROM cases c
       LEFT JOIN LATERAL (
         SELECT MAX(ev.created_at) AS entered_at FROM case_events ev
         WHERE ev.case_id = c.id AND ev.event_type IN ('created', 'status_change') AND ev.to_status = c.status
       ) e ON true
       WHERE c.status IN ('Submitted', 'In Review', 'Appealed')
         AND FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(e.entered_at, c.updated_at))) / 86400) > $1
       GROUP BY c.status`,
      [OVERDUE_DAYS]
    ),
    pool.query(
      `SELECT u.full_name, COUNT(*)::int AS decisions,
              AVG(EXTRACT(EPOCH FROM (ev.created_at - c.submitted_at)) / 86400)::float8 AS average_days,
              COUNT(*) FILTER (WHERE ev.to_status = 'Approved')::int AS approved
       FROM case_events ev
       JOIN cases c ON c.id = ev.case_id
       JOIN users u ON u.id = ev.actor_id
       WHERE ev.event_type = 'status_change' AND ev.to_status IN ('Approved', 'Denied')
       GROUP BY u.id, u.full_name
       ORDER BY decisions DESC, u.full_name`
    ),
    getOverrideRate(),
  ]);

  const { total, open, approved, denied: deniedCases } = totals.rows[0];
  const decided = count(approved) + count(deniedCases);
  const measured = new Map<string, any>(stages.rows.map((r: any) => [r.stage, r]));
  const stuckIn = new Map<string, number>(stuck.rows.map((r: any) => [r.status, count(r.stuck)]));
  const appealed = count(appeals.rows[0]?.appealed);
  const denied = count(appeals.rows[0]?.denied);

  return {
    kpis: {
      totalApplications: count(total),
      openCases: count(open),
      approved: count(approved),
      decided,
      approvalRate: percent(count(approved), decided),
      averageProcessingDays: averageDays(processing.rows[0]?.average_days),
      appealRate: percent(appealed, denied),
      appealed,
      denied,
    },
    trends: { weeks: weeklyTrend(thisWeek.rows[0].week, applications.rows, decisions.rows) },
    bottlenecks: {
      stuckDays: OVERDUE_DAYS,
      stages: STAGES.map(({ stage, label, waiting }) => ({
        stage,
        label,
        averageDays: averageDays(measured.get(stage)?.average_days),
        measured: count(measured.get(stage)?.measured),
        stuck: stuckIn.get(waiting) ?? 0,
      })),
    },
    team: team.rows.map((r: any) => ({
      name: r.full_name,
      decisions: count(r.decisions),
      averageDays: averageDays(r.average_days),
      approvalRate: percent(count(r.approved), count(r.decisions)),
    })),
    overrideRate,
  };
}

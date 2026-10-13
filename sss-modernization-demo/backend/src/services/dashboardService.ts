import pool from '../database/connection';
import { APPLICANT_EVENT_TYPES, CaseStatus, getCasesByUserId } from './caseService';
import { getExemptionsByUserId } from './exemptionService';
import { Notification, listNotifications } from './notificationService';
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

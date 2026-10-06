import pool from '../database/connection';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { AuditAction, logAuditEvent } from './auditService';
import { isStaff } from './roleService';
import { Actor, inTransaction, notify, recordEvent } from './caseEvents';
import { evaluateDecision } from './complianceService';

export type CaseStatus = 'Draft' | 'Submitted' | 'In Review' | 'Approved' | 'Denied' | 'Appealed';

export const CASE_STATUSES: CaseStatus[] = ['Draft', 'Submitted', 'In Review', 'Approved', 'Denied', 'Appealed'];
export const OPEN_STATUSES: CaseStatus[] = ['Draft', 'Submitted', 'In Review', 'Appealed'];

/**
 * Allowed status changes and who may make them. Applicants submit and appeal;
 * case managers review and decide. Approved is final.
 */
const TRANSITIONS: Record<CaseStatus, { to: CaseStatus; by: 'applicant' | 'staff' }[]> = {
  Draft: [{ to: 'Submitted', by: 'applicant' }],
  Submitted: [{ to: 'In Review', by: 'staff' }],
  'In Review': [
    { to: 'Approved', by: 'staff' },
    { to: 'Denied', by: 'staff' },
  ],
  Denied: [{ to: 'Appealed', by: 'applicant' }],
  Appealed: [{ to: 'In Review', by: 'staff' }],
  Approved: [],
};

export function allowedTransitions(from: CaseStatus, actor: 'applicant' | 'staff'): CaseStatus[] {
  return (TRANSITIONS[from] || []).filter((t) => t.by === actor).map((t) => t.to);
}

export const DOCUMENT_TYPES = ['proof_of_age', 'income_statement', 'hardship_evidence', 'identity', 'other'];

export type { Actor };

export interface CaseSummary {
  id: string;
  userId: string;
  applicantName: string;
  applicantEmail: string;
  exemptionId: string | null;
  exemptionType: string | null;
  status: CaseStatus;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
}

export interface CaseEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorEmail: string | null;
  detail: string | null;
  createdAt: string;
}

export interface CaseNote {
  id: string;
  caseId: string;
  noteBy: string;
  content: string;
  createdAt: string;
}

export interface CaseDocument {
  id: string;
  caseId: string;
  documentType: string;
  documentUrl: string;
  uploadedBy?: string;
  createdAt: string;
}

export interface CaseFilters {
  status?: string;
  exemptionType?: string;
  assignedTo?: string;
  applicant?: string; // matches applicant email or name
  openOnly?: boolean;
}

const SUMMARY_SELECT = `
  SELECT c.id, c.user_id, u.full_name AS applicant_name, u.email AS applicant_email,
         c.exemption_id, e.exemption_type, c.status, c.assigned_to,
         c.created_at, c.updated_at, c.submitted_at, c.approved_at
  FROM cases c
  JOIN users u ON u.id = c.user_id
  LEFT JOIN exemptions e ON e.id = c.exemption_id`;

function mapSummary(row: any): CaseSummary {
  return {
    id: row.id,
    userId: row.user_id,
    applicantName: row.applicant_name,
    applicantEmail: row.applicant_email,
    exemptionId: row.exemption_id,
    exemptionType: row.exemption_type,
    status: row.status,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
  };
}

function mapEvent(row: any): CaseEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorEmail: row.actor_email,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

function mapNote(row: any): CaseNote {
  return { id: row.id, caseId: row.case_id, noteBy: row.note_by, content: row.content, createdAt: row.created_at };
}

function mapDocument(row: any): CaseDocument {
  return {
    id: row.id,
    caseId: row.case_id,
    documentType: row.document_type,
    documentUrl: row.document_url,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

async function getSummary(caseId: string): Promise<CaseSummary> {
  const result = await pool.query(`${SUMMARY_SELECT} WHERE c.id = $1`, [caseId]);
  if (result.rows.length === 0) throw new NotFoundError('Case not found');
  return mapSummary(result.rows[0]);
}

/** Applicant opens a case for one of their own exemptions; it starts as Submitted. */
export async function applyForExemption(exemptionId: string, actor: Actor): Promise<CaseSummary> {
  const exemption = await pool.query(
    'SELECT id, exemption_type, status FROM exemptions WHERE id = $1 AND user_id = $2',
    [exemptionId, actor.id]
  );
  if (exemption.rows.length === 0) {
    throw new AppError(403, 'You can only apply for your own exemption', 'FORBIDDEN');
  }
  const { exemption_type: type, status } = exemption.rows[0];
  if (status === 'Not Eligible') {
    throw new ValidationError(`You are not currently eligible for ${type}. Update your profile and re-check eligibility.`);
  }
  const existing = await pool.query('SELECT status FROM cases WHERE exemption_id = $1', [exemptionId]);
  if (existing.rows.length > 0) {
    throw new AppError(409, `You already have a ${existing.rows[0].status} case for ${type}`, 'CONFLICT');
  }

  const caseId = await inTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO cases (user_id, exemption_id, status, submitted_at) VALUES ($1, $2, 'Submitted', NOW()) RETURNING id`,
      [actor.id, exemptionId]
    );
    const id = inserted.rows[0].id;
    await recordEvent(client, id, 'created', actor, { toStatus: 'Submitted', detail: `Application for ${type}` });
    await notify(client, actor.id, id, `Your application for the ${type} exemption was submitted.`);
    return id;
  });

  await logAuditEvent(AuditAction.CASE_CREATE, 'cases', 'success', {
    actor: actor.id,
    actorEmail: actor.email,
    resourceId: caseId,
    details: { exemptionType: type, status: 'Submitted' },
  });
  return getSummary(caseId);
}

/** Moves a case to a new status if the transition is allowed for this actor. */
export async function changeStatus(caseId: string, toStatus: string, actor: Actor, reason?: string): Promise<CaseSummary> {
  if (!CASE_STATUSES.includes(toStatus as CaseStatus)) {
    throw new ValidationError(`Invalid status: ${toStatus}`);
  }
  const current = await getSummary(caseId);
  const staff = isStaff(actor.role);
  const isApplicant = current.userId === actor.id;

  // The applicant acts on their own case; staff review everyone else's. A case manager's own
  // case only gets applicant actions, so nobody can decide their own exemption.
  if (!staff && !isApplicant) throw new AppError(403, 'Access denied', 'FORBIDDEN');
  const permitted = allowedTransitions(current.status, isApplicant ? 'applicant' : 'staff');
  if (!permitted.includes(toStatus as CaseStatus)) {
    throw new ValidationError(`A case cannot move from ${current.status} to ${toStatus}`);
  }
  if (toStatus === 'Denied' && !reason?.trim()) {
    throw new ValidationError('A reason is required when denying a case');
  }
  const cleanReason = reason?.trim() ? reason.trim().slice(0, 1000) : null;

  const eventId = await inTransaction(async (client) => {
    await client.query(
      `UPDATE cases SET status = $1::varchar, updated_at = NOW(),
         approved_at = CASE WHEN $1::varchar = 'Approved' THEN NOW() ELSE approved_at END
       WHERE id = $2`,
      [toStatus, caseId]
    );
    const id = await recordEvent(client, caseId, 'status_change', actor, {
      fromStatus: current.status,
      toStatus,
      detail: cleanReason,
    });
    const typeLabel = current.exemptionType ? `${current.exemptionType} ` : '';
    const message =
      `Your ${typeLabel}exemption case is now ${toStatus}.` + (cleanReason ? ` Reason: ${cleanReason}` : '');
    await notify(client, current.userId, caseId, message);
    return id;
  });

  await logAuditEvent(AuditAction.CASE_STATUS_CHANGE, 'cases', 'success', {
    actor: actor.id,
    actorEmail: actor.email,
    resourceId: caseId,
    details: { from: current.status, to: toStatus },
  });

  // STORY-008: every exemption decision is evaluated against the decision controls when it is
  // made (after the audit write, which one of the controls verifies).
  if (toStatus === 'Approved' || toStatus === 'Denied') {
    await evaluateDecision(caseId, eventId, actor);
  }
  return getSummary(caseId);
}

/** Assigns a case to a staff member (by email) or unassigns it (null). Staff only. */
export async function assignCase(caseId: string, assigneeEmail: string | null, actor: Actor): Promise<CaseSummary> {
  const current = await getSummary(caseId);
  let assignee: string | null = null;
  if (assigneeEmail) {
    const staff = await pool.query(
      `SELECT email FROM users WHERE lower(email) = lower($1) AND role IN ('case_manager', 'admin')`,
      [assigneeEmail]
    );
    if (staff.rows.length === 0) throw new ValidationError('Cases can only be assigned to a case manager');
    assignee = staff.rows[0].email;
  }
  if (assignee === current.assignedTo) return current;

  await inTransaction(async (client) => {
    await client.query('UPDATE cases SET assigned_to = $1, updated_at = NOW() WHERE id = $2', [assignee, caseId]);
    await recordEvent(client, caseId, 'assigned', actor, { detail: assignee ? `Assigned to ${assignee}` : 'Unassigned' });
  });

  await logAuditEvent(AuditAction.CASE_UPDATE, 'cases', 'success', {
    actor: actor.id,
    actorEmail: actor.email,
    resourceId: caseId,
    details: { assignedTo: assignee },
  });
  return getSummary(caseId);
}

/** Internal case note. Staff only; notes are not shown to the applicant. */
export async function addNote(caseId: string, content: string, actor: Actor): Promise<CaseNote> {
  const text = content?.trim();
  if (!text) throw new ValidationError('Note cannot be empty');
  if (text.length > 5000) throw new ValidationError('Note must be 5000 characters or less');
  await getSummary(caseId);

  const note = await inTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO case_notes (case_id, note_by, content) VALUES ($1, $2, $3)
       RETURNING id, case_id, note_by, content, created_at`,
      [caseId, actor.email, text]
    );
    await recordEvent(client, caseId, 'note', actor, { detail: 'Internal note added' });
    return mapNote(result.rows[0]);
  });

  await logAuditEvent(AuditAction.CASE_NOTE_ADD, 'cases', 'success', {
    actor: actor.id,
    actorEmail: actor.email,
    resourceId: caseId,
  });
  return note;
}

/**
 * Attaches a document by link. Real file upload needs object storage (S3, STORY-004),
 * so for now documents are references to files hosted elsewhere.
 */
export async function addDocument(caseId: string, documentType: string, documentUrl: string, actor: Actor): Promise<CaseDocument> {
  if (!DOCUMENT_TYPES.includes(documentType)) {
    throw new ValidationError(`Document type must be one of: ${DOCUMENT_TYPES.join(', ')}`);
  }
  let url: URL;
  try {
    url = new URL(documentUrl);
  } catch {
    throw new ValidationError('Document link must be a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError('Document link must start with http:// or https://');
  }
  await getSummary(caseId);

  const doc = await inTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO case_documents (case_id, document_type, document_url, uploaded_by) VALUES ($1, $2, $3, $4)
       RETURNING id, case_id, document_type, document_url, uploaded_by, created_at`,
      [caseId, documentType, url.toString(), actor.email]
    );
    await recordEvent(client, caseId, 'document', actor, { detail: `Document added: ${documentType}` });
    return mapDocument(result.rows[0]);
  });

  await logAuditEvent(AuditAction.CASE_DOCUMENT_UPLOAD, 'cases', 'success', {
    actor: actor.id,
    actorEmail: actor.email,
    resourceId: caseId,
    details: { documentType },
  });
  return doc;
}

/** Full case view. Applicants see status changes and documents; staff also see notes and all events. */
export async function getCaseDetail(caseId: string, viewerIsStaff: boolean) {
  const summary = await getSummary(caseId);
  const [events, docs, notes, exemption] = await Promise.all([
    pool.query(
      `SELECT id, event_type, from_status, to_status, actor_email, detail, created_at
       FROM case_events WHERE case_id = $1 ${viewerIsStaff ? '' : `AND event_type IN ('created', 'status_change', 'document')`}
       ORDER BY created_at ASC`,
      [caseId]
    ),
    pool.query(
      `SELECT id, case_id, document_type, document_url, uploaded_by, created_at
       FROM case_documents WHERE case_id = $1 ORDER BY created_at DESC`,
      [caseId]
    ),
    viewerIsStaff
      ? pool.query(
          `SELECT id, case_id, note_by, content, created_at FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC`,
          [caseId]
        )
      : Promise.resolve({ rows: [] }),
    summary.exemptionId
      ? pool.query('SELECT exemption_type, status, reason FROM exemptions WHERE id = $1', [summary.exemptionId])
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    ...summary,
    exemption: exemption.rows[0]
      ? { type: exemption.rows[0].exemption_type, eligibility: exemption.rows[0].status, reason: exemption.rows[0].reason }
      : null,
    timeline: events.rows.map(mapEvent),
    documents: docs.rows.map(mapDocument),
    notes: notes.rows.map(mapNote),
  };
}

export async function getCasesByUserId(userId: string): Promise<CaseSummary[]> {
  const result = await pool.query(`${SUMMARY_SELECT} WHERE c.user_id = $1 ORDER BY c.created_at DESC`, [userId]);
  return result.rows.map(mapSummary);
}

function buildFilterClause(filters: CaseFilters): { where: string; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];
  const add = (sql: string, value: any) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };

  if (filters.status) add('c.status = ?', filters.status);
  if (filters.exemptionType) add('e.exemption_type = ?', filters.exemptionType);
  if (filters.assignedTo === 'unassigned') conditions.push('c.assigned_to IS NULL');
  else if (filters.assignedTo) add('lower(c.assigned_to) = lower(?)', filters.assignedTo);
  if (filters.applicant) {
    params.push(`%${filters.applicant}%`);
    conditions.push(`(u.email ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
  }
  if (filters.openOnly) add('c.status = ANY(?)', OPEN_STATUSES);

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

export async function listCases(filters: CaseFilters, page = 1, limit = 25): Promise<{ cases: CaseSummary[]; total: number; page: number }> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safePage = Math.max(page, 1);
  const { where, params } = buildFilterClause(filters);

  const count = await pool.query(
    `SELECT COUNT(*) AS total FROM cases c JOIN users u ON u.id = c.user_id LEFT JOIN exemptions e ON e.id = c.exemption_id ${where}`,
    params
  );
  const rows = await pool.query(
    `${SUMMARY_SELECT} ${where} ORDER BY c.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, safeLimit, (safePage - 1) * safeLimit]
  );
  return { cases: rows.rows.map(mapSummary), total: parseInt(count.rows[0].total, 10), page: safePage };
}

/** Quotes a CSV cell and neutralises spreadsheet formula injection (=, +, -, @ prefixes). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function exportCasesCsv(filters: CaseFilters): Promise<string> {
  const { where, params } = buildFilterClause(filters);
  const result = await pool.query(`${SUMMARY_SELECT} ${where} ORDER BY c.created_at DESC LIMIT 10000`, params);
  const header = ['Case ID', 'Applicant', 'Applicant Email', 'Exemption Type', 'Status', 'Assigned To', 'Created', 'Submitted', 'Approved', 'Last Updated'];
  const lines = result.rows.map(mapSummary).map((c) =>
    [c.id, c.applicantName, c.applicantEmail, c.exemptionType, c.status, c.assignedTo, c.createdAt, c.submittedAt, c.approvedAt, c.updatedAt]
      .map(csvCell)
      .join(',')
  );
  return [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}

export async function getStaffMembers(): Promise<{ email: string; fullName: string }[]> {
  const result = await pool.query(
    `SELECT email, full_name FROM users WHERE role IN ('case_manager', 'admin') ORDER BY full_name`
  );
  return result.rows.map((r: any) => ({ email: r.email, fullName: r.full_name }));
}

export async function getCaseStats(): Promise<{
  total: number;
  open: number;
  byStatus: Record<string, number>;
  averageTimeInReview: number;
}> {
  const byStatusResult = await pool.query(`SELECT status, COUNT(*) AS count FROM cases GROUP BY status`);
  const timeResult = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (approved_at - submitted_at))) AS avg_seconds
     FROM cases WHERE submitted_at IS NOT NULL AND approved_at IS NOT NULL`
  );

  const byStatus: Record<string, number> = {};
  let total = 0;
  let open = 0;
  for (const row of byStatusResult.rows) {
    const count = parseInt(row.count, 10);
    byStatus[row.status] = count;
    total += count;
    if (OPEN_STATUSES.includes(row.status)) open += count;
  }

  return {
    total,
    open,
    byStatus,
    averageTimeInReview: timeResult.rows[0]?.avg_seconds ? Math.round(timeResult.rows[0].avg_seconds / 3600) : 0, // hours, submitted → approved
  };
}

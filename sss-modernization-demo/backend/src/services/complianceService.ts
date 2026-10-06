import pool from '../database/connection';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { AuditAction, logAuditEvent } from './auditService';
import { Actor, inTransaction, notify, recordEvent } from './caseEvents';

/**
 * STORY-008: every exemption decision (Approved/Denied) is checked against these controls at the
 * moment it is made. Each control reads the recorded data; none is assumed to pass. The previous
 * matrix mapped FAR contract clauses (which govern the contractor, not individual decisions) and
 * passed several controls unconditionally.
 */
export type Decision = 'Approved' | 'Denied';

export interface DecisionControl {
  id: string;
  requirement: string;
  reference: string;
  control: string;
  evidenceSource: string;
  appliesTo: Decision[];
}

export const DECISION_CONTROLS: DecisionControl[] = [
  {
    id: 'CTRL-01',
    requirement: 'Decision follows the eligibility rules',
    reference: 'Program rules (STORY-006)',
    control: 'An approval matches a current Eligible or Pending Review determination',
    evidenceSource: 'exemptions: status, reason',
    appliesTo: ['Approved'],
  },
  {
    id: 'CTRL-02',
    requirement: 'Accurate, timely records for determinations',
    reference: 'Privacy Act, 5 U.S.C. 552a(e)(5)',
    control: "Eligibility was re-checked after the applicant's last profile change",
    evidenceSource: 'exemptions.determined_at vs users.updated_at',
    appliesTo: ['Approved', 'Denied'],
  },
  {
    id: 'CTRL-03',
    requirement: 'Statement of grounds for denial',
    reference: 'Administrative Procedure Act, 5 U.S.C. 555(e)',
    control: 'A denial records its reason and the applicant is notified',
    evidenceSource: 'case_events.detail, notifications',
    appliesTo: ['Denied'],
  },
  {
    id: 'CTRL-04',
    requirement: 'Separation of duties',
    reference: 'NIST SP 800-53 AC-5',
    control: 'The decider is not the applicant',
    evidenceSource: 'case_events.actor_id vs cases.user_id',
    appliesTo: ['Approved', 'Denied'],
  },
  {
    id: 'CTRL-05',
    requirement: 'Accountable reviewer',
    reference: 'Program policy',
    control: 'The case is assigned to the case manager who decides it',
    evidenceSource: 'cases.assigned_to',
    appliesTo: ['Approved', 'Denied'],
  },
  {
    id: 'CTRL-06',
    requirement: 'Review before decision',
    reference: 'Program policy (STORY-007 workflow)',
    control: 'The decision is made from In Review',
    evidenceSource: 'case_events status history',
    appliesTo: ['Approved', 'Denied'],
  },
  {
    id: 'CTRL-07',
    requirement: 'Supporting evidence on file',
    reference: 'Program policy',
    control: 'An approval has its supporting document: proof of age (A), income statement (B) or hardship evidence (C)',
    evidenceSource: 'case_documents',
    appliesTo: ['Approved'],
  },
  {
    id: 'CTRL-08',
    requirement: 'Audit record content',
    reference: 'NIST SP 800-53 AU-3',
    control: 'The decision is in the audit log with who, what and when',
    evidenceSource: 'audit_logs (CASE_STATUS_CHANGE)',
    appliesTo: ['Approved', 'Denied'],
  },
];

export const COMPLIANCE_TARGET = 99; // percent of decisions passing every control

const REQUIRED_DOCUMENT: Record<string, string> = {
  'Type A': 'proof_of_age',
  'Type B': 'income_statement',
  'Type C': 'hardship_evidence',
};

/** What was true at the moment of a decision: everything the controls need. */
export interface DecisionContext {
  decision: Decision;
  applicantId: string;
  deciderId: string | null;
  deciderEmail: string | null;
  assignedTo: string | null;
  fromStatus: string | null;
  reason: string | null;
  exemptionType: string | null;
  exemptionStatus: string | null;
  exemptionReason: string | null;
  determinedAt: Date | null;
  profileUpdatedAt: Date | null;
  applicantNotified: boolean;
  auditLogged: boolean;
  documentTypes: string[];
}

export interface ControlResult {
  controlId: string;
  passed: boolean;
  evidence: string;
}

const when = (d: Date | null) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : 'never');

/** Evaluates every control that applies to the decision. Pure: no I/O. */
export function evaluateControls(ctx: DecisionContext): ControlResult[] {
  const results: ControlResult[] = [];
  const add = (controlId: string, passed: boolean, evidence: string) => results.push({ controlId, passed, evidence });

  for (const control of DECISION_CONTROLS) {
    if (!control.appliesTo.includes(ctx.decision)) continue;

    switch (control.id) {
      case 'CTRL-01': {
        const ok = ctx.exemptionStatus === 'Eligible' || ctx.exemptionStatus === 'Pending Review';
        const basis = ctx.exemptionReason ? ` (${ctx.exemptionReason})` : '';
        add(control.id, ok, `${ctx.exemptionType ?? 'Exemption'} determination at decision: ${ctx.exemptionStatus ?? 'none'}${basis}`);
        break;
      }
      case 'CTRL-02': {
        const ok =
          !!ctx.determinedAt &&
          (!ctx.profileUpdatedAt || new Date(ctx.determinedAt).getTime() >= new Date(ctx.profileUpdatedAt).getTime());
        add(control.id, ok, `Eligibility determined ${when(ctx.determinedAt)}; profile last changed ${when(ctx.profileUpdatedAt)}`);
        break;
      }
      case 'CTRL-03': {
        const hasReason = !!ctx.reason?.trim();
        add(
          control.id,
          hasReason && ctx.applicantNotified,
          `Reason recorded: ${hasReason ? 'yes' : 'no'}; applicant notified: ${ctx.applicantNotified ? 'yes' : 'no'}`
        );
        break;
      }
      case 'CTRL-04': {
        const ok = !!ctx.deciderId && ctx.deciderId !== ctx.applicantId;
        add(control.id, ok, ok ? `Decided by ${ctx.deciderEmail}, not the applicant` : 'The decider is the applicant');
        break;
      }
      case 'CTRL-05': {
        const ok = !!ctx.assignedTo && !!ctx.deciderEmail && ctx.assignedTo.toLowerCase() === ctx.deciderEmail.toLowerCase();
        add(control.id, ok, `Assigned to ${ctx.assignedTo ?? 'nobody'}; decided by ${ctx.deciderEmail ?? 'unknown'}`);
        break;
      }
      case 'CTRL-06': {
        add(control.id, ctx.fromStatus === 'In Review', `Moved from ${ctx.fromStatus ?? 'unknown'} to ${ctx.decision}`);
        break;
      }
      case 'CTRL-07': {
        const required = ctx.exemptionType ? REQUIRED_DOCUMENT[ctx.exemptionType] : undefined;
        const onFile = ctx.documentTypes.length ? ctx.documentTypes.join(', ') : 'none';
        add(
          control.id,
          !!required && ctx.documentTypes.includes(required),
          required ? `Requires ${required}; on file: ${onFile}` : 'No document rule for this exemption type'
        );
        break;
      }
      case 'CTRL-08': {
        add(
          control.id,
          ctx.auditLogged,
          ctx.auditLogged ? 'CASE_STATUS_CHANGE audit entry recorded for this decision' : 'No audit entry found for this decision'
        );
        break;
      }
    }
  }
  return results;
}

async function loadDecisionContext(caseId: string, eventId: string): Promise<DecisionContext> {
  const result = await pool.query(
    `SELECT e.from_status, e.to_status, e.actor_id, e.actor_email, e.detail,
            c.user_id AS applicant_id, c.assigned_to,
            x.exemption_type, x.status AS exemption_status, x.reason AS exemption_reason, x.determined_at,
            u.updated_at AS profile_updated_at,
            EXISTS (SELECT 1 FROM notifications n
                    WHERE n.case_id = c.id AND n.user_id = c.user_id AND n.created_at >= e.created_at) AS applicant_notified,
            EXISTS (SELECT 1 FROM audit_logs a
                    WHERE a.resource = 'cases' AND a.resource_id = c.id::text AND a.action = 'CASE_STATUS_CHANGE'
                      AND a.details->>'to' = e.to_status AND a.timestamp >= e.created_at) AS audit_logged,
            COALESCE((SELECT array_agg(DISTINCT d.document_type) FROM case_documents d
                      WHERE d.case_id = c.id AND d.created_at <= e.created_at), '{}') AS document_types
     FROM case_events e
     JOIN cases c ON c.id = e.case_id
     JOIN users u ON u.id = c.user_id
     LEFT JOIN exemptions x ON x.id = c.exemption_id
     WHERE e.id = $1 AND e.case_id = $2`,
    [eventId, caseId]
  );
  if (result.rows.length === 0) throw new NotFoundError('Decision not found');
  const r = result.rows[0];
  return {
    decision: r.to_status,
    applicantId: r.applicant_id,
    deciderId: r.actor_id,
    deciderEmail: r.actor_email,
    assignedTo: r.assigned_to,
    fromStatus: r.from_status,
    reason: r.detail,
    exemptionType: r.exemption_type,
    exemptionStatus: r.exemption_status,
    exemptionReason: r.exemption_reason,
    determinedAt: r.determined_at,
    profileUpdatedAt: r.profile_updated_at,
    applicantNotified: r.applicant_notified,
    auditLogged: r.audit_logged,
    documentTypes: r.document_types,
  };
}

/**
 * Records every applicable control result for a decision and opens a compliance review when any
 * fails. If the evaluation itself errors, a review is opened instead of failing silently: no
 * decision is left unchecked without someone being told.
 */
export async function evaluateDecision(caseId: string, eventId: string, actor: Actor) {
  try {
    const ctx = await loadDecisionContext(caseId, eventId);
    const results = evaluateControls(ctx);
    const failed = results.filter((r) => !r.passed).map((r) => r.controlId);

    await inTransaction(async (client) => {
      for (const r of results) {
        const control = DECISION_CONTROLS.find((c) => c.id === r.controlId)!;
        await client.query(
          `INSERT INTO compliance_checks
             (requirement_id, control_id, control_name, passed, evidence, checked_by, case_id, user_id,
              decision, decision_event_id, decided_by, decided_by_email)
           VALUES ($1, $2, $3, $4, $5, 'system', $6, $7, $8, $9, $10, $11)`,
          [control.reference, control.id, control.control, r.passed, r.evidence, caseId, ctx.applicantId,
           ctx.decision, eventId, ctx.deciderId, ctx.deciderEmail]
        );
      }
      if (failed.length > 0) {
        await client.query(
          `INSERT INTO compliance_reviews (case_id, decision_event_id, decision, decided_by_email, failed_controls)
           VALUES ($1, $2, $3, $4, $5)`,
          [caseId, eventId, ctx.decision, ctx.deciderEmail, failed]
        );
      }
    });

    await logAuditEvent(AuditAction.COMPLIANCE_CHECK, 'cases', failed.length ? 'failure' : 'success', {
      actor: actor.id,
      actorEmail: actor.email,
      resourceId: caseId,
      details: { decision: ctx.decision, controls: results.length, failedControls: failed },
    });
    return { results, failedControls: failed };
  } catch (error) {
    console.error('Compliance evaluation failed', { caseId, eventId, message: (error as Error).message });
    try {
      await pool.query(
        `INSERT INTO compliance_reviews (case_id, decision_event_id, decided_by_email, failed_controls)
         VALUES ($1, $2, $3, ARRAY['EVALUATION-ERROR'])`,
        [caseId, eventId, actor.email]
      );
    } catch (inner) {
      console.error('Could not open a compliance review for the failed evaluation', (inner as Error).message);
    }
    return null;
  }
}

function windowStart(days: number): number {
  return Math.min(Math.max(Math.floor(days) || 30, 1), 365);
}

export async function getDashboard(days = 30) {
  const window = windowStart(days);
  const decisionsCte = `
    WITH decisions AS (
      SELECT decision_event_id, MIN(checked_at) AS decided_at, BOOL_AND(passed) AS compliant
      FROM compliance_checks
      WHERE decision_event_id IS NOT NULL AND checked_at >= NOW() - make_interval(days => $1::int)
      GROUP BY decision_event_id
    )`;

  const [totals, daily, failures, reviews] = await Promise.all([
    pool.query(`${decisionsCte} SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE compliant)::int AS compliant FROM decisions`, [window]),
    pool.query(
      `${decisionsCte}
       SELECT to_char(decided_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS decisions, COUNT(*) FILTER (WHERE compliant)::int AS compliant
       FROM decisions GROUP BY day ORDER BY day`,
      [window]
    ),
    pool.query(
      `SELECT control_id, COUNT(*)::int AS checks, COUNT(*) FILTER (WHERE NOT passed)::int AS failures
       FROM compliance_checks
       WHERE decision_event_id IS NOT NULL AND checked_at >= NOW() - make_interval(days => $1::int)
       GROUP BY control_id`,
      [window]
    ),
    pool.query(`SELECT COUNT(*)::int AS open FROM compliance_reviews WHERE status = 'Open'`),
  ]);

  const total = totals.rows[0].total;
  const compliant = totals.rows[0].compliant;
  const rate = total > 0 ? Math.round((compliant / total) * 10000) / 100 : null;
  const byControl = new Map(failures.rows.map((r: any) => [r.control_id, r]));

  return {
    windowDays: window,
    target: COMPLIANCE_TARGET,
    totalDecisions: total,
    compliantDecisions: compliant,
    complianceRate: rate,
    alert:
      rate !== null && rate < COMPLIANCE_TARGET
        ? `Compliance rate ${rate}% is below the ${COMPLIANCE_TARGET}% target for the last ${window} days.`
        : null,
    openReviews: reviews.rows[0].open,
    controls: DECISION_CONTROLS.map((c) => ({
      ...c,
      checks: (byControl.get(c.id) as any)?.checks ?? 0,
      failures: (byControl.get(c.id) as any)?.failures ?? 0,
    })),
    daily: daily.rows,
  };
}

export interface CheckFilters {
  from?: string;
  to?: string;
  user?: string;
  decision?: string;
  controlId?: string;
  result?: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The compliance audit log: one row per control result, newest first. */
export async function queryChecks(filters: CheckFilters, page = 1, limit = 50) {
  const conditions = ['k.decision_event_id IS NOT NULL'];
  const params: any[] = [];
  const add = (sql: string, value: any) => {
    params.push(value);
    conditions.push(sql.replace(/\?/g, `$${params.length}`));
  };

  if (filters.from) {
    if (!DATE_PATTERN.test(filters.from)) throw new ValidationError('from must be a date (YYYY-MM-DD)');
    add('k.checked_at >= ?::date', filters.from);
  }
  if (filters.to) {
    if (!DATE_PATTERN.test(filters.to)) throw new ValidationError('to must be a date (YYYY-MM-DD)');
    add("k.checked_at < ?::date + INTERVAL '1 day'", filters.to);
  }
  if (filters.user) add('(u.email ILIKE ? OR k.decided_by_email ILIKE ?)', `%${filters.user}%`);
  if (filters.decision) add('k.decision = ?', filters.decision);
  if (filters.controlId) add('k.control_id = ?', filters.controlId);
  if (filters.result === 'pass' || filters.result === 'fail') add('k.passed = ?', filters.result === 'pass');

  const where = `WHERE ${conditions.join(' AND ')}`;
  const from = `FROM compliance_checks k JOIN cases c ON c.id = k.case_id JOIN users u ON u.id = c.user_id
                LEFT JOIN exemptions x ON x.id = c.exemption_id`;
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safePage = Math.max(page, 1);

  const [count, rows] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total ${from} ${where}`, params),
    pool.query(
      `SELECT k.id, k.checked_at, k.case_id, k.control_id, k.control_name, k.requirement_id, k.passed, k.evidence,
              k.checked_by, k.decision, k.decided_by_email, u.email AS applicant_email, u.full_name AS applicant_name,
              x.exemption_type
       ${from} ${where}
       ORDER BY k.checked_at DESC, k.control_id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, safeLimit, (safePage - 1) * safeLimit]
    ),
  ]);

  return {
    total: count.rows[0].total,
    page: safePage,
    checks: rows.rows.map((r: any) => ({
      id: r.id,
      checkedAt: r.checked_at,
      caseId: r.case_id,
      applicantName: r.applicant_name,
      applicantEmail: r.applicant_email,
      exemptionType: r.exemption_type,
      decision: r.decision,
      decidedBy: r.decided_by_email,
      controlId: r.control_id,
      control: r.control_name,
      reference: r.requirement_id,
      passed: r.passed,
      evidence: r.evidence,
      checkedBy: r.checked_by,
    })),
  };
}

function mapReview(r: any) {
  return {
    id: r.id,
    caseId: r.case_id,
    decision: r.decision,
    decidedBy: r.decided_by_email,
    failedControls: r.failed_controls,
    status: r.status,
    resolution: r.resolution,
    resolutionNote: r.resolution_note,
    resolvedBy: r.resolved_by_email,
    openedAt: r.opened_at,
    resolvedAt: r.resolved_at,
    applicantName: r.applicant_name,
    applicantEmail: r.applicant_email,
    exemptionType: r.exemption_type,
  };
}

const REVIEW_SELECT = `
  SELECT r.*, u.full_name AS applicant_name, u.email AS applicant_email, x.exemption_type
  FROM compliance_reviews r
  JOIN cases c ON c.id = r.case_id
  JOIN users u ON u.id = c.user_id
  LEFT JOIN exemptions x ON x.id = c.exemption_id`;

export async function listReviews(status: string = 'Open') {
  const result = await pool.query(
    `${REVIEW_SELECT} ${status === 'all' ? '' : 'WHERE r.status = $1'} ORDER BY r.opened_at DESC LIMIT 200`,
    status === 'all' ? [] : [status]
  );
  return result.rows.map(mapReview);
}

/** Every decision on a case with its control results, plus the case's compliance reviews. */
export async function getCaseCompliance(caseId: string) {
  const [checks, reviews] = await Promise.all([
    pool.query(
      `SELECT decision_event_id, decision, decided_by_email, checked_at, control_id, control_name, requirement_id, passed, evidence
       FROM compliance_checks WHERE case_id = $1 AND decision_event_id IS NOT NULL
       ORDER BY checked_at DESC, control_id`,
      [caseId]
    ),
    pool.query(`${REVIEW_SELECT} WHERE r.case_id = $1 ORDER BY r.opened_at DESC`, [caseId]),
  ]);

  const decisions = new Map<string, any>();
  for (const r of checks.rows) {
    if (!decisions.has(r.decision_event_id)) {
      decisions.set(r.decision_event_id, {
        eventId: r.decision_event_id,
        decision: r.decision,
        decidedBy: r.decided_by_email,
        checkedAt: r.checked_at,
        compliant: true,
        controls: [],
      });
    }
    const d = decisions.get(r.decision_event_id);
    d.controls.push({ controlId: r.control_id, control: r.control_name, reference: r.requirement_id, passed: r.passed, evidence: r.evidence });
    if (!r.passed) d.compliant = false;
  }

  return { decisions: [...decisions.values()], reviews: reviews.rows.map(mapReview) };
}

/**
 * Resolves an open review. "accept" records a justified exception; "reopen" sends the case back
 * to In Review so it is decided again (and re-evaluated). The resolver must be a different
 * person from the one who made the decision (NIST AC-5).
 */
export async function resolveReview(reviewId: string, action: string, note: string, actor: Actor) {
  if (action !== 'accept' && action !== 'reopen') {
    throw new ValidationError('action must be "accept" or "reopen"');
  }
  const text = note?.trim();
  if (!text) throw new ValidationError('A justification note is required to resolve a compliance review');
  if (text.length > 2000) throw new ValidationError('Note must be 2000 characters or less');

  const found = await pool.query(`${REVIEW_SELECT} WHERE r.id = $1`, [reviewId]);
  if (found.rows.length === 0) throw new NotFoundError('Compliance review not found');
  const review = found.rows[0];
  if (review.status !== 'Open') throw new AppError(409, 'This review is already resolved', 'CONFLICT');
  if (review.decided_by_email && review.decided_by_email.toLowerCase() === actor.email.toLowerCase()) {
    throw new AppError(403, 'A different case manager must resolve a review of your own decision', 'FORBIDDEN');
  }

  const caseRow = await pool.query('SELECT user_id, status FROM cases WHERE id = $1', [review.case_id]);
  const applicantId = caseRow.rows[0].user_id;
  if (applicantId === actor.id) {
    throw new AppError(403, 'You cannot resolve a review of your own case', 'FORBIDDEN');
  }

  const resolution = action === 'accept' ? 'Exception accepted' : 'Case reopened';
  await inTransaction(async (client) => {
    await client.query(
      `UPDATE compliance_reviews
       SET status = 'Resolved', resolution = $1, resolution_note = $2, resolved_by = $3, resolved_by_email = $4,
           resolved_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [resolution, text, actor.id, actor.email, reviewId]
    );

    if (action === 'reopen') {
      const fromStatus = caseRow.rows[0].status;
      await client.query(
        `UPDATE cases SET status = 'In Review', approved_at = NULL, updated_at = NOW() WHERE id = $1`,
        [review.case_id]
      );
      await recordEvent(client, review.case_id, 'status_change', actor, {
        fromStatus,
        toStatus: 'In Review',
        detail: 'Reopened after a compliance review',
      });
      const typeLabel = review.exemption_type ? `${review.exemption_type} ` : '';
      await notify(client, applicantId, review.case_id, `Your ${typeLabel}exemption case has been reopened for another review.`);
    } else {
      await recordEvent(client, review.case_id, 'compliance_review', actor, {
        detail: 'Compliance exception accepted',
      });
    }
  });

  await logAuditEvent(action === 'accept' ? AuditAction.OVERRIDE : AuditAction.CASE_STATUS_CHANGE, 'cases', 'success', {
    actor: actor.id,
    actorEmail: actor.email,
    resourceId: review.case_id,
    details:
      action === 'accept'
        ? { complianceReview: reviewId, resolution, failedControls: review.failed_controls }
        : { from: caseRow.rows[0].status, to: 'In Review', complianceReview: reviewId },
  });

  const updated = await pool.query(`${REVIEW_SELECT} WHERE r.id = $1`, [reviewId]);
  return mapReview(updated.rows[0]);
}

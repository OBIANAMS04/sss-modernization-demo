import pool from '../database/connection';
import { calculateAge } from '../utils/age';
import { AuditAction, logAuditEvent } from './auditService';
import { getUserById } from './userService';

export { calculateAge };

export type ExemptionType = 'Type A' | 'Type B' | 'Type C';
export type ExemptionStatus = 'Eligible' | 'Pending Review' | 'Not Eligible';

export interface ExemptionEvaluation {
  exemptionType: ExemptionType;
  label: string;
  status: ExemptionStatus;
  reason: string;
}

export interface ExemptionEligibilityResult {
  eligible: boolean;
  exemptions: string[];
  evaluations: ExemptionEvaluation[];
  determinedAt: string;
}

export interface ExemptionData {
  id: string;
  userId: string;
  exemptionType: ExemptionType;
  label: string;
  status: ExemptionStatus;
  reason?: string;
  determinedAt: string;
  determinedBy: string;
}

export interface UserData {
  id: string;
  dob: string;
  phone?: string;
  address?: string;
  income?: number | null;
  hasDocumentedHardship?: boolean;
}

export type EligibilityTrigger = 'manual' | 'profile_update';

export const SENIOR_AGE = 65;
export const POVERTY_THRESHOLD = 20000; // Annual income threshold for Type B

const LABELS: Record<ExemptionType, string> = {
  'Type A': 'Type A - Senior Exemption',
  'Type B': 'Type B - Income-Based Exemption',
  'Type C': 'Type C - Hardship Exemption (Pending Review)',
};

// Reasons deliberately avoid echoing the applicant's exact age or income, since they
// are shown in the UI and written to the audit log.
function evaluateAge(user: UserData): ExemptionEvaluation {
  const age = user.dob ? calculateAge(user.dob) : NaN;
  if (Number.isNaN(age)) {
    return { exemptionType: 'Type A', label: LABELS['Type A'], status: 'Not Eligible', reason: 'Date of birth is missing or invalid.' };
  }
  return age >= SENIOR_AGE
    ? { exemptionType: 'Type A', label: LABELS['Type A'], status: 'Eligible', reason: `Applicant is ${SENIOR_AGE} or older.` }
    : { exemptionType: 'Type A', label: LABELS['Type A'], status: 'Not Eligible', reason: `Applicant is under ${SENIOR_AGE}.` };
}

function evaluateIncome(user: UserData): ExemptionEvaluation {
  const threshold = `$${POVERTY_THRESHOLD.toLocaleString('en-US')}`;
  if (user.income === undefined || user.income === null) {
    return {
      exemptionType: 'Type B',
      label: LABELS['Type B'],
      status: 'Not Eligible',
      reason: 'No annual income on file. Add it to your profile to be considered.',
    };
  }
  return user.income < POVERTY_THRESHOLD
    ? { exemptionType: 'Type B', label: LABELS['Type B'], status: 'Eligible', reason: `Annual income is below the ${threshold} threshold.` }
    : { exemptionType: 'Type B', label: LABELS['Type B'], status: 'Not Eligible', reason: `Annual income is at or above the ${threshold} threshold.` };
}

function evaluateHardship(user: UserData): ExemptionEvaluation {
  return user.hasDocumentedHardship
    ? {
        exemptionType: 'Type C',
        label: LABELS['Type C'],
        status: 'Pending Review',
        reason: 'Documented hardship on file. A caseworker must review it.',
      }
    : { exemptionType: 'Type C', label: LABELS['Type C'], status: 'Not Eligible', reason: 'No documented hardship on file.' };
}

/** Pure rule evaluation: every exemption type gets a status and a reason. */
export function checkExemptionEligibility(user: UserData): ExemptionEligibilityResult {
  const evaluations = [evaluateAge(user), evaluateIncome(user), evaluateHardship(user)];
  const exemptions = evaluations.filter((e) => e.status !== 'Not Eligible').map((e) => e.label);

  return {
    eligible: exemptions.length > 0,
    exemptions,
    evaluations,
    determinedAt: new Date().toISOString(),
  };
}

function mapRow(row: any): ExemptionData {
  return {
    id: row.id,
    userId: row.user_id,
    exemptionType: row.exemption_type,
    label: LABELS[row.exemption_type as ExemptionType] ?? row.exemption_type,
    status: row.status,
    reason: row.reason,
    determinedAt: row.determined_at,
    determinedBy: row.determined_by,
  };
}

/**
 * Loads the user's profile, evaluates every exemption type, persists one row per type
 * (updated in place), and writes the determination with its reasoning to the audit log.
 */
export async function runEligibilityCheck(
  userId: string,
  trigger: EligibilityTrigger,
  actorEmail?: string
): Promise<ExemptionEligibilityResult> {
  const user = await getUserById(userId);
  const result = checkExemptionEligibility({
    id: user.id,
    dob: user.dob,
    income: user.annualIncome,
    hasDocumentedHardship: user.hasDocumentedHardship,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of result.evaluations) {
      await client.query(
        `INSERT INTO exemptions (user_id, exemption_type, status, reason, determined_at, determined_by)
         VALUES ($1, $2, $3, $4, $5, 'system')
         ON CONFLICT (user_id, exemption_type) DO UPDATE
           SET status = EXCLUDED.status,
               reason = EXCLUDED.reason,
               determined_at = EXCLUDED.determined_at,
               determined_by = EXCLUDED.determined_by,
               updated_at = CURRENT_TIMESTAMP`,
        [userId, e.exemptionType, e.status, e.reason, result.determinedAt]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await logAuditEvent(AuditAction.EXEMPTION_CHECK, 'exemptions', 'success', {
    actor: userId,
    actorEmail,
    resourceId: userId,
    details: {
      trigger,
      eligible: result.eligible,
      evaluations: result.evaluations.map(({ exemptionType, status, reason }) => ({ exemptionType, status, reason })),
    },
  });

  return result;
}

export async function getExemptionsByUserId(userId: string): Promise<ExemptionData[]> {
  const result = await pool.query(
    `SELECT id, user_id, exemption_type, status, reason, determined_at, determined_by
     FROM exemptions WHERE user_id = $1 ORDER BY exemption_type`,
    [userId]
  );
  return result.rows.map(mapRow);
}

export async function getExemptionStats(): Promise<{ total: number; byType: Record<string, number> }> {
  const result = await pool.query(
    `SELECT exemption_type, COUNT(*) as count FROM exemptions
     WHERE status <> 'Not Eligible' GROUP BY exemption_type`
  );

  const byType: Record<string, number> = {};
  let total = 0;

  for (const row of result.rows) {
    byType[row.exemption_type] = parseInt(row.count, 10);
    total += parseInt(row.count, 10);
  }

  return { total, byType };
}

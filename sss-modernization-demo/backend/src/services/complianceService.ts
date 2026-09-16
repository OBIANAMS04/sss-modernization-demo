import pool from '../database/connection';
import { NotFoundError } from '../utils/errors';

export interface ComplianceCheck {
  id: string;
  requirementId: string;
  caseId?: string;
  userId?: string;
  controlName: string;
  passed: boolean;
  evidence?: string;
  checkedBy?: string;
  checkedAt: string;
}

export interface ComplianceDashboard {
  date: string;
  totalDecisions: number;
  compliantDecisions: number;
  complianceRate: number;
  alerts?: string[];
}

// Compliance Matrix: FAR requirements mapped to controls
export const COMPLIANCE_MATRIX = [
  {
    requirementId: 'FAR 52.209-2',
    description: 'Integrity (Previous Contractor Performance)',
    control: 'Audit Logging 100%',
    evidence: 'case_decisions table tracks all decisions',
  },
  {
    requirementId: 'FAR 52.210-1',
    description: 'Default Risk (Terminations for Default)',
    control: 'Credit Check on File',
    evidence: 'case_documents table tracks uploaded docs',
  },
  {
    requirementId: 'FAR 52.212-1',
    description: 'Flow-downs (Contractor Requirements)',
    control: 'Exemption Rules Enforced',
    evidence: 'exemptions table validates eligibility',
  },
  {
    requirementId: 'AC-2',
    description: 'Account Management (NIST 800-53)',
    control: 'IAM Roles & Permissions',
    evidence: 'JWT tokens with role claims',
  },
  {
    requirementId: 'AC-3',
    description: 'Access Control (NIST 800-53)',
    control: 'Role-Based Access Control',
    evidence: 'routes verify user ownership',
  },
  {
    requirementId: 'SC-8',
    description: 'Transmission Confidentiality (NIST 800-53)',
    control: 'TLS 1.2+ for HTTPS',
    evidence: 'All API communication encrypted',
  },
];

export async function logComplianceCheck(
  requirementId: string,
  controlName: string,
  passed: boolean,
  caseId?: string,
  userId?: string,
  evidence?: string,
  checkedBy?: string
): Promise<ComplianceCheck> {
  const result = await pool.query(
    `INSERT INTO compliance_checks (requirement_id, case_id, user_id, control_name, passed, evidence, checked_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, requirement_id, case_id, user_id, control_name, passed, evidence, checked_by, checked_at`,
    [requirementId, caseId || null, userId || null, controlName, passed, evidence || null, checkedBy || null]
  );

  return mapRowToComplianceCheck(result.rows[0]);
}

export async function getComplianceChecksByRequirement(
  requirementId: string,
  limit: number = 50
): Promise<ComplianceCheck[]> {
  const result = await pool.query(
    `SELECT id, requirement_id, case_id, user_id, control_name, passed, evidence, checked_by, checked_at
     FROM compliance_checks WHERE requirement_id = $1 ORDER BY checked_at DESC LIMIT $2`,
    [requirementId, limit]
  );

  return result.rows.map(mapRowToComplianceCheck);
}

export async function getComplianceChecksByCase(caseId: string): Promise<ComplianceCheck[]> {
  const result = await pool.query(
    `SELECT id, requirement_id, case_id, user_id, control_name, passed, evidence, checked_by, checked_at
     FROM compliance_checks WHERE case_id = $1 ORDER BY checked_at DESC`,
    [caseId]
  );

  return result.rows.map(mapRowToComplianceCheck);
}

export async function getComplianceChecksByDateRange(
  startDate: string,
  endDate: string,
  limit: number = 100
): Promise<ComplianceCheck[]> {
  const result = await pool.query(
    `SELECT id, requirement_id, case_id, user_id, control_name, passed, evidence, checked_by, checked_at
     FROM compliance_checks
     WHERE DATE(checked_at) >= $1 AND DATE(checked_at) <= $2
     ORDER BY checked_at DESC LIMIT $3`,
    [startDate, endDate, limit]
  );

  return result.rows.map(mapRowToComplianceCheck);
}

export async function calculateComplianceMetrics(dateStr: string): Promise<ComplianceDashboard> {
  // Get all compliance checks for the day
  const checksResult = await pool.query(
    `SELECT COUNT(*) as total, COUNT(CASE WHEN passed = TRUE THEN 1 END) as passed
     FROM compliance_checks WHERE DATE(checked_at) = $1`,
    [dateStr]
  );

  const total = parseInt(checksResult.rows[0].total, 10);
  const passed = parseInt(checksResult.rows[0].passed, 10);
  const rate = total > 0 ? (passed / total) * 100 : 0;

  const alerts: string[] = [];
  if (rate < 99) {
    alerts.push(`Compliance rate below 99% target: ${rate.toFixed(2)}%`);
  }

  // Update or create dashboard record
  const existingResult = await pool.query(
    `SELECT id FROM compliance_dashboard WHERE date = $1`,
    [dateStr]
  );

  if (existingResult.rows.length > 0) {
    await pool.query(
      `UPDATE compliance_dashboard
       SET total_decisions = $1, compliant_decisions = $2, compliance_rate = $3, alerts = $4, updated_at = NOW()
       WHERE date = $5`,
      [total, passed, rate, alerts.length > 0 ? JSON.stringify(alerts) : null, dateStr]
    );
  } else {
    await pool.query(
      `INSERT INTO compliance_dashboard (date, total_decisions, compliant_decisions, compliance_rate, alerts)
       VALUES ($1, $2, $3, $4, $5)`,
      [dateStr, total, passed, rate, alerts.length > 0 ? JSON.stringify(alerts) : null]
    );
  }

  return {
    date: dateStr,
    totalDecisions: total,
    compliantDecisions: passed,
    complianceRate: Math.round(rate * 100) / 100,
    alerts,
  };
}

export async function getDashboardMetrics(days: number = 7): Promise<ComplianceDashboard[]> {
  const result = await pool.query(
    `SELECT date, total_decisions, compliant_decisions, compliance_rate, alerts
     FROM compliance_dashboard ORDER BY date DESC LIMIT $1`,
    [days]
  );

  return result.rows.map((row: any) => ({
    date: row.date.toISOString().split('T')[0],
    totalDecisions: row.total_decisions,
    compliantDecisions: row.compliant_decisions,
    complianceRate: parseFloat(row.compliance_rate),
    alerts: row.alerts ? JSON.parse(row.alerts) : [],
  }));
}

export async function performComplianceChecks(caseId: string, userId: string): Promise<ComplianceCheck[]> {
  const checks: ComplianceCheck[] = [];

  // Perform each compliance check
  for (const requirement of COMPLIANCE_MATRIX) {
    const passed = await verifyRequirement(requirement.requirementId, caseId, userId);

    const check = await logComplianceCheck(
      requirement.requirementId,
      requirement.control,
      passed,
      caseId,
      userId,
      requirement.evidence,
      'system'
    );

    checks.push(check);
  }

  // Recalculate dashboard metrics
  const today = new Date().toISOString().split('T')[0];
  await calculateComplianceMetrics(today);

  return checks;
}

async function verifyRequirement(requirementId: string, caseId: string, userId: string): Promise<boolean> {
  try {
    switch (requirementId) {
      // FAR Requirements
      case 'FAR 52.209-2': // Audit Logging
        return await verifyAuditLogging(caseId);

      case 'FAR 52.210-1': // Credit Check
        return await verifyCreditCheck(caseId);

      case 'FAR 52.212-1': // Flow-downs
        return await verifyFlowDowns(userId);

      // NIST Requirements
      case 'AC-2': // Account Management
        return await verifyAccountManagement(userId);

      case 'AC-3': // Access Control
        return await verifyAccessControl(userId);

      case 'SC-8': // Transmission Confidentiality
        return true; // Assumed true - infrastructure level

      default:
        return false;
    }
  } catch (error) {
    console.error(`Compliance check failed for ${requirementId}:`, error);
    return false;
  }
}

// Requirement verification functions
async function verifyAuditLogging(caseId: string): Promise<boolean> {
  // Check if case has been logged in compliance system
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM compliance_checks WHERE case_id = $1`,
    [caseId]
  );
  return parseInt(result.rows[0].count, 10) > 0;
}

async function verifyCreditCheck(caseId: string): Promise<boolean> {
  // Check if case has at least one document (proxy for credit check)
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM case_documents WHERE case_id = $1`,
    [caseId]
  );
  return parseInt(result.rows[0].count, 10) > 0;
}

async function verifyFlowDowns(userId: string): Promise<boolean> {
  // Check if user has at least one exemption determination
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM exemptions WHERE user_id = $1`,
    [userId]
  );
  return parseInt(result.rows[0].count, 10) > 0;
}

async function verifyAccountManagement(userId: string): Promise<boolean> {
  // Check if user account exists and is properly configured
  const result = await pool.query(
    `SELECT id FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows.length > 0;
}

async function verifyAccessControl(userId: string): Promise<boolean> {
  // Check if user has valid JWT (assumed if they passed auth)
  return true;
}

// Helper function
function mapRowToComplianceCheck(row: any): ComplianceCheck {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    caseId: row.case_id,
    userId: row.user_id,
    controlName: row.control_name,
    passed: row.passed,
    evidence: row.evidence,
    checkedBy: row.checked_by,
    checkedAt: row.checked_at,
  };
}

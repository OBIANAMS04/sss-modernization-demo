import pool from '../database/connection';
import { NotFoundError, ValidationError } from '../utils/errors';

export interface ExemptionData {
  id: string;
  userId: string;
  exemptionType: string;
  status: string;
  reason?: string;
  determinedAt: string;
  determinedBy: string;
}

export interface ExemptionEligibilityResult {
  eligible: boolean;
  exemptions: string[];
  determinedAt: string;
}

export interface UserData {
  id: string;
  dob: string;
  phone?: string;
  address?: string;
  income?: number;
  hasDocumentedHardship?: boolean;
}

const POVERTY_THRESHOLD = 20000; // Annual income threshold for Type B

export function calculateAge(dobString: string): number {
  const dob = new Date(dobString);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function checkExemptionEligibility(user: UserData): ExemptionEligibilityResult {
  const exemptions: string[] = [];

  // Type A: Age-based (>= 65)
  const age = calculateAge(user.dob);
  if (age >= 65) {
    exemptions.push('Type A - Senior Exemption');
  }

  // Type B: Income-based (< federal poverty threshold)
  if (user.income && user.income < POVERTY_THRESHOLD) {
    exemptions.push('Type B - Income-Based Exemption');
  }

  // Type C: Hardship (documented hardship on file)
  if (user.hasDocumentedHardship) {
    exemptions.push('Type C - Hardship Exemption (Pending Review)');
  }

  return {
    eligible: exemptions.length > 0,
    exemptions,
    determinedAt: new Date().toISOString(),
  };
}

export async function createExemptions(
  userId: string,
  exemptionTypes: string[],
  reason?: string
): Promise<ExemptionData[]> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete existing exemptions for this user
    await client.query('DELETE FROM exemptions WHERE user_id = $1', [userId]);

    const created: ExemptionData[] = [];

    // Insert new exemptions
    for (const exemptionType of exemptionTypes) {
      const result = await client.query(
        `INSERT INTO exemptions (user_id, exemption_type, status, reason, determined_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, exemption_type, status, reason, determined_at, determined_by`,
        [userId, exemptionType, 'Eligible', reason || null, 'system']
      );

      const row = result.rows[0];
      created.push({
        id: row.id,
        userId: row.user_id,
        exemptionType: row.exemption_type,
        status: row.status,
        reason: row.reason,
        determinedAt: row.determined_at,
        determinedBy: row.determined_by,
      });
    }

    await client.query('COMMIT');
    return created;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getExemptionsByUserId(userId: string): Promise<ExemptionData[]> {
  const result = await pool.query(
    `SELECT id, user_id, exemption_type, status, reason, determined_at, determined_by
     FROM exemptions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    exemptionType: row.exemption_type,
    status: row.status,
    reason: row.reason,
    determinedAt: row.determined_at,
    determinedBy: row.determined_by,
  }));
}

export async function checkAndCreateExemptions(
  userId: string,
  userInfo: UserData
): Promise<ExemptionEligibilityResult> {
  const eligibility = checkExemptionEligibility(userInfo);

  // Create exemption records if eligible
  if (eligibility.eligible && eligibility.exemptions.length > 0) {
    await createExemptions(userId, eligibility.exemptions);
  }

  return eligibility;
}

export async function deleteExemptionsByUserId(userId: string): Promise<void> {
  await pool.query('DELETE FROM exemptions WHERE user_id = $1', [userId]);
}

export async function getExemptionStats(): Promise<{ total: number; byType: Record<string, number> }> {
  const result = await pool.query(
    `SELECT exemption_type, COUNT(*) as count FROM exemptions GROUP BY exemption_type`
  );

  const byType: Record<string, number> = {};
  let total = 0;

  for (const row of result.rows) {
    byType[row.exemption_type] = parseInt(row.count, 10);
    total += parseInt(row.count, 10);
  }

  return { total, byType };
}

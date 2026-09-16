import pool from '../database/connection';
import { NotFoundError, ValidationError } from '../utils/errors';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  ssn: string;
  dob: string;
  phone?: string;
  address?: string;
  mfaEnabled: boolean;
  complianceStatus: string;
}

export interface UpdateProfileInput {
  phone?: string;
  address?: string;
}

export async function getUserById(userId: string): Promise<UserProfile> {
  const result = await pool.query(
    `SELECT id, email, full_name, ssn, dob, phone, address, mfa_enabled, compliance_status
     FROM users WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('User not found');
  }

  const user = result.rows[0];
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    ssn: user.ssn,
    dob: user.dob,
    phone: user.phone,
    address: user.address,
    mfaEnabled: user.mfa_enabled,
    complianceStatus: user.compliance_status,
  };
}

export async function updateUserProfile(
  userId: string,
  input: UpdateProfileInput
): Promise<UserProfile> {
  // Validate input
  if (input.phone && !/^[+\d\-\s()]+$/.test(input.phone)) {
    throw new ValidationError('Invalid phone number format');
  }

  if (input.address && input.address.length > 500) {
    throw new ValidationError('Address must be 500 characters or less');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update user
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramCount = 1;

    if (input.phone !== undefined) {
      updateFields.push(`phone = $${paramCount}`);
      updateValues.push(input.phone || null);
      paramCount++;
    }

    if (input.address !== undefined) {
      updateFields.push(`address = $${paramCount}`);
      updateValues.push(input.address || null);
      paramCount++;
    }

    updateFields.push(`updated_at = NOW()`);

    if (updateFields.length === 1) {
      // No actual updates, just return current user
      return await getUserById(userId);
    }

    // Perform update
    updateValues.push(userId);
    await client.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${paramCount}`,
      updateValues
    );

    // Run compliance check
    await checkAndUpdateCompliance(client, userId);

    await client.query('COMMIT');

    return await getUserById(userId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function checkAndUpdateCompliance(client: any, userId: string): Promise<void> {
  const result = await client.query(
    `SELECT dob, phone, address FROM users WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('User not found');
  }

  const user = result.rows[0];
  const complianceStatus = determineCompliance(user);

  await client.query(
    `UPDATE users SET compliance_status = $1, compliance_checked_at = NOW() WHERE id = $2`,
    [complianceStatus, userId]
  );
}

export function determineCompliance(user: any): string {
  // Rules:
  // 1. User must be >= 18 years old
  // 2. User must have valid phone on file (non-empty)
  // 3. User must have address on file (non-empty)

  const dob = new Date(user.dob);
  const today = new Date();
  const age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    // Birthday hasn't happened yet this year
    if (age < 18) return 'Ineligible';
  } else if (age < 18) {
    return 'Ineligible';
  }

  // Check for phone and address
  const hasPhone = user.phone && user.phone.trim().length > 0;
  const hasAddress = user.address && user.address.trim().length > 0;

  if (!hasPhone || !hasAddress) {
    return 'Pending Review';
  }

  // All checks passed
  return 'Eligible';
}

export async function getUserComplianceStatus(userId: string): Promise<string> {
  const result = await pool.query(
    `SELECT compliance_status FROM users WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('User not found');
  }

  return result.rows[0].compliance_status;
}

import pool from '../database/connection';
import { AppError } from '../utils/errors';

export interface MFASetupResponse {
  secret: string;
  qrCode: string;
}

export interface MFAVerifyInput {
  totpCode: string;
}

// Generate TOTP secret and QR code
export async function generateMFASecret(userId: string, email: string): Promise<MFASetupResponse> {
  // MFA disabled for Phase 4
  throw new AppError(501, 'MFA not yet available - coming in Phase 5');
}

// Verify TOTP code and enable MFA
export async function verifyAndEnableMFA(
  userId: string,
  secret: string,
  totpCode: string
): Promise<void> {
  throw new AppError(501, 'MFA not yet available - coming in Phase 5');
}

// Verify TOTP code during login
export async function verifyMFACode(userId: string, totpCode: string): Promise<boolean> {
  throw new AppError(501, 'MFA not yet available - coming in Phase 5');
}

// Check if user has MFA enabled
export async function isMFAEnabled(userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT mfa_enabled FROM users WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  return result.rows[0].mfa_enabled;
}

// Disable MFA
export async function disableMFA(userId: string): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete MFA devices
    await client.query(`DELETE FROM mfa_devices WHERE user_id = $1`, [userId]);

    // Disable MFA on user
    await client.query(
      `UPDATE users SET mfa_enabled = false, updated_at = NOW() WHERE id = $1`,
      [userId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

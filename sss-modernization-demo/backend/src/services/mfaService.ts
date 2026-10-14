// STORY-003: referenced here, not only included by tsconfig, so ts-node (npm run dev) finds them as well as tsc and jest
/// <reference path="../types/speakeasy.d.ts" />
/// <reference path="../types/qrcode.d.ts" />
import { randomBytes } from 'node:crypto';
import { toDataURL } from 'qrcode';
import { totp } from 'speakeasy';
import pool from '../database/connection';
import { AppError, ConflictError, UnauthorizedError } from '../utils/errors';
import { PendingClaims } from '../utils/jwt';

// STORY-003: authenticator-app codes (TOTP, RFC 6238) for sign-in. A code is accepted one 30-second step either side of
// now and only once (its time step is recorded), and a pending sign-in, or a signed-in session, gets five tries before
// the person must sign in again. The key is kept as base32 in mfa_devices.secret_key, because a code check needs it
// readable (not encrypted at rest in the demo); it is sent once, by setup, and is never logged or put in the audit log.

export interface MFASetupResponse {
  secret: string;
  /** The same key as an otpauth:// address, which is what the QR code holds. */
  otpauthUrl: string;
  /** A PNG data: URL of the QR code. */
  qrCode: string;
}

export interface MFAVerifyInput {
  totpCode: string;
}

/** The person a verified sign-in code belongs to, shaped like the user a password login returns. */
export interface SignInUser {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
  role: string;
}

// The name an authenticator app lists the account under ("SSS Modernization Demo (person@example.com)")
export const MFA_ISSUER = 'SSS Modernization Demo';
/** Codes checked per pending sign-in (or per signed-in session) before the person must sign in again. */
export const MAX_CODE_ATTEMPTS = 5;
const SIGN_IN_FINISHED = 'This sign-in is already finished. Please sign in again.';
const STEP_SECONDS = 30;
const WINDOW_STEPS = 1; // a code is accepted one step either side of now, for a slow clock or a slow typist
const SECRET_BYTES = 20; // 160 bits, the size RFC 4226 recommends
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The code checks that count against the limit and are audited as MFA_VERIFY_FAILED. */
export class CodeRefusedError extends AppError {
  constructor(statusCode: number, message: string, code: string, public attempt: number) {
    super(statusCode, message, code);
    Object.setPrototypeOf(this, CodeRefusedError.prototype);
  }
}

/** RFC 4648 base32 without padding, the form authenticator apps expect a key in. */
export function toBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + BASE32[(value << (5 - bits)) & 31] : out;
}

/** A new random key: 32 characters of base32. speakeasy's own generator draws only about 119 bits at that length. */
export function newSecret(): string {
  return toBase32(randomBytes(SECRET_BYTES));
}

/** The address a QR code carries (Key URI Format), so Google Authenticator, Authy and Microsoft Authenticator can all add it. */
export function otpauthUrl(secret: string, email: string): string {
  const issuer = encodeURIComponent(MFA_ISSUER);
  return `otpauth://totp/${issuer}:${encodeURIComponent(email)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/** The time step the code is valid for, if it falls within one step either side of `atMs`; null if it is not valid. */
export function matchTotp(secret: string, code: string, atMs: number = Date.now()): number | null {
  // speakeasy compares numbers, so " 12345" would pass for "012345"; only exactly six digits is a code
  if (!/^\d{6}$/.test(code)) return null;
  const seconds = Math.floor(atMs / 1000);
  const found = totp.verifyDelta({ secret, encoding: 'base32', token: code, window: WINDOW_STEPS, step: STEP_SECONDS, time: seconds });
  return found ? Math.floor(seconds / STEP_SECONDS) + found.delta : null;
}

const tooMany = (attempt: number) =>
  new CodeRefusedError(429, 'Too many incorrect codes. Please sign in again.', 'TOO_MANY_ATTEMPTS', attempt);

/** A refused code. The last allowed try ends the sign-in at once, so the person is not left to find out on the next one. */
function refusal(attempt: number, reason: 'INVALID_CODE' | 'CODE_ALREADY_USED'): CodeRefusedError {
  if (attempt >= MAX_CODE_ATTEMPTS) return tooMany(attempt);
  const left = MAX_CODE_ATTEMPTS - attempt;
  const tries = `${left} ${left === 1 ? 'try' : 'tries'} left`;
  const message =
    reason === 'INVALID_CODE'
      ? `That code is not correct. ${tries}.`
      : `That code was already used. Wait for the next code in your app. ${tries}.`;
  return new CodeRefusedError(400, message, reason, attempt);
}

/**
 * STORY-003: counts one code check against `budget` and returns how many have been made, this one included. This runs
 * before the code is looked at, in a single statement, so guesses sent at the same moment are all counted.
 */
async function countAttempt(budget: string, userId: string): Promise<{ attempts: number; finished: boolean }> {
  const result = await pool.query(
    `INSERT INTO mfa_code_attempts (budget, user_id, attempts) VALUES ($1, $2, 1)
     ON CONFLICT (budget) DO UPDATE SET attempts = mfa_code_attempts.attempts + 1
     RETURNING attempts, completed_at`,
    [budget, userId]
  );
  const attempts: number = result.rows[0].attempts;
  // A new budget is a good moment to drop the old ones; no sign-in or session lasts a day
  if (attempts === 1) await pool.query(`DELETE FROM mfa_code_attempts WHERE created_at < NOW() - INTERVAL '1 day'`);
  return { attempts, finished: result.rows[0].completed_at != null };
}

/** Counts the try and refuses once the limit is passed, or once the sign-in it belongs to has finished. */
async function reserveAttempt(budget: string, userId: string): Promise<number> {
  const { attempts, finished } = await countAttempt(budget, userId);
  // Refused before the code is looked at, so a replayed pending token cannot use up the person's next code
  if (finished) throw new UnauthorizedError(SIGN_IN_FINISHED);
  if (attempts > MAX_CODE_ATTEMPTS) throw tooMany(attempts);
  return attempts;
}

// Generate TOTP secret and QR code
export async function generateMFASecret(userId: string, email: string): Promise<MFASetupResponse> {
  if (await isMFAEnabled(userId)) {
    throw new ConflictError('Two-step verification is already on. Turn it off before setting up a new device.');
  }

  const secret = newSecret();
  const url = otpauthUrl(secret, email);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Only the latest setup can be confirmed, so the QR code on screen always matches the stored key
    await client.query(`DELETE FROM mfa_devices WHERE user_id = $1 AND verified = FALSE`, [userId]);
    await client.query(
      `INSERT INTO mfa_devices (user_id, device_name, secret_key, verified) VALUES ($1, 'Authenticator app', $2, FALSE)`,
      [userId, secret]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { secret, otpauthUrl: url, qrCode: await toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 240 }) };
}

// Verify TOTP code and enable MFA
export async function verifyAndEnableMFA(userId: string, totpCode: string, budget: string): Promise<void> {
  if (await isMFAEnabled(userId)) {
    throw new ConflictError('Two-step verification is already on.');
  }
  const attempt = await reserveAttempt(budget, userId);

  // The key comes from the setup the server stored, never from the request
  const waiting = (
    await pool.query(
      `SELECT id, secret_key FROM mfa_devices WHERE user_id = $1 AND verified = FALSE ORDER BY created_at DESC LIMIT 1`,
      [userId]
    )
  ).rows[0];
  if (!waiting) {
    throw new AppError(400, 'Start setup first: there is no authenticator waiting to be confirmed.', 'SETUP_NOT_STARTED');
  }

  const step = matchTotp(waiting.secret_key, totpCode);
  if (step === null) throw refusal(attempt, 'INVALID_CODE');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The code that confirms the device is spent too, so it cannot be used again at the next sign-in
    await client.query(`UPDATE mfa_devices SET verified = TRUE, last_used_step = $2, updated_at = NOW() WHERE id = $1`, [waiting.id, step]);
    await client.query(`UPDATE users SET mfa_enabled = TRUE, updated_at = NOW() WHERE id = $1`, [userId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * STORY-003: checks a code against the person's verified device. A try is counted first, and a code is accepted once: its
 * time step is recorded, and the same code (or an earlier one) is refused afterwards (RFC 6238 section 5.2).
 */
async function checkCode(userId: string, totpCode: string, budget: string): Promise<void> {
  const attempt = await reserveAttempt(budget, userId);

  const device = (
    await pool.query(`SELECT id, secret_key, last_used_step FROM mfa_devices WHERE user_id = $1 AND verified = TRUE`, [userId])
  ).rows[0];
  if (!device) throw new UnauthorizedError('Two-step verification is not on for this account. Please sign in again.');

  const step = matchTotp(device.secret_key, totpCode);
  if (step === null) throw refusal(attempt, 'INVALID_CODE');

  // One statement decides, so two requests carrying the same code cannot both pass
  const accepted = await pool.query(
    `UPDATE mfa_devices SET last_used_step = $2, updated_at = NOW()
     WHERE id = $1 AND (last_used_step IS NULL OR last_used_step < $2) RETURNING id`,
    [device.id, step]
  );
  if (accepted.rows.length === 0) throw refusal(attempt, 'CODE_ALREADY_USED');
}

// Verify TOTP code for someone already signed in (turning two-step verification off). Throws if it is not accepted.
export async function verifyMFACode(userId: string, totpCode: string, budget: string): Promise<void> {
  await checkCode(userId, totpCode, budget);
}

/** The second step of sign-in: the code for this pending sign-in. Returns the person, to be given a session. */
export async function verifySignInCode(pending: PendingClaims, totpCode: string): Promise<SignInUser> {
  const row = (await pool.query(`SELECT id, email, full_name, role, created_at FROM users WHERE id = $1`, [pending.sub])).rows[0];
  if (!row) throw new UnauthorizedError('Please sign in again.');

  const budget = `sign-in:${pending.jti}`;
  await checkCode(row.id, totpCode, budget);
  // A pending sign-in ends at its first accepted code. One statement decides, so two requests carrying different right
  // codes (this step's and the next) cannot both turn the same password step into a session.
  const finished = await pool.query(
    `UPDATE mfa_code_attempts SET completed_at = NOW() WHERE budget = $1 AND completed_at IS NULL RETURNING budget`,
    [budget]
  );
  if (finished.rows.length === 0) throw new UnauthorizedError(SIGN_IN_FINISHED);
  return { id: row.id, email: row.email, fullName: row.full_name, createdAt: row.created_at, role: row.role };
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

  return result.rows[0].mfa_enabled === true;
}

// Disable MFA. The caller has checked a current code first (verifyMFACode).
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

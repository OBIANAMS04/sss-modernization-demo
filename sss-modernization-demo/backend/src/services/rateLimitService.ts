import { isIP } from 'node:net';
import pool from '../database/connection';
import { AppError } from '../utils/errors';

/**
 * STORY-041: throttling for sign-in and registration, so passwords cannot be guessed at speed and accounts cannot be created in bulk.
 * Counters live in the database (rate_limits), so the limits hold across instances and restarts. Each limit is a fixed window.
 *
 * - An account: 10 sign-in attempts in 15 minutes. Every attempt counts, before the password is checked, so attempts sent at the
 *   same moment are all counted; a successful sign-in clears it. Locking an account this way lets someone who knows an address
 *   delay its owner by 15 minutes; that is the usual trade against unlimited guessing, and every refusal is in the audit log.
 * - An address: 30 failed sign-ins in 15 minutes (failures only, so many people behind one office address can still sign in),
 *   and 10 registrations an hour.
 *
 * A caller on this machine (loopback) has no address limits: on Render every caller's address comes from Cloudflare and is never
 * loopback, and the local end-to-end suites and the load harness register hundreds of accounts from 127.0.0.1. A test reaches the
 * address limits by sending X-Forwarded-For, which the API trusts only from loopback (app.ts, trust proxy).
 */

export interface Limit {
  name: string;
  max: number;
  windowSeconds: number;
}

export const LIMITS = {
  accountSignIn: { name: 'sign-in:account', max: 10, windowSeconds: 15 * 60 },
  addressSignInFailures: { name: 'sign-in-failures:address', max: 30, windowSeconds: 15 * 60 },
  addressRegistration: { name: 'register:address', max: 10, windowSeconds: 60 * 60 },
} satisfies Record<string, Limit>;

export class RateLimitedError extends AppError {
  constructor(message: string, public retryAfterSeconds: number) {
    super(429, message, 'TOO_MANY_REQUESTS');
  }
}

/** True for this machine. A missing or unreadable address is not loopback; it has no address limit only because it cannot be keyed. */
export const isLoopback = (address: string | undefined): boolean => {
  const plain = address?.replace(/^::ffff:/, '');
  return !!plain && (plain === '::1' || (isIP(plain) === 4 && plain.startsWith('127.')));
};
const limitedAddress = (address: string | undefined): address is string => !!address && isIP(address.replace(/^::ffff:/, '')) !== 0 && !isLoopback(address);

const keyOf = (limit: Limit, subject: string) => `${limit.name}:${subject.toLowerCase()}`;

/** Counts one event against `limit` for `subject` and returns the count in the current window and the seconds the window has left. */
export async function count(limit: Limit, subject: string): Promise<{ count: number; retryAfterSeconds: number }> {
  const result = await pool.query(
    `INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, NOW())
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= NOW() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= NOW() - make_interval(secs => $2) THEN NOW() ELSE rate_limits.window_start END
     RETURNING count, GREATEST(1, CEIL($2 - EXTRACT(EPOCH FROM (NOW() - window_start))))::int AS retry_after`,
    [keyOf(limit, subject), limit.windowSeconds]
  );
  const row = result.rows[0];
  // Now and then, drop the windows that ended long ago (no window is longer than an hour)
  if (Math.random() < 0.01) await pool.query(`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'`);
  return { count: row.count, retryAfterSeconds: row.retry_after };
}

/** Whether `subject` has already used up `limit` in the current window (counts nothing). */
export async function exhausted(limit: Limit, subject: string): Promise<{ exhausted: boolean; retryAfterSeconds: number }> {
  const row = (
    await pool.query(
      `SELECT count, GREATEST(1, CEIL($2 - EXTRACT(EPOCH FROM (NOW() - window_start))))::int AS retry_after
       FROM rate_limits WHERE key = $1 AND window_start > NOW() - make_interval(secs => $2)`,
      [keyOf(limit, subject), limit.windowSeconds]
    )
  ).rows[0];
  return { exhausted: !!row && row.count >= limit.max, retryAfterSeconds: row?.retry_after ?? 0 };
}

export async function clear(limit: Limit, subject: string): Promise<void> {
  await pool.query('DELETE FROM rate_limits WHERE key = $1', [keyOf(limit, subject)]);
}

const minutes = (seconds: number) => {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return `${m} minute${m === 1 ? '' : 's'}`;
};

/** Before a password is checked: refuses when the address has failed too often, then counts the attempt against the account. */
export async function beforeSignIn(email: string, address: string | undefined): Promise<void> {
  if (limitedAddress(address)) {
    const byAddress = await exhausted(LIMITS.addressSignInFailures, address);
    if (byAddress.exhausted) {
      throw new RateLimitedError(`Too many failed sign-ins from your network. Try again in ${minutes(byAddress.retryAfterSeconds)}.`, byAddress.retryAfterSeconds);
    }
  }
  const byAccount = await count(LIMITS.accountSignIn, email);
  if (byAccount.count > LIMITS.accountSignIn.max) {
    throw new RateLimitedError(`Too many sign-in attempts for this account. Try again in ${minutes(byAccount.retryAfterSeconds)}.`, byAccount.retryAfterSeconds);
  }
}

/** After a refused password: counts the failure against the address. */
export async function afterFailedSignIn(address: string | undefined): Promise<void> {
  if (limitedAddress(address)) await count(LIMITS.addressSignInFailures, address);
}

/** After a completed sign-in (the password, and the code when two-step verification is on): the account starts afresh. */
export async function afterSignIn(email: string): Promise<void> {
  await clear(LIMITS.accountSignIn, email);
}

/** Before a registration: counts it against the address and refuses past the limit. */
export async function beforeRegistration(address: string | undefined): Promise<void> {
  if (!limitedAddress(address)) return;
  const byAddress = await count(LIMITS.addressRegistration, address);
  if (byAddress.count > LIMITS.addressRegistration.max) {
    throw new RateLimitedError(`Too many new accounts from your network. Try again in ${minutes(byAddress.retryAfterSeconds)}.`, byAddress.retryAfterSeconds);
  }
}

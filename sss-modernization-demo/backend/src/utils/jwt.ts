import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError } from './errors';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '3600';

// STORY-011 (WCAG 2.2.1): a sign-in can be extended, but never past this long after the original sign-in.
export const MAX_SESSION_SECONDS = 12 * 60 * 60;

// STORY-003: how long a correct password is good for while the authentication code is entered.
export const PENDING_MFA_SECONDS = 5 * 60;
const PENDING_PURPOSE = 'mfa';

export interface JWTPayload {
  sub: string;
  email: string;
  /** Seconds since epoch of the original sign-in; an extended session keeps it. Absent on tokens issued before STORY-011. */
  auth_time?: number;
  /** STORY-003: set only on the pending token between password and code, never on a session. verifyToken refuses any token that has one. */
  purpose?: string;
  /** STORY-003: names one pending sign-in so its wrong codes can be counted. */
  jti?: string;
  iat: number;
  exp: number;
}

/** What a pending sign-in token proves: the password was right for this person, and which sign-in it is. */
export interface PendingClaims {
  sub: string;
  email: string;
  jti: string;
}

export function generateToken(userId: string, email: string, authTime?: number): string {
  // A bare numeric string (e.g. "3600") is parsed by jsonwebtoken as
  // milliseconds, not seconds — convert explicitly so JWT_EXPIRY=3600
  // means a 1-hour token, not a ~3.6-second one.
  const expiresIn = /^\d+$/.test(JWT_EXPIRY) ? parseInt(JWT_EXPIRY, 10) : JWT_EXPIRY;

  return jwt.sign(
    {
      sub: userId,
      email,
      auth_time: authTime ?? Math.floor(Date.now() / 1000),
    },
    JWT_SECRET as string,
    { expiresIn } as any
  );
}

/** The replacement token for an extended session: same sign-in time, never valid past MAX_SESSION_SECONDS after it. */
export function extendToken(userId: string, email: string, authTime: number): string {
  const token = generateToken(userId, email, authTime);
  const end = authTime + MAX_SESSION_SECONDS;
  if ((jwt.decode(token) as JWTPayload).exp <= end) return token;
  return jwt.sign({ sub: userId, email, auth_time: authTime }, JWT_SECRET, { expiresIn: Math.max(end - Math.floor(Date.now() / 1000), 1) });
}

/** Checks the signature and expiry. Throws a 401 AppError for any bad token (see verifyToken). */
function verifySigned(token: string, expiredMessage: string): JWTPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    const expired = error instanceof jwt.TokenExpiredError;
    throw new AppError(401, expired ? expiredMessage : 'Invalid or malformed token', 'UNAUTHORIZED');
  }
}

/**
 * Throws a 401 AppError for any bad token. jsonwebtoken's own errors are not AppErrors, so letting
 * them escape made every expired session a 500, and the frontend only sends users back to the
 * login page on a 401.
 *
 * STORY-003: this is the one place that accepts a session, so it is where a pending sign-in token
 * is refused. Every route guard, and /auth/refresh, goes through it.
 */
export function verifyToken(token: string): JWTPayload {
  const payload = verifySigned(token, 'Your session has expired. Please sign in again.');
  if (payload.purpose !== undefined) {
    throw new AppError(401, 'Sign-in is not finished. Enter your authentication code first.', 'UNAUTHORIZED');
  }
  return payload;
}

/**
 * STORY-003: what a correct password earns when the account has two-step verification. It is not a
 * session: it lasts five minutes, verifyToken refuses it, and it opens nothing but the code check
 * (POST /auth/mfa/verify). Its id lets that check count wrong codes per sign-in.
 */
export function generatePendingToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email, purpose: PENDING_PURPOSE }, JWT_SECRET, {
    expiresIn: PENDING_MFA_SECONDS,
    jwtid: randomUUID(),
  });
}

/** Throws a 401 AppError unless this is an unexpired pending sign-in token. A session token is not one. */
export function verifyPendingToken(token: string): PendingClaims {
  const payload = verifySigned(token, 'Your sign-in timed out. Please sign in again.');
  if (payload.purpose !== PENDING_PURPOSE || !payload.jti) {
    throw new AppError(401, 'Invalid or malformed token', 'UNAUTHORIZED');
  }
  return { sub: payload.sub, email: payload.email, jti: payload.jti };
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch {
    return null;
  }
}

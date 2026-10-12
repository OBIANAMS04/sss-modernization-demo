import jwt from 'jsonwebtoken';
import { AppError } from './errors';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '3600';

// STORY-011 (WCAG 2.2.1): a sign-in can be extended, but never past this long after the original sign-in.
export const MAX_SESSION_SECONDS = 12 * 60 * 60;

export interface JWTPayload {
  sub: string;
  email: string;
  /** Seconds since epoch of the original sign-in; an extended session keeps it. Absent on tokens issued before STORY-011. */
  auth_time?: number;
  iat: number;
  exp: number;
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

/**
 * Throws a 401 AppError for any bad token. jsonwebtoken's own errors are not AppErrors, so letting
 * them escape made every expired session a 500, and the frontend only sends users back to the
 * login page on a 401.
 */
export function verifyToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    const expired = error instanceof jwt.TokenExpiredError;
    throw new AppError(
      401,
      expired ? 'Your session has expired. Please sign in again.' : 'Invalid or malformed token',
      'UNAUTHORIZED'
    );
  }
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch {
    return null;
  }
}

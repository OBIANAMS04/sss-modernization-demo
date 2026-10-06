import jwt from 'jsonwebtoken';
import { AppError } from './errors';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '3600';

export interface JWTPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export function generateToken(userId: string, email: string): string {
  // A bare numeric string (e.g. "3600") is parsed by jsonwebtoken as
  // milliseconds, not seconds — convert explicitly so JWT_EXPIRY=3600
  // means a 1-hour token, not a ~3.6-second one.
  const expiresIn = /^\d+$/.test(JWT_EXPIRY) ? parseInt(JWT_EXPIRY, 10) : JWT_EXPIRY;

  return jwt.sign(
    {
      sub: userId,
      email,
    },
    JWT_SECRET as string,
    { expiresIn } as any
  );
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

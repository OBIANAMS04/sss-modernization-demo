import { Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errors';

/** Verifies the Bearer JWT and sets req.user = { sub, email }. */
export function authenticate(req: any, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing or invalid authorization header', 'UNAUTHORIZED');
    }
    req.user = verifyToken(authHeader.substring(7)) as any;
    next();
  } catch (error) {
    next(error);
  }
}

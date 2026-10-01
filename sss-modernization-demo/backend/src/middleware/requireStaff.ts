import { Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { getUserRole, isStaff } from '../services/roleService';

/**
 * Allows only case managers and admins. Must run after a JWT middleware has set req.user.
 * The role is read from the database on every request (not from the token), so removing
 * someone from CASE_MANAGER_EMAILS takes effect on the next restart without new tokens.
 */
export async function requireStaff(req: any, _res: Response, next: NextFunction) {
  try {
    const role = req.user?.sub ? await getUserRole(req.user.sub) : null;
    if (!isStaff(role)) {
      throw new AppError(403, 'Case manager access required', 'FORBIDDEN');
    }
    req.user.role = role;
    next();
  } catch (error) {
    next(error);
  }
}

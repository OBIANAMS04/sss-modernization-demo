import { Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { isStaff } from '../services/roleService';
import { getRequestRole } from '../services/requestRole';

/**
 * Allows only case managers and admins. Must run after a JWT middleware has set req.user.
 * The role is read from the database on every request (not from the token), so granting or
 * removing access in Staff Access takes effect on the person's next request, without new tokens.
 */
export async function requireStaff(req: any, _res: Response, next: NextFunction) {
  try {
    const role = req.user?.sub ? await getRequestRole(req) : null;
    if (!isStaff(role)) {
      throw new AppError(403, 'Case manager access required', 'FORBIDDEN');
    }
    req.user.role = role;
    next();
  } catch (error) {
    next(error);
  }
}

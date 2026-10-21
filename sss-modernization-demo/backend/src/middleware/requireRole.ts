import { Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { Role } from '../services/roleService';
import { getRequestRole } from '../services/requestRole';

const ROLE_NAMES: Record<Role, string> = { citizen: 'citizen', case_manager: 'case manager', leadership: 'leadership', admin: 'administrator' };

/**
 * STORY-013 to 015: allows only the listed roles, for the dashboards that case managers, leadership and admins each have.
 * Must run after a JWT middleware has set req.user. Like requireStaff, the role is read from the database on every
 * request (not from the token), so a change in Staff Access takes effect on the person's next request.
 */
export function requireRole(...roles: Role[]) {
  return async function requireRole(req: any, _res: Response, next: NextFunction) {
    try {
      const role = req.user?.sub ? await getRequestRole(req) : null;
      if (!role || !roles.includes(role)) {
        throw new AppError(403, `Access requires the ${roles.map((r) => ROLE_NAMES[r]).join(' or ')} role`, 'FORBIDDEN');
      }
      req.user.role = role;
      next();
    } catch (error) {
      next(error);
    }
  };
}

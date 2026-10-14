import { Router, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { authenticate } from '../middleware/authenticate';
import { requireStaff } from '../middleware/requireStaff';
import { grantStaffRole, listStaff, revokeStaffRole } from '../services/roleService';

const router = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(authenticate);

// Staff Access: roles are granted and removed here by an existing case manager or admin (never by registering), and every
// change is audited with who made it and why. A case manager works with case-manager access; an admin also with leadership
// and admin access (the service refuses the rest). requireStaff has read the caller's role from the database by now.
const actorFrom = (req: any) => ({ actorId: req.user.sub, actorEmail: req.user.email, actorRole: req.user.role });

// GET /staff - Everyone with a staff role: case managers, leadership and admins
router.get('/', requireStaff, async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json({ staff: await listStaff() });
  } catch (error) {
    next(error);
  }
});

// POST /staff/grant - Give a registered person a role: { email, role: case_manager | leadership | admin (default case_manager), reason }
router.post('/grant', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    const user = await grantStaffRole(actorFrom(req), req.body?.email, req.body?.role, req.body?.reason);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// POST /staff/:id/revoke - Take the person's staff role away again
router.post('/:id/revoke', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!UUID_PATTERN.test(req.params.id)) throw new AppError(404, 'No account has that id.', 'NOT_FOUND');
    const user = await revokeStaffRole(actorFrom(req), req.params.id, req.body?.reason);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

export default router;

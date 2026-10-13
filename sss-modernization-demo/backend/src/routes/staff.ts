import { Router, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { authenticate } from '../middleware/authenticate';
import { requireStaff } from '../middleware/requireStaff';
import { grantCaseManager, listStaff, revokeCaseManager } from '../services/roleService';

const router = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(authenticate);

// Staff Access: case-manager access is granted and removed here by an existing case manager (never by registering),
// and every change is audited with who made it and why.
const actorFrom = (req: any) => ({ actorId: req.user.sub, actorEmail: req.user.email });

// GET /staff - Everyone who can work cases
router.get('/', requireStaff, async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json({ staff: await listStaff() });
  } catch (error) {
    next(error);
  }
});

// POST /staff/grant - Give a registered person the case-manager role
router.post('/grant', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    const user = await grantCaseManager(actorFrom(req), req.body?.email, req.body?.reason);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// POST /staff/:id/revoke - Take the case-manager role away again
router.post('/:id/revoke', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!UUID_PATTERN.test(req.params.id)) throw new AppError(404, 'No account has that id.', 'NOT_FOUND');
    const user = await revokeCaseManager(actorFrom(req), req.params.id, req.body?.reason);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

export default router;

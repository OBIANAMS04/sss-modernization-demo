import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { getPolicyView, savePolicy } from '../services/policyService';

const router = Router();

router.use(authenticate);

// GET /policies - The policy engine, the version in force, every rule and route with its state, and the last 20 versions (admins only)
router.get('/', requireRole('admin'), async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getPolicyView());
  } catch (error) {
    next(error);
  }
});

// PUT /policies - { rules?: { [id]: boolean }, routes?: { [route]: roles[] }, reason }: saves a new version, which applies at once (admins only)
router.put('/', requireRole('admin'), async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await savePolicy({ id: req.user.sub, email: req.user.email }, req.body));
  } catch (error) {
    next(error);
  }
});

export default router;

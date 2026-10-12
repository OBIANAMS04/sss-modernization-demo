import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireStaff } from '../middleware/requireStaff';
import { getFreshnessDashboard, runProbe } from '../services/freshnessService';

const router = Router();

router.use(authenticate);

// GET /freshness/dashboard?hours=24 - Freshness per data type, slowest updates, alert
router.get('/dashboard', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getFreshnessDashboard(parseInt(req.query.hours, 10) || 24));
  } catch (error) {
    next(error);
  }
});

// POST /freshness/probe - Write a probe row and time how long until a separate read sees it
router.post('/probe', requireStaff, async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await runProbe());
  } catch (error) {
    next(error);
  }
});

export default router;

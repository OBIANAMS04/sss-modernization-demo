import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { getCitizenDashboard } from '../services/dashboardService';

const router = Router();

router.use(authenticate);

// GET /dashboards/citizen - The caller's own applications, eligibility, case history and notifications
router.get('/citizen', async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getCitizenDashboard(req.user.sub));
  } catch (error) {
    next(error);
  }
});

export default router;

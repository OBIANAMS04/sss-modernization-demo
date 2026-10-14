import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireStaff } from '../middleware/requireStaff';
import { getAdminDashboard, getCaseManagerDashboard, getCitizenDashboard, getLeadershipDashboard } from '../services/dashboardService';

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

// GET /dashboards/case-manager - The caller's open cases, what waits on them, the unassigned queue and what is overdue (STORY-013)
router.get('/case-manager', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getCaseManagerDashboard({ id: req.user.sub, email: req.user.email }));
  } catch (error) {
    next(error);
  }
});

// GET /dashboards/admin - All cases, team performance and system health (STORY-014)
router.get('/admin', requireRole('admin'), async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getAdminDashboard());
  } catch (error) {
    next(error);
  }
});

// GET /dashboards/leadership - Aggregates only: KPIs, trends, bottlenecks and team performance (STORY-015)
router.get('/leadership', requireRole('leadership', 'admin'), async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getLeadershipDashboard());
  } catch (error) {
    next(error);
  }
});

export default router;

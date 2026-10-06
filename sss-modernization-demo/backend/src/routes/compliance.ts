import { Router, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { authenticate } from '../middleware/authenticate';
import { requireStaff } from '../middleware/requireStaff';
import { getUserRole } from '../services/roleService';
import {
  COMPLIANCE_TARGET,
  DECISION_CONTROLS,
  getCaseCompliance,
  getDashboard,
  listReviews,
  queryChecks,
  resolveReview,
} from '../services/complianceService';

const router = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(authenticate);

// GET /compliance/matrix - The decision controls (reference data)
router.get('/matrix', (_req: any, res: Response) => {
  res.json({ target: COMPLIANCE_TARGET, controls: DECISION_CONTROLS });
});

// GET /compliance/dashboard?days=30 - Decisions, compliance rate vs target, failed controls, trend
router.get('/dashboard', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getDashboard(parseInt(req.query.days, 10) || 30));
  } catch (error) {
    next(error);
  }
});

// GET /compliance/decisions - Compliance audit log, filterable by date range, user, decision, control, result
router.get('/decisions', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { from, to, user, decision, controlId, result, page } = req.query;
    res.json(await queryChecks({ from, to, user, decision, controlId, result }, parseInt(page, 10) || 1));
  } catch (error) {
    next(error);
  }
});

// GET /compliance/cases/:caseId - Every decision on a case with its control results and reviews
router.get('/cases/:caseId', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!UUID_PATTERN.test(req.params.caseId)) throw new AppError(404, 'Case not found', 'NOT_FOUND');
    res.json(await getCaseCompliance(req.params.caseId));
  } catch (error) {
    next(error);
  }
});

// GET /compliance/reviews?status=Open|Resolved|all - Manual review queue
router.get('/reviews', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json({ reviews: await listReviews(req.query.status || 'Open') });
  } catch (error) {
    next(error);
  }
});

// POST /compliance/reviews/:id/resolve - { action: "accept" | "reopen", note }
router.post('/reviews/:id/resolve', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!UUID_PATTERN.test(req.params.id)) throw new AppError(404, 'Compliance review not found', 'NOT_FOUND');
    const actor = { id: req.user.sub, email: req.user.email, role: await getUserRole(req.user.sub) };
    res.json(await resolveReview(req.params.id, req.body.action, req.body.note, actor));
  } catch (error) {
    next(error);
  }
});

export default router;

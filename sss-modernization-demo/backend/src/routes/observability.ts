import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { getObservability } from '../observability/observabilityService';
import { checkSlos } from '../observability/sloService';
import { AuditAction, recordAudit } from '../services/auditService';

const router = Router();

router.use(authenticate);

// GET /observability - Service health, request and error rates, latency by route against the 2 s p95 target, recent server errors with their
// trace ids, AI calls, tokens and cost per day against the budget, the objectives, and the open alerts with their history (admin only, STORY-028)
router.get('/', requireRole('admin'), async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getObservability());
  } catch (error) {
    next(error);
  }
});

// POST /observability/evaluate - Checks every objective now instead of waiting for the next minute: opens alerts for breaches, closes the recovered ones (admin only, STORY-029)
router.post('/evaluate', requireRole('admin'), async (req: any, res: Response, next: NextFunction) => {
  try {
    const { results, changed } = await checkSlos();
    recordAudit(AuditAction.ADMIN_ACTION, 'observability', 'success', {
      actor: req.user.sub,
      actorEmail: req.user.email,
      details: { action: 'evaluate-objectives', opened: changed.opened, cleared: changed.cleared },
    });
    res.json({ results, opened: changed.opened, cleared: changed.cleared });
  } catch (error) {
    next(error);
  }
});

export default router;

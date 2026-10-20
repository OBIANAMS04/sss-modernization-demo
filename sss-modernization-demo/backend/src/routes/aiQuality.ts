import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireStaff } from '../middleware/requireStaff';
import { getFairnessView, getQualityView } from '../services/aiQualityService';
import { runCounterfactualSet } from '../services/counterfactualService';
import { markBaseline, runGoldenSet, startRun } from '../services/evalRunService';
import { RateLimitError } from '../utils/errors';

const router = Router();

router.use(authenticate);

// Once a run is stored, the alerts are checked against it (a missed threshold or a score far under the baseline opens one). Never fails a run.
const checkAlerts = async () => {
  await getQualityView().catch(() => {});
};

// GET /ai-quality - The daily quality signals of real AI answers with their drift, change markers, the latest evaluation run against the baseline, and the open alerts (staff only, STORY-021)
router.get('/', requireStaff, async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getQualityView());
  } catch (error) {
    next(error);
  }
});

// GET /ai-quality/fairness - The latest counterfactual run, and decision outcomes by age band and region with the four-fifths rule (staff only, STORY-025)
router.get('/fairness', requireStaff, async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getFairnessView());
  } catch (error) {
    next(error);
  }
});

// POST /ai-quality/evaluations - Starts the golden set on the server, through the same path as a real question. It calls the model, so it costs money: once an hour at most (admin only, STORY-021)
router.post('/evaluations', requireRole('admin'), async (req: any, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ run: await startRun('eval', { id: req.user.sub, email: req.user.email }, runGoldenSet, checkAlerts) });
  } catch (error) {
    if (error instanceof RateLimitError) res.set('Retry-After', String(error.retryAfterSeconds));
    next(error);
  }
});

// POST /ai-quality/fairness-runs - Starts the counterfactual question set on the server; calls the model, once an hour at most (admin only, STORY-025)
router.post('/fairness-runs', requireRole('admin'), async (req: any, res: Response, next: NextFunction) => {
  try {
    res.status(202).json({ run: await startRun('fairness', { id: req.user.sub, email: req.user.email }, runCounterfactualSet, checkAlerts) });
  } catch (error) {
    if (error instanceof RateLimitError) res.set('Retry-After', String(error.retryAfterSeconds));
    next(error);
  }
});

// POST /ai-quality/runs/:id/baseline - Marks a completed evaluation run as the baseline later runs are compared with (admin only, STORY-021)
router.post('/runs/:id/baseline', requireRole('admin'), async (req: any, res: Response, next: NextFunction) => {
  try {
    const run = await markBaseline(req.params.id, { id: req.user.sub, email: req.user.email });
    await checkAlerts();
    res.json({ run });
  } catch (error) {
    next(error);
  }
});

export default router;

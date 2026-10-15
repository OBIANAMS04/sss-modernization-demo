import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireStaff } from '../middleware/requireStaff';
import { askAssistant, getHistory, getQuality } from '../services/assistantService';
import { RateLimitError } from '../utils/errors';

const router = Router();

router.use(authenticate);

// POST /assistant/ask - { question }: the most relevant policy passages and, with AI on, an answer cited to them. Anyone signed in; 20 questions per hour each
router.post('/ask', async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await askAssistant({ id: req.user.sub, email: req.user.email }, req.body?.question));
  } catch (error) {
    if (error instanceof RateLimitError) res.set('Retry-After', String(error.retryAfterSeconds));
    next(error);
  }
});

// GET /assistant/history - The caller's own last 20 questions with their answers
router.get('/history', async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json({ history: await getHistory(req.user.sub) });
  } catch (error) {
    next(error);
  }
});

// GET /assistant/quality - Answers checked and answers that failed the grounding check over 7 and 30 days, against the 2% target (staff only)
router.get('/quality', requireStaff, async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getQuality());
  } catch (error) {
    next(error);
  }
});

export default router;

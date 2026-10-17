import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireStaff } from '../middleware/requireStaff';
import { askAssistant, getHistory, getQuality } from '../services/assistantService';
import { listReviews, reviewExchange, submitFeedback } from '../services/assistantReviewService';
import { getPassage } from '../services/policyCorpus';
import { NotFoundError, RateLimitError, ValidationError } from '../utils/errors';

const router = Router();

router.use(authenticate);

// POST /assistant/ask - { question }: the most relevant policy passages and, with AI on, an answer cited to them. Anyone signed in; 20 questions per hour each (STORY-018)
router.post('/ask', async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await askAssistant({ id: req.user.sub, email: req.user.email }, req.body?.question));
  } catch (error) {
    if (error instanceof RateLimitError) res.set('Retry-After', String(error.retryAfterSeconds));
    next(error);
  }
});

// GET /assistant/history - The caller's own last 20 questions with their answers (STORY-018), reviewed ones marked as reviewed (STORY-023)
router.get('/history', async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json({ history: await getHistory(req.user.sub) });
  } catch (error) {
    next(error);
  }
});

// GET /assistant/passages?id= - The text and title of one policy passage, to open a citation (STORY-019). Anyone signed in: the documents are the same for everyone
router.get('/passages', async (req: any, res: Response, next: NextFunction) => {
  try {
    const id = req.query.id;
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) throw new ValidationError('Give the id of a policy passage.');
    const passage = await getPassage(id);
    if (!passage) throw new NotFoundError('That policy passage does not exist.');
    res.json({ passage });
  } catch (error) {
    next(error);
  }
});

// GET /assistant/quality - Answers checked and answers that failed the grounding check over 7 and 30 days, against the 2% target (staff only, STORY-022)
router.get('/quality', requireStaff, async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getQuality());
  } catch (error) {
    next(error);
  }
});

// GET /assistant/reviews - Withheld and reported exchanges waiting for a case manager, oldest first, and the latest reviews (staff only, STORY-023)
router.get('/reviews', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await listReviews({ id: req.user.sub }));
  } catch (error) {
    next(error);
  }
});

// POST /assistant/reviews/:traceId - { outcome: approved | corrected | declined, answer?, note }: a review; the person is notified. Not of your own question (staff only, STORY-023)
router.post('/reviews/:traceId', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await reviewExchange({ id: req.user.sub, email: req.user.email }, req.params.traceId, req.body));
  } catch (error) {
    next(error);
  }
});

// POST /assistant/:traceId/feedback - { rating: helpful | not-helpful | problem, comment? } on the caller's own question; a problem goes to the review queue (STORY-019, 023)
router.post('/:traceId/feedback', async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await submitFeedback({ id: req.user.sub, email: req.user.email }, req.params.traceId, req.body));
  } catch (error) {
    next(error);
  }
});

export default router;

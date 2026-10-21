import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { getPipelineStatus } from '../services/dataPipelineService';

const router = Router();

router.use(authenticate);

// GET /data/pipeline-status - STORY-005: when the caller's records last changed, and how quickly changes become visible (green, yellow, red)
router.get('/pipeline-status', async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getPipelineStatus(req.user.sub));
  } catch (error) {
    next(error);
  }
});

export default router;

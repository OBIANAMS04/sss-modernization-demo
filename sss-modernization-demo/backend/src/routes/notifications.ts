import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { listNotifications, markRead, markAllRead } from '../services/notificationService';

const router = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(authenticate);

// GET /notifications - The caller's latest notifications and unread count
router.get('/', async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await listNotifications(req.user.sub, parseInt(req.query.limit, 10) || 20));
  } catch (error) {
    next(error);
  }
});

// POST /notifications/read-all
router.post('/read-all', async (req: any, res: Response, next: NextFunction) => {
  try {
    await markAllRead(req.user.sub);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// POST /notifications/:id/read
router.post('/:id/read', async (req: any, res: Response, next: NextFunction) => {
  try {
    if (UUID_PATTERN.test(req.params.id)) await markRead(req.user.sub, req.params.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;

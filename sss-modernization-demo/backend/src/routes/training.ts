import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { getRequestRole } from '../services/requestRole';
import { getTeamProgress, getTraining, submitAttempt } from '../services/trainingService';
import { AuditAction, recordAudit } from '../services/auditService';
import { AppError } from '../utils/errors';

// STORY-035: the staff training portal. Signed in, and the service refuses citizens (training is for staff and leadership);
// the team's progress is for administrators.
const router = Router();
router.use(authenticate);

const roleOf = async (req: any) => {
  const role = await getRequestRole(req);
  if (!role) throw new AppError(401, 'Your session has ended. Please sign in again.', 'UNAUTHORIZED');
  return role;
};

// GET /training - the caller's modules (without the answers) and where they stand
router.get('/', async (req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getTraining(req.user.sub, await roleOf(req)));
  } catch (error) {
    next(error);
  }
});

// GET /training/progress - administrators: everyone's required modules and passes
router.get('/progress', requireRole('admin'), async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getTeamProgress());
  } catch (error) {
    next(error);
  }
});

// POST /training/:moduleId/attempts - graded on the server, recorded and audited (the score, never the answers)
router.post('/:moduleId/attempts', async (req: any, res: Response, next: NextFunction) => {
  try {
    const result = await submitAttempt(req.user.sub, await roleOf(req), req.params.moduleId, req.body?.answers);
    recordAudit(AuditAction.TRAINING_ATTEMPT, 'training', result.passed ? 'success' : 'failure', {
      actor: req.user.sub,
      actorEmail: req.user.email,
      resourceId: result.moduleId,
      details: { module: result.moduleId, version: result.version, score: result.score, total: result.total, passed: result.passed },
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errors';
import {
  getExemptionsByUserId,
  runEligibilityCheck,
  getExemptionStats,
} from '../services/exemptionService';

const router = Router();

interface AuthRequest extends Request {
  user?: {
    sub: string;
    email: string;
  };
}

// Middleware to verify JWT token
function authMiddleware(req: any, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing or invalid authorization header', 'UNAUTHORIZED');
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    req.user = decoded as any;
    next();
  } catch (error) {
    next(error);
  }
}

// Apply auth middleware to all routes
router.use(authMiddleware);

// GET /exemptions - Get user's exemptions
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, 'User not found in token', 'UNAUTHORIZED');
    }

    const exemptions = await getExemptionsByUserId(userId);

    res.json({
      exemptions,
      total: exemptions.length,
      eligible: exemptions.some((e) => e.status !== 'Not Eligible'),
      determinedAt: exemptions[0]?.determinedAt ?? null,
    });
  } catch (error) {
    next(error);
  }
});

// POST /exemptions/check - Manually trigger exemption check
router.post('/check', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, 'User not found in token', 'UNAUTHORIZED');
    }

    const eligibility = await runEligibilityCheck(userId, 'manual', req.user?.email);

    res.json(eligibility);
  } catch (error) {
    next(error);
  }
});

// GET /exemptions/stats - Get aggregated exemption stats (admin only)
router.get('/stats', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // In production, would check for admin role
    const stats = await getExemptionStats();

    res.json({
      total: stats.total,
      byType: stats.byType,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

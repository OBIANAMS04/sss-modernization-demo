import { Router, Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errors';
import {
  getExemptionsByUserId,
  checkAndCreateExemptions,
  getExemptionStats,
} from '../services/exemptionService';
import { getUserById } from '../services/userService';

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

    const user = await getUserById(userId);

    // Prepare user data for eligibility check
    const userInfo = {
      id: user.id,
      dob: user.dob,
      phone: user.phone,
      address: user.address,
      // In production, would load income and hardship status from database
      income: undefined,
      hasDocumentedHardship: false,
    };

    const eligibility = await checkAndCreateExemptions(userId, userInfo);

    res.json({
      eligible: eligibility.eligible,
      exemptions: eligibility.exemptions,
      determinedAt: eligibility.determinedAt,
    });
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

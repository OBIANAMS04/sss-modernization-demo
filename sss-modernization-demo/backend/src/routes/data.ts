import { Router, Request, Response, NextFunction } from 'express';
import { dataPipeline, DataFreshness } from '../services/dataPipelineService';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errors';

const router = Router();

interface AuthRequest extends Request {
  user?: {
    sub: string;
    email: string;
  };
}

// Middleware to verify JWT token (optional for health check)
function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      req.user = decoded as any;
    }
    next();
  } catch (error) {
    // Optional auth - continue without user
    next();
  }
}

router.use(optionalAuthMiddleware);

// GET /data/pipeline-status - Get data freshness status
router.get('/pipeline-status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.query.userId as string;

    // If user is authenticated, use their ID; otherwise use provided ID
    const targetUserId = userId || req.user?.sub;

    if (!targetUserId) {
      // Return generic status if no user specified
      const genericStatus: DataFreshness = {
        lastRefresh: new Date().toISOString(),
        dataAge: 0,
        freshness: 'fresh',
        cachedAt: new Date().toISOString(),
      };
      return res.json(genericStatus);
    }

    // Get freshness status for the user
    const freshness = await dataPipeline.getDataFreshness(targetUserId);

    res.json(freshness);
  } catch (error) {
    next(error);
  }
});

// GET /data/metrics - Get pipeline metrics
router.get('/metrics', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.query.userId as string;
    const startTime = req.query.startTime ? new Date(req.query.startTime as string) : undefined;
    const endTime = req.query.endTime ? new Date(req.query.endTime as string) : undefined;

    // Only authenticated users can get metrics
    if (!req.user?.sub) {
      throw new AppError(401, 'Authentication required to access metrics', 'UNAUTHORIZED');
    }

    // Users can only view their own metrics (unless admin)
    const targetUserId = userId || req.user.sub;
    if (targetUserId !== req.user.sub) {
      throw new AppError(403, 'Cannot access other user metrics', 'FORBIDDEN');
    }

    const metrics = await dataPipeline.getPipelineMetrics(targetUserId, startTime, endTime);

    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

// GET /data/freshness-check - Detailed freshness check
router.get('/freshness-check', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.sub) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const freshness = await dataPipeline.getDataFreshness(req.user.sub);

    // Add additional details
    res.json({
      ...freshness,
      slo: {
        target: 30000, // milliseconds
        met: freshness.dataAge < 30000,
      },
      indicators: {
        isGreen: freshness.freshness === 'fresh',
        isYellow: freshness.freshness === 'stale',
        isRed: freshness.freshness === 'very_stale',
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;

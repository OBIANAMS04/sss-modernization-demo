import { Router, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errors';
import {
  getLatencyStats,
  getAggregatedMetrics,
  checkSLOViolations,
  cleanupOldMetrics,
} from '../services/latencyService';

const router = Router();

interface AuthRequest {
  headers: any;
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

// GET /latency/stats - Get latency statistics for entity/operation
router.get('/stats', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { entityType, operation, hours = 1 } = req.query;

    if (!entityType || !operation) {
      throw new AppError(400, 'entityType and operation are required', 'VALIDATION_ERROR');
    }

    const stats = await getLatencyStats(entityType, operation, parseInt(hours));

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// GET /latency/metrics - Get aggregated latency metrics
router.get('/metrics', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { hours = 1 } = req.query;

    const metrics = await getAggregatedMetrics(parseInt(hours));

    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

// GET /latency/slo-violations - Check for SLO violations
router.get('/slo-violations', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { hours = 1 } = req.query;

    const alerts = await checkSLOViolations(parseInt(hours));

    res.json({
      hasViolations: alerts.length > 0,
      violations: alerts,
      sloTarget: '30 seconds',
      sloThreshold: '95% of operations',
      checkTime: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// POST /latency/cleanup - Manually cleanup old metrics (admin only)
router.post('/cleanup', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { daysToKeep = 7 } = req.body;

    const deleted = await cleanupOldMetrics(daysToKeep);

    res.json({
      deleted,
      daysKept: daysToKeep,
      message: `Deleted ${deleted} metrics older than ${daysToKeep} days`,
    });
  } catch (error) {
    next(error);
  }
});

// GET /latency/health - Health check (SLO status)
router.get('/health', async (_req: any, res: Response, next: NextFunction) => {
  try {
    const metrics = await getAggregatedMetrics(1); // Last hour
    const violations = await checkSLOViolations(1);

    const isHealthy = metrics.globalStats.globalSLORate >= 95 && violations.length === 0;

    res.status(isHealthy ? 200 : 503).json({
      healthy: isHealthy,
      status: isHealthy ? 'OK' : 'DEGRADED',
      sloRate: metrics.globalStats.globalSLORate,
      globalTarget: 95,
      totalOperations: metrics.globalStats.totalOperations,
      withinSLO: metrics.globalStats.operationsWithinSLO,
      violations: violations.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;

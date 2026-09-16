import { Router, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errors';
import {
  COMPLIANCE_MATRIX,
  getComplianceChecksByRequirement,
  getComplianceChecksByCase,
  getComplianceChecksByDateRange,
  getDashboardMetrics,
  performComplianceChecks,
  calculateComplianceMetrics,
} from '../services/complianceService';

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

// GET /compliance/matrix - Get compliance matrix definition
router.get('/matrix', async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json({
      matrix: COMPLIANCE_MATRIX,
      total: COMPLIANCE_MATRIX.length,
    });
  } catch (error) {
    next(error);
  }
});

// POST /compliance/check/case/:caseId - Perform compliance checks for case
router.post('/check/case/:caseId', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      throw new AppError(401, 'User not found in token', 'UNAUTHORIZED');
    }

    const checks = await performComplianceChecks(caseId, userId);

    res.status(201).json({
      caseId,
      checks,
      total: checks.length,
      passed: checks.filter((c) => c.passed).length,
      failed: checks.filter((c) => !c.passed).length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /compliance/checks/requirement/:requirementId - Get checks for requirement
router.get('/checks/requirement/:requirementId', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { requirementId } = req.params;
    const { limit = 50 } = req.query;

    const checks = await getComplianceChecksByRequirement(requirementId, parseInt(limit));

    res.json({
      requirementId,
      checks,
      total: checks.length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /compliance/checks/case/:caseId - Get checks for case
router.get('/checks/case/:caseId', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { caseId } = req.params;

    const checks = await getComplianceChecksByCase(caseId);

    res.json({
      caseId,
      checks,
      total: checks.length,
      passed: checks.filter((c) => c.passed).length,
      failed: checks.filter((c) => !c.passed).length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /compliance/audit - Get audit log with date range filtering
router.get('/audit', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, limit = 100 } = req.query;

    if (!startDate || !endDate) {
      throw new AppError(400, 'startDate and endDate are required', 'VALIDATION_ERROR');
    }

    const checks = await getComplianceChecksByDateRange(startDate, endDate, parseInt(limit));

    res.json({
      startDate,
      endDate,
      checks,
      total: checks.length,
      passed: checks.filter((c) => c.passed).length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /compliance/dashboard - Get compliance dashboard metrics
router.get('/dashboard', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { days = 7 } = req.query;

    const metrics = await getDashboardMetrics(parseInt(days));

    // Calculate aggregate stats
    const totalDecisions = metrics.reduce((sum, m) => sum + m.totalDecisions, 0);
    const compliantDecisions = metrics.reduce((sum, m) => sum + m.compliantDecisions, 0);
    const avgCompliance =
      metrics.length > 0
        ? Math.round((metrics.reduce((sum, m) => sum + m.complianceRate, 0) / metrics.length) * 100) / 100
        : 0;

    res.json({
      period: {
        days: parseInt(days),
        startDate: metrics[metrics.length - 1]?.date,
        endDate: metrics[0]?.date,
      },
      aggregates: {
        totalDecisions,
        compliantDecisions,
        averageComplianceRate: avgCompliance,
      },
      daily: metrics,
      alerts: metrics.flatMap((m) => m.alerts || []),
    });
  } catch (error) {
    next(error);
  }
});

// POST /compliance/recalculate/:dateStr - Manually recalculate for date
router.post('/recalculate/:dateStr', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { dateStr } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new AppError(400, 'Invalid date format. Use YYYY-MM-DD', 'VALIDATION_ERROR');
    }

    const metrics = await calculateComplianceMetrics(dateStr);

    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

export default router;

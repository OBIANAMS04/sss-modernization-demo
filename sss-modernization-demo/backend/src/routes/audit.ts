import { Router, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errors';
import {
  getAuditLogs,
  getAuditLogsByUser,
  getAuditLogsByResource,
  getAuditStats,
  AuditLogQuery,
} from '../services/auditService';

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

// GET /audit - Query audit logs with filters
router.get('/', async (req: any, res: Response, next: NextFunction) => {
  try {
    const {
      action,
      actor,
      resource,
      status,
      startDate,
      endDate,
      limit = 100,
      offset = 0,
    } = req.query;

    // Validate limit
    const parsedLimit = Math.min(parseInt(limit, 10) || 100, 1000);
    const parsedOffset = parseInt(offset, 10) || 0;

    const query: AuditLogQuery = {
      action,
      actor,
      resource,
      status,
      startDate,
      endDate,
      limit: parsedLimit,
      offset: parsedOffset,
    };

    const { logs, total } = await getAuditLogs(query);

    res.json({
      logs,
      total,
      limit: parsedLimit,
      offset: parsedOffset,
      page: Math.floor(parsedOffset / parsedLimit) + 1,
      pages: Math.ceil(total / parsedLimit),
    });
  } catch (error) {
    next(error);
  }
});

// GET /audit/user/:userId - Get audit logs for specific user
router.get('/user/:userId', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const { limit = 50 } = req.query;

    // Users can only view their own logs (unless admin)
    const requestingUserId = req.user?.sub;
    if (requestingUserId !== userId) {
      // In production, would check for admin role
      throw new AppError(403, 'Access denied', 'FORBIDDEN');
    }

    const logs = await getAuditLogsByUser(userId, parseInt(limit));

    res.json({
      userId,
      logs,
      total: logs.length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /audit/resource/:resource/:resourceId - Get audit trail for resource
router.get('/resource/:resource/:resourceId', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { resource, resourceId } = req.params;
    const { limit = 100 } = req.query;

    const logs = await getAuditLogsByResource(resource, resourceId, parseInt(limit));

    res.json({
      resource,
      resourceId,
      logs,
      total: logs.length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /audit/stats - Get audit statistics (admin only)
router.get('/stats', async (_req: any, res: Response, next: NextFunction) => {
  try {
    // In production, would check for admin role
    const stats = await getAuditStats();

    res.json({
      ...stats,
      retention: '7 years',
      immutable: true,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;

import { Router, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errors';
import { requireStaff } from '../middleware/requireStaff';
import { getUserRole, isStaff } from '../services/roleService';
import {
  getAuditLogs,
  getAuditLogsByUser,
  getAuditLogsByResource,
  getAuditStats,
  auditLogIsWriteOnce,
  AuditLogQuery,
} from '../services/auditService';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
router.get('/', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    const {
      action,
      actor,
      user,
      resource,
      resourceId,
      status,
      startDate,
      endDate,
      limit = 100,
      offset = 0,
    } = req.query;

    for (const [name, value] of [['startDate', startDate], ['endDate', endDate]]) {
      if (value && !DATE.test(value)) throw new AppError(400, `${name} must be a date as YYYY-MM-DD`, 'VALIDATION_ERROR');
    }
    if (status && status !== 'success' && status !== 'failure') {
      throw new AppError(400, 'status must be success or failure', 'VALIDATION_ERROR');
    }

    // Validate limit
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const query: AuditLogQuery = {
      action: action || undefined,
      actor: actor || undefined,
      user: user || undefined,
      resource: resource || undefined,
      resourceId: resourceId || undefined,
      status: status || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
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

    // Users can only view their own logs (staff can view anyone's)
    const requestingUserId = req.user?.sub;
    if (requestingUserId !== userId && !isStaff(await getUserRole(requestingUserId))) {
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
router.get('/resource/:resource/:resourceId', requireStaff, async (req: any, res: Response, next: NextFunction) => {
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
router.get('/stats', requireStaff, async (_req: any, res: Response, next: NextFunction) => {
  try {
    const [stats, writeOnce] = await Promise.all([getAuditStats(), auditLogIsWriteOnce()]);

    res.json({
      ...stats,
      // Both are facts about the database, not labels: every entry carries retain_until (7 years
      // after it was written), and the triggers that refuse updates and deletes are checked here.
      retention: '7 years',
      immutable: writeOnce,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;

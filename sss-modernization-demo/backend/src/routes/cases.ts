import { Router, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errors';
import { requireStaff } from '../middleware/requireStaff';
import { getUserRole, isStaff } from '../services/roleService';
import pool from '../database/connection';
import {
  createCase,
  getCaseById,
  getCasesByUserId,
  getAllCases,
  updateCase,
  getCaseNotes,
  addCaseDocument,
  getCaseDocuments,
  getCaseStats,
} from '../services/caseService';

const router = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Loads the case and allows only its owner or staff. */
async function loadAccessibleCase(req: any, caseId: string) {
  if (!UUID_PATTERN.test(caseId)) {
    throw new AppError(404, 'Case not found', 'NOT_FOUND');
  }
  const caseData = await getCaseById(caseId);
  if (caseData.userId !== req.user?.sub && !isStaff(await getUserRole(req.user?.sub))) {
    throw new AppError(403, 'Access denied', 'FORBIDDEN');
  }
  return caseData;
}

// POST /cases - Create a case for one of the caller's own exemptions
router.post('/', async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, 'User not found in token', 'UNAUTHORIZED');
    }

    const { exemptionId } = req.body;
    if (exemptionId) {
      const owned = await pool.query('SELECT 1 FROM exemptions WHERE id = $1 AND user_id = $2', [exemptionId, userId]);
      if (owned.rows.length === 0) {
        throw new AppError(403, 'You can only open a case for your own exemption', 'FORBIDDEN');
      }
    }

    const caseData = await createCase({ userId, exemptionId });
    res.status(201).json(caseData);
  } catch (error) {
    next(error);
  }
});

// GET /cases/stats - Case statistics (staff only). Declared before /:id so it is reachable.
router.get('/stats', requireStaff, async (_req: any, res: Response, next: NextFunction) => {
  try {
    const stats = await getCaseStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// GET /cases - The caller's own cases, or all cases (filtered) for staff
router.get('/', async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, 'User not found in token', 'UNAUTHORIZED');
    }

    const { page = 1, limit = 10, status, assignedTo, scope } = req.query;

    if (scope === 'all' || status || assignedTo) {
      if (!isStaff(await getUserRole(userId))) {
        throw new AppError(403, 'Case manager access required', 'FORBIDDEN');
      }
      const result = await getAllCases({ status, assignedTo }, parseInt(page), parseInt(limit));
      res.json(result);
    } else {
      const result = await getCasesByUserId(userId, parseInt(page), parseInt(limit));
      res.json(result);
    }
  } catch (error) {
    next(error);
  }
});

// GET /cases/:id - Case details (owner or staff)
router.get('/:id', async (req: any, res: Response, next: NextFunction) => {
  try {
    const caseData = await loadAccessibleCase(req, req.params.id);
    res.json(caseData);
  } catch (error) {
    next(error);
  }
});

// PUT /cases/:id - Update status / assignment / note (staff only)
router.put('/:id', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status, assignedTo, notes } = req.body;

    const caseData = await updateCase(id, { status, assignedTo, notes });
    res.json(caseData);
  } catch (error) {
    next(error);
  }
});

// GET /cases/:id/notes - Case notes (owner or staff)
router.get('/:id/notes', async (req: any, res: Response, next: NextFunction) => {
  try {
    await loadAccessibleCase(req, req.params.id);
    const notes = await getCaseNotes(req.params.id);
    res.json({ notes });
  } catch (error) {
    next(error);
  }
});

// POST /cases/:id/documents - Attach a document (owner or staff)
router.post('/:id/documents', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { documentType, documentUrl } = req.body;

    if (!documentType || !documentUrl) {
      throw new AppError(400, 'documentType and documentUrl are required', 'VALIDATION_ERROR');
    }

    await loadAccessibleCase(req, id);
    const doc = await addCaseDocument(id, documentType, documentUrl, req.user?.email || 'unknown');

    res.status(201).json(doc);
  } catch (error) {
    next(error);
  }
});

// GET /cases/:id/documents - Case documents (owner or staff)
router.get('/:id/documents', async (req: any, res: Response, next: NextFunction) => {
  try {
    await loadAccessibleCase(req, req.params.id);
    const documents = await getCaseDocuments(req.params.id);
    res.json({ documents });
  } catch (error) {
    next(error);
  }
});

export default router;

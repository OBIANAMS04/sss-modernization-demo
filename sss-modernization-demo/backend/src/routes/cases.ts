import { Router, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errors';
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

// POST /cases - Create new case
router.post('/', async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, 'User not found in token', 'UNAUTHORIZED');
    }

    const { exemptionId } = req.body;

    const caseData = await createCase({
      userId,
      exemptionId,
    });

    res.status(201).json(caseData);
  } catch (error) {
    next(error);
  }
});

// GET /cases - Get cases (user or admin view)
router.get('/', async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, 'User not found in token', 'UNAUTHORIZED');
    }

    const { page = 1, limit = 10, status, assignedTo } = req.query;

    // If admin filter params provided, return all cases
    if (status || assignedTo) {
      const result = await getAllCases({ status, assignedTo }, parseInt(page), parseInt(limit));
      res.json(result);
    } else {
      // Otherwise return user's cases
      const result = await getCasesByUserId(userId, parseInt(page), parseInt(limit));
      res.json(result);
    }
  } catch (error) {
    next(error);
  }
});

// GET /cases/:id - Get case details
router.get('/:id', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const caseData = await getCaseById(id);

    // Verify user owns case or is admin
    const userId = req.user?.sub;
    if (caseData.userId !== userId) {
      // In production, would check for admin role
      throw new AppError(403, 'Access denied', 'FORBIDDEN');
    }

    res.json(caseData);
  } catch (error) {
    next(error);
  }
});

// PUT /cases/:id - Update case
router.put('/:id', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status, assignedTo, notes } = req.body;

    const caseData = await updateCase(id, { status, assignedTo, notes });
    res.json(caseData);
  } catch (error) {
    next(error);
  }
});

// GET /cases/:id/notes - Get case notes
router.get('/:id/notes', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const notes = await getCaseNotes(id);
    res.json({ notes });
  } catch (error) {
    next(error);
  }
});

// POST /cases/:id/documents - Upload case document
router.post('/:id/documents', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { documentType, documentUrl } = req.body;

    if (!documentType || !documentUrl) {
      throw new AppError(400, 'documentType and documentUrl are required', 'VALIDATION_ERROR');
    }

    const caseManagerEmail = req.user?.email || 'unknown';
    const doc = await addCaseDocument(id, documentType, documentUrl, caseManagerEmail);

    res.status(201).json(doc);
  } catch (error) {
    next(error);
  }
});

// GET /cases/:id/documents - Get case documents
router.get('/:id/documents', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const documents = await getCaseDocuments(id);
    res.json({ documents });
  } catch (error) {
    next(error);
  }
});

// GET /cases/stats - Get case statistics (admin only)
router.get('/stats', async (_req: any, res: Response, next: NextFunction) => {
  try {
    const stats = await getCaseStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

export default router;

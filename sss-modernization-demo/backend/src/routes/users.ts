import { Router, Request, Response, NextFunction } from 'express';
import { getUserById, updateUserProfile } from '../services/userService';
import { runEligibilityCheck } from '../services/exemptionService';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/errors';

const router = Router();

interface AuthRequest extends Request {
  user?: {
    sub: string;
    email: string;
  };
}

// Middleware to verify JWT token
function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
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

// GET /users/:id - Get user profile
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify user is accessing their own profile or is admin
    if (req.user?.sub !== id) {
      throw new AppError(403, 'Access denied', 'FORBIDDEN');
    }

    const user = await getUserById(id);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

// PUT /users/:id - Update user profile
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { phone, address, annualIncome, hasDocumentedHardship } = req.body;

    // Verify user is updating their own profile
    if (req.user?.sub !== id) {
      throw new AppError(403, 'Access denied', 'FORBIDDEN');
    }

    const updatedUser = await updateUserProfile(id, { phone, address, annualIncome, hasDocumentedHardship });

    // STORY-006: exemption eligibility is re-determined whenever the profile changes
    const eligibility = await runEligibilityCheck(id, 'profile_update', req.user?.email);

    res.json({ ...updatedUser, eligibility });
  } catch (error) {
    next(error);
  }
});

export default router;

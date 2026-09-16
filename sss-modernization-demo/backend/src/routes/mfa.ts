import { Router, Request, Response, NextFunction } from 'express';
import {
  generateMFASecret,
  verifyAndEnableMFA,
  verifyMFACode,
  isMFAEnabled,
} from '../services/mfaService';
import { verifyToken } from '../utils/jwt';
import { AppError, ValidationError } from '../utils/errors';

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

// POST /mfa/setup - Generate MFA secret and QR code
router.post('/setup', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.sub || !req.user?.email) {
      throw new AppError(401, 'User not authenticated', 'UNAUTHORIZED');
    }

    const { secret, qrCode } = await generateMFASecret(req.user.sub, req.user.email);

    res.json({
      secret,
      qrCode,
      message: 'Scan this QR code with your authenticator app and enter the 6-digit code to verify',
    });
  } catch (error) {
    next(error);
  }
});

// POST /mfa/verify - Verify TOTP code and enable MFA
router.post('/verify', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.sub) {
      throw new AppError(401, 'User not authenticated', 'UNAUTHORIZED');
    }

    const { secret, totpCode } = req.body;

    if (!secret || !totpCode) {
      throw new ValidationError('Secret and TOTP code are required');
    }

    if (!/^\d{6}$/.test(totpCode)) {
      throw new ValidationError('TOTP code must be 6 digits');
    }

    await verifyAndEnableMFA(req.user.sub, secret, totpCode);

    res.json({
      success: true,
      message: 'MFA has been enabled on your account',
    });
  } catch (error) {
    next(error);
  }
});

// POST /mfa/verify-code - Verify TOTP during login
router.post('/verify-code', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.sub) {
      throw new AppError(401, 'User not authenticated', 'UNAUTHORIZED');
    }

    const { totpCode } = req.body;

    if (!totpCode) {
      throw new ValidationError('TOTP code is required');
    }

    if (!/^\d{6}$/.test(totpCode)) {
      throw new ValidationError('TOTP code must be 6 digits');
    }

    const isValid = await verifyMFACode(req.user.sub, totpCode);

    if (!isValid) {
      throw new ValidationError('Invalid authentication code');
    }

    res.json({
      success: true,
      message: 'MFA code verified',
    });
  } catch (error) {
    next(error);
  }
});

// GET /mfa/status - Get MFA status
router.get('/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.sub) {
      throw new AppError(401, 'User not authenticated', 'UNAUTHORIZED');
    }

    const enabled = await isMFAEnabled(req.user.sub);

    res.json({
      mfaEnabled: enabled,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

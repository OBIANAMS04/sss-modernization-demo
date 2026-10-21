import { Router, Request, Response, NextFunction } from 'express';
import {
  CodeRefusedError,
  disableMFA,
  generateMFASecret,
  verifyAndEnableMFA,
  verifyMFACode,
  isMFAEnabled,
  recoveryCodesLeft,
  regenerateRecoveryCodes,
} from '../services/mfaService';
import { verifyToken } from '../utils/jwt';
import { AppError, ConflictError, ValidationError } from '../utils/errors';
import { AuditAction, recordAudit } from '../services/auditService';

// STORY-010: MFA setup, enabling and every failed code are audited; codes and secrets never are.
const audit = (req: AuthRequest, action: AuditAction, status: 'success' | 'failure', details?: Record<string, unknown>) =>
  recordAudit(action, 'mfa', status, { actor: req.user?.sub, actorEmail: req.user?.email, resourceId: req.user?.sub, details });
// STORY-003: only a code that was actually checked is a failed verification. The reason and the try number are
// recorded, never the code; a malformed one (not 6 digits) never reached a check.
const failedCode = (req: AuthRequest, error: unknown, via: string) => {
  if (error instanceof CodeRefusedError) {
    audit(req, AuditAction.MFA_VERIFY_FAILED, 'failure', { via, reason: error.code, attempt: error.attempt });
  }
};

const router = Router();

interface AuthRequest extends Request {
  user?: {
    sub: string;
    email: string;
    auth_time?: number;
    iat?: number;
  };
}

// STORY-003: a signed-in session gets the same five wrong codes as a pending sign-in, counted across setup and turning
// MFA off. Extending the session keeps its sign-in time, so it keeps the count; signing in again starts a new one.
const attemptsOf = (req: AuthRequest) => `session:${req.user!.sub}:${req.user!.auth_time ?? req.user!.iat}`;

function codeFrom(body: any): string {
  const { totpCode } = body ?? {};
  if (!totpCode) {
    throw new ValidationError('TOTP code is required');
  }
  if (typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)) {
    throw new ValidationError('TOTP code must be 6 digits');
  }
  return totpCode;
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

    const { secret, otpauthUrl, qrCode } = await generateMFASecret(req.user.sub, req.user.email);
    audit(req, AuditAction.MFA_SETUP, 'success');

    // STORY-003: the one response that carries the key; keep it out of every cache
    res.set('Cache-Control', 'no-store');
    res.json({
      secret,
      otpauthUrl,
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

    // STORY-003: the key is the one stored at setup; a key sent with the request is not used
    const recoveryCodes = await verifyAndEnableMFA(req.user.sub, codeFrom(req.body), attemptsOf(req));
    audit(req, AuditAction.MFA_ENABLE, 'success');
    audit(req, AuditAction.MFA_RECOVERY_CODES_CREATED, 'success', { count: recoveryCodes.length, via: 'setup' });

    // STORY-041: the recovery codes are in this response only; keep it out of every cache
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      message: 'MFA has been enabled on your account',
      recoveryCodes,
    });
  } catch (error) {
    failedCode(req, error, 'setup');
    next(error);
  }
});

// POST /mfa/disable - STORY-003: turn MFA off. It needs a current code, so a stolen session alone cannot do it.
// (The sign-in code check is POST /auth/mfa/verify: it has a pending token, not a session, so it cannot live behind this guard.)
router.post('/disable', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.sub) {
      throw new AppError(401, 'User not authenticated', 'UNAUTHORIZED');
    }

    if (!(await isMFAEnabled(req.user.sub))) {
      throw new ConflictError('Two-step verification is not on.');
    }

    await verifyMFACode(req.user.sub, codeFrom(req.body), attemptsOf(req));
    await disableMFA(req.user.sub);
    audit(req, AuditAction.MFA_DISABLE, 'success');

    res.json({
      success: true,
      message: 'MFA has been turned off for your account',
    });
  } catch (error) {
    failedCode(req, error, 'disable');
    next(error);
  }
});

// POST /mfa/recovery-codes - STORY-041: new recovery codes after a current 6-digit code; the old ones stop working. Shown once.
router.post('/recovery-codes', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.sub) {
      throw new AppError(401, 'User not authenticated', 'UNAUTHORIZED');
    }
    const recoveryCodes = await regenerateRecoveryCodes(req.user.sub, codeFrom(req.body), attemptsOf(req));
    audit(req, AuditAction.MFA_RECOVERY_CODES_CREATED, 'success', { count: recoveryCodes.length, via: 'request' });
    res.set('Cache-Control', 'no-store');
    res.json({ recoveryCodes });
  } catch (error) {
    failedCode(req, error, 'recovery-codes');
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
      recoveryCodesLeft: enabled ? await recoveryCodesLeft(req.user.sub) : 0,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

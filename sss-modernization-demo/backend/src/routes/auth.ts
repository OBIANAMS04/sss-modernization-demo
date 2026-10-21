import { Router, Request, Response, NextFunction } from 'express';
import { registerUser, loginUser } from '../services/authService';
import { AuditAction, recordAudit } from '../services/auditService';
import { CodeRefusedError, verifySignInCode, verifySignInRecoveryCode } from '../services/mfaService';
import { BOOTSTRAP_VIA } from '../services/roleService';
import { authenticate } from '../middleware/authenticate';
import { extendToken, generateToken, MAX_SESSION_SECONDS, PendingClaims, PENDING_MFA_SECONDS, verifyPendingToken } from '../utils/jwt';
import { validateRegistrationInput } from '../utils/validators';
import { clientAddress } from '../utils/requestContext';
import { afterFailedSignIn, afterSignIn, beforeRegistration, beforeSignIn, RateLimitedError } from '../services/rateLimitService';
import { endSession } from '../services/sessionService';
import { ValidationError, AppError } from '../utils/errors';

const router = Router();

interface RegisterRequest extends Request {
  body: {
    email?: string;
    password?: string;
    fullName?: string;
    ssn?: string;
    dob?: string;
  };
}

interface LoginRequest extends Request {
  body: {
    email?: string;
    password?: string;
  };
}

// STORY-010: the address someone tried is recorded with a failed attempt; the password and SSN never are.
const attempted = (email?: string) => (typeof email === 'string' ? email.trim().toLowerCase().slice(0, 255) : null);
const reasonOf = (error: unknown) => (error instanceof AppError ? error.code : 'ERROR');

// POST /auth/register
router.post('/register', async (req: RegisterRequest, res: Response, next: NextFunction) => {
  try {
    const { email, password, fullName, ssn, dob } = req.body;
    // STORY-041: 10 new accounts an hour from one address, counted before anything else
    await beforeRegistration(clientAddress(req));

    // Validate input
    const validationErrors = validateRegistrationInput({
      email,
      password,
      fullName,
      ssn,
      dob,
    });

    if (validationErrors.length > 0) {
      const fieldErrors: Record<string, string> = {};
      validationErrors.forEach((err) => {
        fieldErrors[err.field] = err.message;
      });
      throw new ValidationError('Validation failed', fieldErrors);
    }

    // Register user
    const result = await registerUser({
      email: email!,
      password: password!,
      fullName: fullName!,
      ssn: ssn!,
      dob: dob!,
    });

    const actor = { actor: result.user.id, actorEmail: result.user.email };
    recordAudit(AuditAction.USER_REGISTRATION, 'auth', 'success', { ...actor, resourceId: result.user.id, details: { role: result.user.role } });
    if (result.user.role !== 'citizen') {
      recordAudit(AuditAction.PERMISSION_GRANT, 'users', 'success', {
        ...actor,
        resourceId: result.user.id,
        details: { email: result.user.email, role: result.user.role, via: BOOTSTRAP_VIA },
      });
    }

    res.status(201).json(result);
  } catch (error) {
    recordAudit(AuditAction.USER_REGISTRATION, 'auth', 'failure', { details: { email: attempted(req.body?.email), reason: reasonOf(error) } });
    next(error);
  }
});

// POST /auth/login
router.post('/login', async (req: LoginRequest, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }
    // STORY-041: found by the attack suite: objects in place of strings reached the throttle and the query and answered 500
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 255 || password.length > 1024) {
      throw new ValidationError('Invalid email or password');
    }

    // STORY-041: refused before the password is checked once the account or the address has had too many tries
    const address = clientAddress(req);
    await beforeSignIn(attempted(email)!, address);
    let result;
    try {
      result = await loginUser(email, password);
    } catch (error) {
      if (!(error instanceof RateLimitedError)) await afterFailedSignIn(address);
      throw error;
    }
    const actor = { actor: result.user.id, actorEmail: result.user.email, resourceId: result.user.id };
    if ('mfaRequired' in result) {
      // STORY-003: the password was right, but this is not a sign-in yet: no session and nothing about the person is returned
      recordAudit(AuditAction.MFA_CHALLENGE, 'mfa', 'success', { ...actor, details: { via: 'sign-in' } });
      return res.json({ mfaRequired: true, pendingToken: result.pendingToken, expiresIn: PENDING_MFA_SECONDS });
    }
    // The account's count starts afresh only when the sign-in is complete (with two-step verification, after the code)
    await afterSignIn(attempted(email)!);
    recordAudit(AuditAction.USER_LOGIN, 'auth', 'success', actor);
    res.json(result);
  } catch (error) {
    recordAudit(AuditAction.USER_LOGIN, 'auth', 'failure', { details: { email: attempted(req.body?.email), reason: reasonOf(error) } });
    next(error);
  }
});

// POST /auth/mfa/verify - STORY-003: the second step of sign-in. The pending token from the password step and the 6-digit
// code go in the body (there is no session yet); the session is issued only if the code is right, and is shaped like a login's.
router.post('/mfa/verify', async (req: Request, res: Response, next: NextFunction) => {
  let pending: PendingClaims | undefined;
  try {
    const { pendingToken, code, recoveryCode } = req.body ?? {};
    if (typeof pendingToken !== 'string' || !pendingToken) {
      throw new ValidationError('A sign-in token and a 6-digit code are required');
    }
    pending = verifyPendingToken(pendingToken);
    // STORY-041: a recovery code instead of the 6-digit code, for someone who has lost their authenticator. It spends the code.
    if (recoveryCode !== undefined) {
      const { user, left } = await verifySignInRecoveryCode(pending, recoveryCode);
      const actor = { actor: user.id, actorEmail: user.email, resourceId: user.id };
      recordAudit(AuditAction.MFA_RECOVERY_CODE_USED, 'mfa', 'success', { ...actor, details: { via: 'sign-in', recoveryCodesLeft: left } });
      recordAudit(AuditAction.USER_LOGIN, 'auth', 'success', { ...actor, details: { mfa: true, recoveryCode: true } });
      await afterSignIn(user.email.toLowerCase());
      return res.json({ user, token: generateToken(user.id, user.email), recoveryCodesLeft: left });
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      throw new ValidationError('Enter the 6-digit code from your authenticator app');
    }

    const user = await verifySignInCode(pending, code);
    const actor = { actor: user.id, actorEmail: user.email, resourceId: user.id };
    recordAudit(AuditAction.MFA_VERIFIED, 'mfa', 'success', { ...actor, details: { via: 'sign-in' } });
    recordAudit(AuditAction.USER_LOGIN, 'auth', 'success', { ...actor, details: { mfa: true } });
    await afterSignIn(user.email.toLowerCase());
    res.json({ user, token: generateToken(user.id, user.email) });
  } catch (error) {
    // Only a code that was actually checked is an MFA failure; the reason and try number are recorded, never the code
    if (pending && error instanceof CodeRefusedError) {
      recordAudit(AuditAction.MFA_VERIFY_FAILED, 'mfa', 'failure', {
        actor: pending.sub,
        actorEmail: pending.email,
        resourceId: pending.sub,
        details: { via: 'sign-in', reason: error.code, attempt: error.attempt },
      });
    }
    next(error);
  }
});

// POST /auth/logout - STORY-041: ends the session on the server, so every token of this sign-in (extended ones too) is refused from
// now on, and records the sign-out. A token issued before sessions had ids cannot be ended this way; it expires within the hour.
router.post('/logout', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    if (req.user.sid) await endSession(req.user.sid, req.user.sub, req.user.auth_time ?? req.user.iat);
    recordAudit(AuditAction.USER_LOGOUT, 'auth', 'success', {
      actor: req.user.sub,
      actorEmail: req.user.email,
      resourceId: req.user.sub,
      details: { sessionEnded: !!req.user.sid },
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// POST /auth/refresh - STORY-011 (WCAG 2.2.1): a person warned that their session is about to end can extend it.
// Every token carries the time of the original sign-in, so extending never keeps a session going past 12 hours.
router.post('/refresh', authenticate, (req: any, res: Response, next: NextFunction) => {
  const authTime = req.user.auth_time ?? req.user.iat; // tokens issued before this change have no auth_time
  if (Math.floor(Date.now() / 1000) - authTime > MAX_SESSION_SECONDS) {
    return next(new AppError(401, 'Your session has reached its maximum length. Please sign in again.', 'UNAUTHORIZED'));
  }
  recordAudit(AuditAction.SESSION_EXTEND, 'auth', 'success', { actor: req.user.sub, actorEmail: req.user.email, resourceId: req.user.sub });
  // The extended token keeps the session id, so signing out still ends it
  res.json({ token: extendToken(req.user.sub, req.user.email, authTime, req.user.sid) });
});

export default router;

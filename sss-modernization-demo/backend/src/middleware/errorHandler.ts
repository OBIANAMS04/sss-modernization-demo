import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { AuditAction, recordAudit } from '../services/auditService';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  if (err instanceof AppError) {
    // STORY-010: every refusal (no valid sign-in, or not allowed) is an audited security event
    if (err.statusCode === 401 || err.statusCode === 403) {
      const user = (req as any).user;
      const path = req.originalUrl.split('?')[0];
      recordAudit(AuditAction.ACCESS_DENIED, path.split('/')[2] || 'api', 'failure', {
        actor: user?.sub,
        actorEmail: user?.email,
        details: { method: req.method, path, status: err.statusCode, code: err.code },
      });
    }

    const response: any = {
      error: {
        message: err.message,
        code: err.code,
      },
    };

    return res.status(err.statusCode).json(response);
  }

  res.status(500).json({
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
  });
}

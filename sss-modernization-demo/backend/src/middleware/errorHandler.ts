import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { AuditAction, recordAudit } from '../services/auditService';
import { requestRoute } from '../observability/requestMetrics';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  // STORY-026: the route template, not the raw URL (record ids, query strings); the trace id is added to the line by the logger
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    route: requestRoute(req, res),
    method: req.method,
  });

  // STORY-026: what the request metrics keep about a server error: the class of the error and its code, never its message
  if (res.locals) res.locals.errorInfo = { name: err.name, code: typeof (err as any).code === 'string' ? (err as any).code : undefined };

  if (err instanceof AppError) {
    // STORY-010: every refusal (no valid sign-in, or not allowed) is an audited security event
    if (err.statusCode === 401 || err.statusCode === 403) {
      const user = (req as any).user;
      const path = req.originalUrl.split('?')[0];
      recordAudit(AuditAction.ACCESS_DENIED, path.split('/')[2] || 'api', 'failure', {
        actor: user?.sub,
        actorEmail: user?.email,
        // STORY-016: a refusal by the access policy also says which rule decided, why, and which version of the policy it was
        details: { method: req.method, path, status: err.statusCode, code: err.code, ...err.policy },
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

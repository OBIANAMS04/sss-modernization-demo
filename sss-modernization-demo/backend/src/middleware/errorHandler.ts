import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { AuditAction, recordAudit } from '../services/auditService';
import { requestRoute } from '../observability/requestMetrics';
import { RETRY_AFTER_SECONDS, isDatabaseUnavailable, isPoolExhaustion, markDatabaseDown, unavailableBody } from '../database/availability';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  // STORY-041: the body parser's own refusals (a body that is not JSON, or over the limit) are the caller's mistake, not a fault:
  // they were 500s, which also hid them among real errors
  const parserError = (err as { type?: unknown }).type;
  if (parserError === 'entity.parse.failed') err = new AppError(400, 'The request body is not valid JSON.', 'INVALID_JSON');
  else if (parserError === 'entity.too.large') err = new AppError(413, 'The request body is too large.', 'PAYLOAD_TOO_LARGE');
  else if (parserError === 'encoding.unsupported' || parserError === 'charset.unsupported') {
    err = new AppError(415, 'The request body uses an encoding the API does not accept.', 'UNSUPPORTED_ENCODING');
  }

  // STORY-034: a database that cannot be reached is not a bug in the request. It closes the data routes at once (the probe reopens them),
  // and the caller gets a 503 with a clear message and Retry-After instead of "Internal server error".
  if (!(err instanceof AppError) && isDatabaseUnavailable(err)) {
    // STORY-033: a request that waited for a free connection while the pool was full is overload; the database is not down
    const busy = isPoolExhaustion(err);
    if (!busy) markDatabaseDown(err);
    if (res.locals) res.locals.errorInfo = { name: err.name, code: typeof (err as any).code === 'string' ? (err as any).code : undefined };
    res.set('Retry-After', String(RETRY_AFTER_SECONDS));
    return res.status(503).json(unavailableBody(busy ? 'busy' : 'database'));
  }

  // STORY-026: the route template, not the raw URL (record ids, query strings); the trace id is added to the line by the logger. A refusal
  // or a bad request (an AppError under 500) is expected traffic: one warning line, no stack, so a log search or a Datadog monitor on
  // level "error" finds only real faults
  const route = requestRoute(req, res);
  if (err instanceof AppError && err.statusCode < 500) {
    console.warn('Request refused:', { status: err.statusCode, code: err.code, message: err.message, route, method: req.method });
  } else {
    console.error('Error:', { message: err.message, stack: err.stack, route, method: req.method });
  }

  // STORY-026: what the request metrics keep about a server error: the class of the error and its code, never its message
  if (res.locals) res.locals.errorInfo = { name: err.name, code: typeof (err as any).code === 'string' ? (err as any).code : undefined };

  if (err instanceof AppError) {
    // STORY-041: a throttled request says when it may be tried again
    const retryAfter = (err as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (err.statusCode === 429 && typeof retryAfter === 'number') res.set('Retry-After', String(retryAfter));
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

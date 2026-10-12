import { AsyncLocalStorage } from 'node:async_hooks';
import { Request, Response, NextFunction } from 'express';

/** Who is calling, kept for the life of a request so every audit entry can record it. */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  storage.run({ ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) }, next);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

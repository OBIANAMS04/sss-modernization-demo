import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';
import { Request, Response, NextFunction } from 'express';

/** Who is calling, kept for the life of a request so every audit entry can record it. */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * The visitor's own address. On Render every request reaches the API through Cloudflare, so req.ip is a
 * Cloudflare edge: the audit log showed several different edges for one visitor within seconds. Cloudflare
 * sets CF-Connecting-IP to the address that connected to it and replaces any value a client sends, so on
 * Render that header is used. Elsewhere (local runs) req.ip is the caller.
 */
export function clientAddress(req: Request): string | undefined {
  const viaCloudflare = process.env.RENDER ? req.get('cf-connecting-ip')?.trim() : undefined;
  return viaCloudflare && isIP(viaCloudflare) ? viaCloudflare : req.ip;
}

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  storage.run({ ip: clientAddress(req), userAgent: req.get('user-agent')?.slice(0, 300) }, next);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

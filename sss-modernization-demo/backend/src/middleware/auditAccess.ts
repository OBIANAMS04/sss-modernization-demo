import { Request, Response, NextFunction } from 'express';
import { AuditAction, recordAudit } from '../services/auditService';

/**
 * STORY-010: every successful read of the API is audited, named by the same route key as the
 * access table (e.g. "GET /api/cases/:id"), so a route added later is covered without anyone
 * remembering to log it. Reference data that holds nothing about a person is the only exception.
 */
export const UNAUDITED_READS = new Set(['GET /api/compliance/matrix']);
const EXPORTS = new Set(['GET /api/cases/export']);

export interface ReadEntry {
  key: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
}

/** The audit entry for a finished request, or null when it is not an audited read. */
export function readAuditEntry(
  method: string,
  baseUrl: string,
  routePath: string | undefined,
  params: Record<string, string>,
  status: number
): ReadEntry | null {
  if (method !== 'GET' || status >= 400 || routePath === undefined || !baseUrl.startsWith('/api/')) return null;
  const key = `GET ${baseUrl}${routePath === '/' ? '' : routePath}`;
  if (UNAUDITED_READS.has(key)) return null;
  return {
    key,
    action: EXPORTS.has(key) ? AuditAction.DATA_EXPORT : AuditAction.DATA_READ,
    resource: baseUrl.split('/')[2],
    resourceId: params.id ?? params.userId ?? params.caseId ?? params.resourceId,
  };
}

export function auditDataAccess(req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    const entry = readAuditEntry(req.method, req.baseUrl, req.route?.path, req.params || {}, res.statusCode);
    if (!entry) return;
    const user = (req as any).user;
    recordAudit(entry.action, entry.resource, 'success', {
      actor: user?.sub,
      actorEmail: user?.email,
      resourceId: entry.resourceId,
      details: { route: entry.key, query: req.query },
    });
  });
  next();
}

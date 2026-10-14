import { Express, NextFunction, Request, Response } from 'express';
import { PolicyRole } from '../security/accessPolicy';
import { listRoutes } from '../security/listRoutes';
import { loadResource } from '../services/policyResources';
import { PolicyDecision, decide, recordToLoad } from '../services/policyService';
import { getUserRole } from '../services/roleService';
import { AppError } from '../utils/errors';
import { verifyToken } from '../utils/jwt';

/** A route the app serves, with the pattern its path matches and the names of its path parameters. */
interface ServedRoute {
  key: string;
  method: string;
  pattern: RegExp;
  params: string[];
}

// Built on the first request, when every router is mounted (this middleware is mounted before them), in the order Express
// tries the routes, so the first match is the route that would serve the request.
const served = new WeakMap<object, ServedRoute[]>();

function compile(app: Express): ServedRoute[] {
  return listRoutes(app).map((route) => {
    const params: string[] = [];
    const source = route.path
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        params.push(segment.slice(1));
        return '([^/]+)';
      })
      .join('/');
    // Like Express by default: not case-sensitive, and a trailing slash is the same route
    return { key: route.key, method: route.method, pattern: new RegExp(`^${source}/?$`, 'i'), params };
  });
}

const decoded = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** The route that serves this request (its access-table key and path parameters), or null when none does (a 404, a preflight). */
function servedRoute(req: Request): { key: string; params: Record<string, string> } | null {
  let table = served.get(req.app);
  if (!table) {
    table = compile(req.app as Express);
    served.set(req.app, table);
  }
  const method = req.method === 'HEAD' ? 'GET' : req.method; // a GET route answers HEAD too
  for (const route of table) {
    const found = route.method === method ? route.pattern.exec(req.path) : null;
    if (found) return { key: route.key, params: Object.fromEntries(route.params.map((name, i) => [name, decoded(found[i + 1])])) };
  }
  return null;
}

interface Subject {
  id: string | null;
  role: PolicyRole;
  /** What verifyToken refused the token with, when the caller sent one that is no good. */
  tokenError?: AppError;
}

/**
 * Who is asking. No token, a token that is no good, and a token for someone who no longer exists are all anonymous. A signed-in
 * caller's role is read from the database on every request (not from the token), like requireStaff does, so a change in Staff
 * Access applies on the person's next request.
 */
async function subjectOf(req: any): Promise<Subject> {
  const header: string | undefined = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return { id: null, role: 'anonymous' };
  let claims;
  try {
    claims = verifyToken(header.substring(7));
  } catch (error) {
    return { id: null, role: 'anonymous', tokenError: error as AppError };
  }
  req.user = claims; // so a refusal names the person in the audit log
  const role = await getUserRole(claims.sub);
  return role ? { id: claims.sub, role } : { id: null, role: 'anonymous' };
}

/** The error that answers a refusal. It carries the policy's decision, which the error handler writes to the audit log. */
function refusal(subject: Subject, decision: PolicyDecision): AppError {
  const error =
    subject.role === 'anonymous'
      ? // The answer the sign-in check gives: a token that was refused keeps its own message (expired, sign-in not finished)
        subject.tokenError ?? new AppError(401, 'Missing or invalid authorization header', 'UNAUTHORIZED')
      : new AppError(403, `Access denied: ${decision.reason}`, 'POLICY_DENIED');
  error.policy = { rule: decision.rule, reason: decision.reason, policyVersion: decision.policyVersion };
  return error;
}

/**
 * STORY-016: asks the access policy (Open Policy Agent, policyService.ts) about every request before any router sees it. A request
 * that no route serves (a 404, a preflight) is left alone. A refusal goes to the error handler, which audits it.
 *
 * This is a first layer. The guards on each route (authenticate, requireStaff, requireRole) and the checks in the handlers stay,
 * so the policy can refuse what the code would allow and never allow what the code refuses.
 */
export async function enforcePolicy(req: any, _res: Response, next: NextFunction) {
  try {
    const route = servedRoute(req);
    if (!route) return next();

    const subject = await subjectOf(req);
    const record = await recordToLoad(route.key, subject.role);
    const decision = await decide({
      subject: { id: subject.id, role: subject.role },
      action: req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write',
      route: route.key,
      resource: record ? await loadResource(record.type, route.params[record.param]) : null,
    });
    if (decision.allow) return next();
    next(refusal(subject, decision));
  } catch (error) {
    next(error);
  }
}

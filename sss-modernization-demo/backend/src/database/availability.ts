import { NextFunction, Request, Response } from 'express';

/**
 * STORY-034 graceful degradation: whether the database can be used right now, and the 503 the API answers with when it cannot.
 *
 * On 2026-10-16 the database went away and the API exited at startup, so Render restarted it in a loop and every caller got a
 * proxy error. The API now starts and listens whatever the database is doing; this module is what the rest of the code asks.
 *
 * Two different things can stop a start, and they are kept apart on purpose:
 *   - the database cannot be reached (refused, timed out, restarting, not accepting connections, a connection dropped mid-way):
 *     NOT a fault in this release. The start waits and tries again with backoff (startup.ts), and the app serves normally once the
 *     database is back, with no restart.
 *   - the database answered and said no (a migration whose SQL fails, a policy or document corpus that cannot load): a fault in this
 *     release. The process still exits, so a Render deploy fails and the previous version keeps serving (docs/SECURITY-RULES.md rule 3).
 */

/** Node and PostgreSQL error codes that mean "no usable connection", not "the statement was wrong". */
const NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ENETDOWN',
]);
/**
 * 57P01 admin_shutdown, 57P02 crash_shutdown, 57P03 cannot_connect_now (starting up), 53300 too_many_connections, 3D000 the database does
 * not exist (renamed, being restored), 28P01 and 28000 (credentials refused while a password is being rotated). Class 08 is every
 * "connection exception".
 */
const SQLSTATES = new Set(['57P01', '57P02', '57P03', '53300', '3D000', '28P01', '28000']);
const MESSAGES = [
  /connection terminated/i,
  /timeout exceeded when trying to connect/i,
  /not currently accepting connections/i,
  /the database system is (starting up|shutting down|in recovery mode)/i,
  /terminating connection/i,
  /client has encountered a connection error/i,
  /connection (refused|closed|reset)/i,
  /cannot use a pool after calling end/i,
];

/** True when the error means the database could not be reached or the connection broke, as opposed to the database refusing a statement. */
export function isDatabaseUnavailable(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 3) return false;
  const e = error as { code?: unknown; message?: unknown; errors?: unknown; cause?: unknown };
  if (typeof e.code === 'string' && (NETWORK_CODES.has(e.code) || SQLSTATES.has(e.code) || e.code.startsWith('08'))) return true;
  // A message is only trusted for the errors pg raises itself, which carry no SQLSTATE (a failed statement always has one)
  if (typeof e.message === 'string' && typeof e.code !== 'string' && MESSAGES.some((m) => m.test(e.message as string))) return true;
  // The server says "not accepting connections" with 55000, which is a general code: match its message too
  if (e.code === '55000' && typeof e.message === 'string' && /not currently accepting connections/i.test(e.message)) return true;
  // Node tries every address of a name and reports them together as an AggregateError with an empty message
  if (Array.isArray(e.errors) && e.errors.length > 0 && e.errors.every((inner) => isDatabaseUnavailable(inner, depth + 1))) return true;
  return e.cause !== undefined && isDatabaseUnavailable(e.cause, depth + 1);
}

interface State {
  /** False until beginStartup() is called, which only the server's entry point does: tests and scripts that import the app are never gated. */
  gated: boolean;
  startupComplete: boolean;
  database: 'ok' | 'down';
  downSince: number | null;
  /** The code of the last connection error (never its message, which can carry a host name). */
  lastCode: string | null;
  now: () => number;
}

const state: State = { gated: false, startupComplete: true, database: 'ok', downSince: null, lastCode: null, now: Date.now };

/** The server calls this before it listens: from here on data routes answer 503 until the start has finished and the database is reachable. */
export function beginStartup(): void {
  state.gated = true;
  state.startupComplete = false;
}

export function completeStartup(): void {
  state.startupComplete = true;
}

export function markDatabaseDown(error?: unknown): void {
  const code = (error as { code?: unknown } | undefined)?.code;
  state.lastCode = typeof code === 'string' ? code : state.lastCode;
  if (state.database === 'ok') {
    state.database = 'down';
    state.downSince = state.now();
    console.error('Database unreachable: data routes now answer 503 until it is back', { code: state.lastCode });
  }
}

export function markDatabaseUp(): void {
  if (state.database === 'down') {
    console.log('Database reachable again', { downForSeconds: Math.round((state.now() - (state.downSince ?? state.now())) / 1000) });
  }
  state.database = 'ok';
  state.downSince = null;
}

export interface Availability {
  database: 'ok' | 'down';
  /** 'complete' once migrations, roles, policy, documents and audit entries are done; 'pending' while they wait or run; 'not-gated' under test. */
  startup: 'pending' | 'complete' | 'not-gated';
  downSeconds: number | null;
}

export function availability(): Availability {
  return {
    database: state.database,
    startup: !state.gated ? 'not-gated' : state.startupComplete ? 'complete' : 'pending',
    downSeconds: state.downSince === null ? null : Math.round((state.now() - state.downSince) / 1000),
  };
}

/** Back to the ungated default, and a clock for tests. */
export function resetAvailability(now: () => number = Date.now): void {
  Object.assign(state, { gated: false, startupComplete: true, database: 'ok', downSince: null, lastCode: null, now });
}

export const RETRY_AFTER_SECONDS = 5;

export function unavailableBody(kind: 'database' | 'starting') {
  return {
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message:
        kind === 'database'
          ? 'The service cannot reach its database right now. Nothing you sent was saved. Please try again in a minute; this page will work again by itself once the database is back.'
          : 'The service is starting up and is not ready yet. Please try again in a few seconds.',
    },
  };
}

/** Answers every API route with a 503 and a clear message while the start has not finished or the database is down. Mounted before any route that reads data. */
export function requireDatabase(req: Request, res: Response, next: NextFunction) {
  // /health answers on its own whatever the database is doing (it is how a deploy and the uptime check see the state)
  if (!state.gated || req.path === '/health') return next();
  const down = state.database === 'down';
  if (state.startupComplete && !down) return next();
  res.set('Retry-After', String(RETRY_AFTER_SECONDS));
  res.status(503).json(unavailableBody(down ? 'database' : 'starting'));
}

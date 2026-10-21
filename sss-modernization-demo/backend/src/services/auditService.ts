import pool from '../database/connection';
import { getRequestContext } from '../utils/requestContext';
import { currentTraceId } from '../observability/traceContext';

export interface AuditLog {
  id: number;
  action: string;
  actor?: string;
  actorEmail?: string;
  resource: string;
  resourceId?: string;
  status: 'success' | 'failure';
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  /** STORY-026: the trace id of the request that caused the entry (absent for entries written before it, or not caused by a request). */
  traceId?: string;
  timestamp: string;
}

export interface AuditLogQuery {
  action?: string;
  actor?: string;
  /** Part of the actor's email, case-insensitive. */
  user?: string;
  resource?: string;
  resourceId?: string;
  status?: 'success' | 'failure';
  /** Dates as YYYY-MM-DD, inclusive. */
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

// Action categories for audit logging
export enum AuditAction {
  // Authentication events
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  SESSION_EXTEND = 'SESSION_EXTEND',
  USER_REGISTRATION = 'USER_REGISTRATION',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  PASSWORD_RESET = 'PASSWORD_RESET',
  MFA_SETUP = 'MFA_SETUP',
  MFA_ENABLE = 'MFA_ENABLE',
  MFA_DISABLE = 'MFA_DISABLE',
  MFA_VERIFY_FAILED = 'MFA_VERIFY_FAILED',
  MFA_VERIFIED = 'MFA_VERIFIED',
  // STORY-003: the password was right and a code was asked for; the sign-in is not complete until MFA_VERIFIED
  MFA_CHALLENGE = 'MFA_CHALLENGE',

  // Data access (STORY-010): every successful read of the API, and exports
  DATA_READ = 'DATA_READ',
  DATA_EXPORT = 'DATA_EXPORT',

  // User management
  USER_CREATE = 'USER_CREATE',
  USER_UPDATE = 'USER_UPDATE',
  USER_DELETE = 'USER_DELETE',
  PROFILE_UPDATE = 'PROFILE_UPDATE',

  // Case management
  CASE_CREATE = 'CASE_CREATE',
  CASE_UPDATE = 'CASE_UPDATE',
  CASE_STATUS_CHANGE = 'CASE_STATUS_CHANGE',
  CASE_NOTE_ADD = 'CASE_NOTE_ADD',
  CASE_DOCUMENT_UPLOAD = 'CASE_DOCUMENT_UPLOAD',

  // Exemption management
  EXEMPTION_CREATE = 'EXEMPTION_CREATE',
  EXEMPTION_UPDATE = 'EXEMPTION_UPDATE',
  EXEMPTION_DELETE = 'EXEMPTION_DELETE',
  EXEMPTION_CHECK = 'EXEMPTION_CHECK',

  // Authorization
  ACCESS_DENIED = 'ACCESS_DENIED',
  PERMISSION_GRANT = 'PERMISSION_GRANT',
  PERMISSION_REVOKE = 'PERMISSION_REVOKE',
  // STORY-016: an administrator changed the access policy (a rule switched, a route limited to fewer roles)
  POLICY_CHANGE = 'POLICY_CHANGE',

  // Admin actions
  ADMIN_ACTION = 'ADMIN_ACTION',
  OVERRIDE = 'OVERRIDE',
  CONFIG_CHANGE = 'CONFIG_CHANGE',

  // Compliance
  COMPLIANCE_CHECK = 'COMPLIANCE_CHECK',
  COMPLIANCE_ALERT = 'COMPLIANCE_ALERT',

  // STORY-017 and STORY-018: the policy assistant. A change to the documents it answers from, and each answer it gives
  // (the entry names the exchange and the passages; the question itself is never written to the log)
  AI_CORPUS_UPDATE = 'AI_CORPUS_UPDATE',
  AI_ANSWER = 'AI_ANSWER',
  // STORY-019 and STORY-023: a person's feedback on an answer (a report sends it to the review queue), and a case manager's
  // review of a withheld or reported one. Neither entry holds the question, the answer or the person's comment.
  AI_FEEDBACK = 'AI_FEEDBACK',
  AI_REVIEW = 'AI_REVIEW',
  // STORY-021 and 025: an administrator starts a server-side evaluation or fairness run (it calls the model, so it costs money), the run
  // finishes, a run is marked as the baseline, and a drift alert opens or clears. None holds a question or an answer.
  AI_EVAL_RUN = 'AI_EVAL_RUN',
  AI_EVAL_BASELINE = 'AI_EVAL_BASELINE',
  AI_DRIFT_ALERT = 'AI_DRIFT_ALERT',
  // STORY-029: a service level objective was breached (phase opened) or recovered (phase cleared)
  SLO_ALERT = 'SLO_ALERT',

  // Infrastructure
  DEPLOYMENT = 'DEPLOYMENT',
  SERVER_START = 'SERVER_START',
  CONFIGURATION_UPDATE = 'CONFIGURATION_UPDATE',
  ALERT_TRIGGERED = 'ALERT_TRIGGERED',
}

export async function logAuditEvent(
  action: AuditAction | string,
  resource: string,
  status: 'success' | 'failure',
  options?: {
    actor?: string;
    actorEmail?: string;
    resourceId?: string;
    details?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<AuditLog> {
  // Remove sensitive data from details before logging
  const sanitizedDetails = sanitizeDetails(options?.details);
  // The caller's address and browser come from the request being handled, unless given
  const context = getRequestContext();

  const result = await pool.query(
    `INSERT INTO audit_logs (action, actor, actor_email, resource, resource_id, status, details, ip_address, user_agent, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, action, actor, actor_email, resource, resource_id, status, details, ip_address, user_agent, trace_id, timestamp`,
    [
      action,
      options?.actor || null,
      options?.actorEmail || null,
      resource,
      options?.resourceId || null,
      status,
      sanitizedDetails ? JSON.stringify(sanitizedDetails) : null,
      options?.ipAddress || context?.ip || null,
      options?.userAgent || context?.userAgent || null,
      currentTraceId() || null,
    ]
  );

  return mapRowToAuditLog(result.rows[0]);
}

/**
 * Records a start of the server. It is a new release (DEPLOYMENT) when the commit differs from the last release
 * recorded or migrations ran; otherwise a restart (SERVER_START). Render's free plan restarts idle services, and
 * the log listed every one of those restarts as a deployment.
 */
export async function recordServerStart(commit: string, migrationsApplied: string[]): Promise<void> {
  const last = await pool.query(
    `SELECT details->>'commit' AS commit FROM audit_logs WHERE action = $1 ORDER BY id DESC LIMIT 1`,
    [AuditAction.DEPLOYMENT]
  );
  const release = migrationsApplied.length > 0 || last.rows[0]?.commit !== commit;
  await logAuditEvent(release ? AuditAction.DEPLOYMENT : AuditAction.SERVER_START, 'system', 'success', {
    details: { commit, migrationsApplied },
  });
}

/**
 * Writes an audit entry without holding up the response (reads, denials, logins). A write that
 * fails is reported on the server log; the action it describes has already happened.
 *
 * STORY-033: the entries are collected until the event loop has finished the work it has in hand (setImmediate) and written with one INSERT. Every read of the API is audited (STORY-010),
 * so one statement and one pooled connection per read was the largest single user of the connection pool under load. Each entry keeps
 * the time, the caller's address, the browser and the trace id of the moment it was recorded, and nothing about it is dropped or changed.
 * The cost: an entry is in the database one turn of the event loop after the action (a few milliseconds when the server is busy), and a process
 * that is killed outright (not stopped with SIGTERM, which writes the pending entries first) can lose the entries of that last turn.
 */
const AUDIT_BATCH_MAX = 100;
const AUDIT_COLUMNS = 11;
let pendingAudit: unknown[][] = [];
let auditTimer: NodeJS.Immediate | undefined;

export function recordAudit(...args: Parameters<typeof logAuditEvent>): void {
  const [action, resource, status, options] = args;
  const sanitizedDetails = sanitizeDetails(options?.details);
  const context = getRequestContext();
  pendingAudit.push([
    action,
    options?.actor || null,
    options?.actorEmail || null,
    resource,
    options?.resourceId || null,
    status,
    sanitizedDetails ? JSON.stringify(sanitizedDetails) : null,
    options?.ipAddress || context?.ip || null,
    options?.userAgent || context?.userAgent || null,
    currentTraceId() || null,
    Date.now(),
  ]);
  if (pendingAudit.length >= AUDIT_BATCH_MAX) {
    void flushAuditEntries();
  } else if (!auditTimer) {
    auditTimer = setImmediate(() => void flushAuditEntries());
  }
}

const AUDIT_INSERT = 'INSERT INTO audit_logs (action, actor, actor_email, resource, resource_id, status, details, ip_address, user_agent, trace_id, timestamp) VALUES';
const rowSql = (n: number) =>
  '(' + Array.from({ length: AUDIT_COLUMNS }, (_, i) => (i === AUDIT_COLUMNS - 1 ? `to_timestamp($${n + i}::double precision / 1000.0)::timestamp` : `$${n + i}`)).join(', ') + ')';

/** Writes the entries collected so far. If the batch is refused (one entry names an actor that no longer exists), the entries go one at a time so only the bad one is lost. */
export async function flushAuditEntries(): Promise<void> {
  if (auditTimer) clearImmediate(auditTimer);
  auditTimer = undefined;
  const rows = pendingAudit;
  pendingAudit = [];
  if (rows.length === 0) return;
  const report = (row: unknown[], error: unknown) =>
    console.error('Audit entry not written', { action: row[0], resource: row[3], message: (error as Error).message });
  try {
    await pool.query(`${AUDIT_INSERT} ${rows.map((_, i) => rowSql(i * AUDIT_COLUMNS + 1)).join(', ')}`, rows.flat());
  } catch (batchError) {
    for (const row of rows) {
      try {
        await pool.query(`${AUDIT_INSERT} ${rowSql(1)}`, row);
      } catch (error) {
        report(row, error);
      }
    }
  }
}

/** True when the database itself refuses updates and deletes of audit entries (migration 015). */
export async function auditLogIsWriteOnce(): Promise<boolean> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n FROM pg_trigger
     WHERE tgrelid = 'audit_logs'::regclass AND tgname IN ('audit_logs_no_update_delete', 'audit_logs_no_truncate') AND tgenabled <> 'D'`
  );
  return result.rows[0].n === 2;
}

export async function getAuditLogs(query: AuditLogQuery): Promise<{ logs: AuditLog[]; total: number }> {
  const {
    action,
    actor,
    user,
    resource,
    resourceId,
    status,
    startDate,
    endDate,
    limit = 100,
    offset = 0,
  } = query;

  // Build dynamic WHERE clause
  const conditions: string[] = [];
  const params: any[] = [];
  let paramCount = 1;

  if (action) {
    conditions.push(`action = $${paramCount}`);
    params.push(action);
    paramCount++;
  }

  if (actor) {
    conditions.push(`actor = $${paramCount}`);
    params.push(actor);
    paramCount++;
  }

  // A person's whole trail: what they did, plus events about their address when nobody was
  // signed in as them (failed sign-ins) or the system acted on them (role grants)
  if (user) {
    conditions.push(`(actor_email ILIKE $${paramCount} OR details->>'email' ILIKE $${paramCount})`);
    params.push(`%${user}%`);
    paramCount++;
  }

  if (resource) {
    conditions.push(`resource = $${paramCount}`);
    params.push(resource);
    paramCount++;
  }

  if (resourceId) {
    conditions.push(`resource_id = $${paramCount}`);
    params.push(resourceId);
    paramCount++;
  }

  if (status) {
    conditions.push(`status = $${paramCount}`);
    params.push(status);
    paramCount++;
  }

  // Whole days, inclusive: from the start of startDate to the end of endDate
  if (startDate) {
    conditions.push(`timestamp >= $${paramCount}::date`);
    params.push(startDate);
    paramCount++;
  }

  if (endDate) {
    conditions.push(`timestamp < $${paramCount}::date + 1`);
    params.push(endDate);
    paramCount++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Get paginated logs
  params.push(limit, offset);
  const result = await pool.query(
    `SELECT id, action, actor, actor_email, resource, resource_id, status, details, ip_address, user_agent, trace_id, timestamp
     FROM audit_logs ${whereClause}
     ORDER BY timestamp DESC
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    params
  );

  return {
    logs: result.rows.map(mapRowToAuditLog),
    total,
  };
}

export async function getAuditLogsByUser(userId: string, limit: number = 50): Promise<AuditLog[]> {
  const result = await pool.query(
    `SELECT id, action, actor, actor_email, resource, resource_id, status, details, ip_address, user_agent, trace_id, timestamp
     FROM audit_logs WHERE actor = $1 ORDER BY timestamp DESC LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map(mapRowToAuditLog);
}

export async function getAuditLogsByResource(
  resource: string,
  resourceId: string,
  limit: number = 100
): Promise<AuditLog[]> {
  const result = await pool.query(
    `SELECT id, action, actor, actor_email, resource, resource_id, status, details, ip_address, user_agent, trace_id, timestamp
     FROM audit_logs WHERE resource = $1 AND resource_id = $2 ORDER BY timestamp DESC LIMIT $3`,
    [resource, resourceId, limit]
  );

  return result.rows.map(mapRowToAuditLog);
}

export async function getAuditStats(): Promise<{
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  lastEventTime: string;
  eventsByAction: Record<string, number>;
}> {
  const totalResult = await pool.query('SELECT COUNT(*) as total FROM audit_logs');
  const successResult = await pool.query('SELECT COUNT(*) as count FROM audit_logs WHERE status = $1', ['success']);
  const failureResult = await pool.query('SELECT COUNT(*) as count FROM audit_logs WHERE status = $1', ['failure']);
  const lastEventResult = await pool.query('SELECT timestamp FROM audit_logs ORDER BY timestamp DESC LIMIT 1');
  const actionResult = await pool.query(
    'SELECT action, COUNT(*) as count FROM audit_logs GROUP BY action ORDER BY count DESC'
  );

  const eventsByAction: Record<string, number> = {};
  for (const row of actionResult.rows) {
    eventsByAction[row.action] = parseInt(row.count, 10);
  }

  return {
    totalEvents: parseInt(totalResult.rows[0].total, 10),
    successfulEvents: parseInt(successResult.rows[0].count, 10),
    failedEvents: parseInt(failureResult.rows[0].count, 10),
    lastEventTime: lastEventResult.rows[0]?.timestamp || new Date().toISOString(),
    eventsByAction,
  };
}

// Helper functions

function mapRowToAuditLog(row: any): AuditLog {
  return {
    id: row.id,
    action: row.action,
    actor: row.actor,
    actorEmail: row.actor_email,
    resource: row.resource,
    resourceId: row.resource_id,
    status: row.status,
    // node-pg already parses JSONB columns into objects
    details: row.details ?? undefined,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    traceId: row.trace_id ?? undefined,
    timestamp: row.timestamp,
  };
}

// Keys whose values never belong in the audit log, at any depth (password, passwordHash, ssn,
// mfaSecret, token, authorization, cookie, ...), and SSN-shaped text anywhere in a value.
const SENSITIVE_KEY = /^pass(word)?$|password|secret|token$|ssn(hash)?$|authorization|cookie|^totp/i;
const SSN_TEXT = /\b\d{3}-\d{2}-\d{4}\b/g;

/** STORY-018: the same SSN pattern, for text that is not an audit entry (the assistant strips it from questions before they are stored or sent). */
export function redactSsn(text: string): string {
  return text.replace(SSN_TEXT, '[REDACTED]');
}

/** Redacts sensitive keys and SSN-shaped text throughout the details, including nested objects and arrays. */
export function sanitizeDetails(details?: Record<string, any>): Record<string, any> | null {
  if (!details) return null;
  const clean = (value: any): any => {
    if (typeof value === 'string') return value.replace(SSN_TEXT, '[REDACTED]');
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : clean(v)])
      );
    }
    return value;
  };
  return clean(details);
}

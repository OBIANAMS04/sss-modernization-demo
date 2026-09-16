import pool from '../database/connection';

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
  timestamp: string;
}

export interface AuditLogQuery {
  action?: string;
  actor?: string;
  resource?: string;
  status?: 'success' | 'failure';
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
  USER_REGISTRATION = 'USER_REGISTRATION',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  PASSWORD_RESET = 'PASSWORD_RESET',
  MFA_ENABLE = 'MFA_ENABLE',
  MFA_DISABLE = 'MFA_DISABLE',
  MFA_VERIFY_FAILED = 'MFA_VERIFY_FAILED',

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

  // Authorization
  ACCESS_DENIED = 'ACCESS_DENIED',
  PERMISSION_GRANT = 'PERMISSION_GRANT',
  PERMISSION_REVOKE = 'PERMISSION_REVOKE',

  // Admin actions
  ADMIN_ACTION = 'ADMIN_ACTION',
  OVERRIDE = 'OVERRIDE',
  CONFIG_CHANGE = 'CONFIG_CHANGE',

  // Compliance
  COMPLIANCE_CHECK = 'COMPLIANCE_CHECK',
  COMPLIANCE_ALERT = 'COMPLIANCE_ALERT',

  // Infrastructure
  DEPLOYMENT = 'DEPLOYMENT',
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

  const result = await pool.query(
    `INSERT INTO audit_logs (action, actor, actor_email, resource, resource_id, status, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, action, actor, actor_email, resource, resource_id, status, details, ip_address, user_agent, timestamp`,
    [
      action,
      options?.actor || null,
      options?.actorEmail || null,
      resource,
      options?.resourceId || null,
      status,
      sanitizedDetails ? JSON.stringify(sanitizedDetails) : null,
      options?.ipAddress || null,
      options?.userAgent || null,
    ]
  );

  return mapRowToAuditLog(result.rows[0]);
}

export async function getAuditLogs(query: AuditLogQuery): Promise<{ logs: AuditLog[]; total: number }> {
  const {
    action,
    actor,
    resource,
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

  if (resource) {
    conditions.push(`resource = $${paramCount}`);
    params.push(resource);
    paramCount++;
  }

  if (status) {
    conditions.push(`status = $${paramCount}`);
    params.push(status);
    paramCount++;
  }

  if (startDate) {
    conditions.push(`timestamp >= $${paramCount}`);
    params.push(startDate);
    paramCount++;
  }

  if (endDate) {
    conditions.push(`timestamp <= $${paramCount}`);
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
    `SELECT id, action, actor, actor_email, resource, resource_id, status, details, ip_address, user_agent, timestamp
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
    `SELECT id, action, actor, actor_email, resource, resource_id, status, details, ip_address, user_agent, timestamp
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
    `SELECT id, action, actor, actor_email, resource, resource_id, status, details, ip_address, user_agent, timestamp
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
    details: row.details ? JSON.parse(row.details) : undefined,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    timestamp: row.timestamp,
  };
}

function sanitizeDetails(details?: Record<string, any>): Record<string, any> | null {
  if (!details) return null;

  // Remove sensitive fields
  const sensitiveFields = ['password', 'passwordHash', 'secret', 'token', 'ssn'];
  const sanitized = { ...details };

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}

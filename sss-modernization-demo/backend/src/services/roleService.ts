import pool from '../database/connection';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { AuditAction, logAuditEvent } from './auditService';
import { inTransaction, notify } from './caseEvents';

export type Role = 'citizen' | 'case_manager' | 'leadership' | 'admin';

/** Case work: case managers and admins. Leadership reads aggregate dashboards only and is not staff. */
export function isStaff(role?: string | null): boolean {
  return role === 'case_manager' || role === 'admin';
}

export function isAdmin(role?: string | null): boolean {
  return role === 'admin';
}

/** The leadership dashboard: leadership, and admins, who may see everything leadership can. */
export function isLeadership(role?: string | null): boolean {
  return role === 'leadership' || role === 'admin';
}

/** Lower-cased emails from a comma-separated setting. */
function listedEmails(setting: 'CASE_MANAGER_EMAILS' | 'ADMIN_EMAILS'): string[] {
  return (process.env[setting] || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const caseManagerEmails = () => listedEmails('CASE_MANAGER_EMAILS');
const adminEmails = () => listedEmails('ADMIN_EMAILS');

/** True when at least one case manager or admin exists. */
async function staffExist(): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM users WHERE role IN ('case_manager', 'admin') LIMIT 1`);
  return result.rows.length > 0;
}

/** True when at least one admin exists. */
async function adminExists(): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
  return result.rows.length > 0;
}

/** What the audit entry says when CASE_MANAGER_EMAILS, not a person, granted the role. */
export const BOOTSTRAP_VIA = 'CASE_MANAGER_EMAILS bootstrap (no staff yet)';

/** The same for ADMIN_EMAILS (STORY-014). */
export const ADMIN_BOOTSTRAP_VIA = 'ADMIN_EMAILS bootstrap (no admin yet; case managers only)';

/**
 * Email addresses are not verified, so being listed in CASE_MANAGER_EMAILS does not prove who someone is: whoever
 * registered a listed address first used to get staff access. The list now only bootstraps a database that has no
 * staff yet; after that an existing case manager grants the role in the app (Staff Access).
 */
export async function roleForNewUser(email: string): Promise<Role> {
  if (!caseManagerEmails().includes(email.toLowerCase())) return 'citizen';
  return (await staffExist()) ? 'citizen' : 'case_manager';
}

/** Grants the role to listed accounts that already exist, while nobody has staff access. */
async function bootstrapCaseManagers(): Promise<void> {
  const emails = caseManagerEmails();
  if (emails.length === 0 || (await staffExist())) return;
  const granted = await pool.query(
    `UPDATE users SET role = 'case_manager' WHERE role = 'citizen' AND lower(email) = ANY($1) RETURNING id, email`,
    [emails]
  );
  for (const user of granted.rows) {
    await logAuditEvent(AuditAction.PERMISSION_GRANT, 'users', 'success', {
      resourceId: user.id,
      details: { email: user.email, role: 'case_manager', via: BOOTSTRAP_VIA },
    });
  }
}

/**
 * STORY-014: while no admin exists, a case manager whose address is listed in ADMIN_EMAILS becomes one. Only people who
 * already are case managers are promoted, so registering a listed address grants nothing, and nobody is demoted.
 */
async function bootstrapAdmins(): Promise<void> {
  const emails = adminEmails();
  if (emails.length === 0 || (await adminExists())) return;
  const promoted = await pool.query(
    `UPDATE users SET role = 'admin' WHERE role = 'case_manager' AND lower(email) = ANY($1) RETURNING id, email`,
    [emails]
  );
  for (const user of promoted.rows) {
    await logAuditEvent(AuditAction.PERMISSION_GRANT, 'users', 'success', {
      resourceId: user.id,
      details: { email: user.email, role: 'admin', via: ADMIN_BOOTSTRAP_VIA },
    });
  }
}

/**
 * Runs at startup. Grants the role to listed accounts that already exist, but only while nobody has staff access
 * (same reason as above), and never revokes: it used to demote case managers the list no longer named, so a
 * restart could remove access that was granted in the app. Every grant is audited. Administrators follow the same
 * rule once the case managers are in place.
 */
export async function bootstrapStaffRoles(): Promise<void> {
  await bootstrapCaseManagers();
  await bootstrapAdmins();
}

/**
 * The person's role, read from the database. With sid (the session a token belongs to, STORY-041), null also when that session was
 * ended by signing out: the same single statement checks the deny list, so a signed-out token costs no extra round trip to refuse.
 */
export async function getUserRole(userId: string, sid?: string): Promise<Role | null> {
  const result = sid
    ? await pool.query(
        'SELECT role FROM users WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM revoked_sessions WHERE sid = $2::uuid)',
        [userId, sid]
      )
    : await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.role ?? null;
}

export interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface StaffMember extends StaffUser {
  createdAt: string;
}

/** The person making a change, as the audit entry and the other person's notification name them. */
export interface StaffActor {
  actorId: string;
  actorEmail: string;
  /** As read from the database for this request (requireStaff), not from the token. */
  actorRole: Role;
}

const MAX_REASON_LENGTH = 500;

// Arbitrary constant so concurrent changes of access are handled one at a time.
const STAFF_LOCK_ID = 7_012_001;

/** The roles Staff Access gives and removes; everyone else is a citizen. */
export const GRANTABLE_ROLES: Role[] = ['case_manager', 'leadership', 'admin'];

// How a role is named in messages, and what its holder can open
const ROLE_NAMES: Record<Role, string> = { citizen: 'citizen', case_manager: 'case-manager', leadership: 'leadership', admin: 'administrator' };
const ROLE_PAGES: Record<string, string> = { case_manager: 'the staff pages', leadership: 'the leadership dashboard', admin: 'the admin pages' };

// What must stay true after a removal. It is part of the removal's own statement, so it holds even for a caller that
// was removed a moment ago: someone can always work cases, and there is always an administrator.
const KEEP_ONE: Partial<Record<Role, { guard: string; message: string }>> = {
  case_manager: {
    guard: `(SELECT COUNT(*) FROM users WHERE role IN ('case_manager', 'admin')) > 1`,
    message: 'At least one case manager must keep access.',
  },
  admin: { guard: `(SELECT COUNT(*) FROM users WHERE role = 'admin') > 1`, message: 'At least one administrator must keep access.' },
};

const toStaffUser = (row: any): StaffUser => ({ id: row.id, email: row.email, fullName: row.full_name, role: row.role });

/** Everyone Staff Access manages: case managers, leadership and admins. */
export async function listStaff(): Promise<StaffMember[]> {
  const result = await pool.query(
    `SELECT id, email, full_name, role, created_at FROM users WHERE role IN ('case_manager', 'leadership', 'admin') ORDER BY email`
  );
  return result.rows.map((row: any) => ({ ...toStaffUser(row), createdAt: row.created_at }));
}

/** A role change always says why; the reason is kept in the audit log. (STORY-016: a policy change says why in the same way.) */
export function cleanReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new ValidationError('A reason is required. It is kept in the audit log.');
  if (text.length > MAX_REASON_LENGTH) throw new ValidationError(`The reason must be ${MAX_REASON_LENGTH} characters or less.`);
  return text;
}

/** The role being given. Leaving it out means case manager, as the endpoint worked before there were other roles. */
function cleanRole(role: unknown): Role {
  if (role === undefined || role === null || role === '') return 'case_manager';
  if (typeof role === 'string' && GRANTABLE_ROLES.includes(role as Role)) return role as Role;
  throw new ValidationError('The role must be case_manager, leadership or admin.');
}

/**
 * Gives a registered person a role. A case manager gives case-manager access; an administrator also gives leadership
 * and administrator access.
 */
export async function grantStaffRole(actor: StaffActor, email: string, role: unknown, reason: string): Promise<StaffUser> {
  const why = cleanReason(reason);
  const address = typeof email === 'string' ? email.trim() : '';
  if (!address) throw new ValidationError('An email address is required.');
  const given = cleanRole(role);
  if (given !== 'case_manager' && !isAdmin(actor.actorRole)) {
    throw new AppError(403, `Only an administrator can give ${ROLE_NAMES[given]} access.`, 'FORBIDDEN');
  }

  // Addresses are matched whatever their case; an exact match wins if two accounts differ only by case
  const found = await pool.query(
    `SELECT id, email, full_name, role FROM users WHERE lower(email) = lower($1) ORDER BY (email = $1) DESC LIMIT 1`,
    [address]
  );
  if (found.rows.length === 0) throw new NotFoundError('No account uses that email. They need to register first.');
  const target = found.rows[0];
  // A person has one role. Administrator includes what case managers and leadership can do, so giving it to either is an
  // upgrade; any other change means removing the current role first.
  const upgrade = given === 'admin' && (target.role === 'case_manager' || target.role === 'leadership');
  if (target.role !== 'citizen' && !upgrade) throw new ConflictError(`${target.email} already has ${ROLE_NAMES[target.role as Role]} access.`);

  return inTransaction(async (client) => {
    // The same lock as removals, so the "no administrator yet" check below cannot be passed by two grants at once
    await client.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK_ID]);
    const updated = await client.query(
      `UPDATE users SET role = $2 WHERE id = $1 AND role = $3 RETURNING id, email, full_name, role`,
      [target.id, given, target.role]
    );
    if (updated.rows.length === 0) throw new ConflictError(`${target.email}'s access changed just now. Check the list and try again.`);
    await notify(client, target.id, null, `You now have ${ROLE_NAMES[given]} access, granted by ${actor.actorEmail}. Sign in again to see ${ROLE_PAGES[given]}.`);
    // Written before the commit, so a role never changes without its audit entry
    await logAuditEvent(AuditAction.PERMISSION_GRANT, 'users', 'success', {
      actor: actor.actorId,
      actorEmail: actor.actorEmail,
      resourceId: target.id,
      details: { email: target.email, role: given, ...(upgrade ? { previousRole: target.role } : {}), reason: why, via: 'Staff Access' },
    });

    // STORY-014: right after someone becomes a case manager, ADMIN_EMAILS can make them an administrator, while there is none
    let result = updated.rows[0];
    if (given === 'case_manager' && adminEmails().includes(result.email.toLowerCase())) {
      const promoted = await client.query(
        `UPDATE users SET role = 'admin'
         WHERE id = $1 AND role = 'case_manager' AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
         RETURNING id, email, full_name, role`,
        [result.id]
      );
      if (promoted.rows.length > 0) {
        result = promoted.rows[0];
        await notify(client, result.id, null, `You now have administrator access: your address is listed for it and there was no administrator yet. Sign in again to see ${ROLE_PAGES.admin}.`);
        await logAuditEvent(AuditAction.PERMISSION_GRANT, 'users', 'success', {
          resourceId: result.id,
          details: { email: result.email, role: 'admin', via: ADMIN_BOOTSTRAP_VIA },
        });
      }
    }
    return toStaffUser(result);
  });
}

/**
 * Takes a staff role away from someone else. A case manager removes case managers; an administrator removes any of the
 * three. The system keeps at least one person who can work cases, and at least one administrator.
 */
export async function revokeStaffRole(actor: StaffActor, userId: string, reason: string): Promise<StaffUser> {
  const why = cleanReason(reason);
  if (userId === actor.actorId) throw new AppError(403, 'You cannot remove your own access.', 'FORBIDDEN');

  return inTransaction(async (client) => {
    // The guard below counts staff as of the moment its statement starts, so two managers removing each other at
    // the same instant would each still see two and both succeed. Taking this lock first makes the second removal
    // wait for the first to commit, and then see one.
    await client.query('SELECT pg_advisory_xact_lock($1)', [STAFF_LOCK_ID]);

    const found = await client.query('SELECT id, email, full_name, role FROM users WHERE id = $1', [userId]);
    if (found.rows.length === 0) throw new NotFoundError('No account has that id.');
    const target = found.rows[0];
    if (!GRANTABLE_ROLES.includes(target.role)) throw new ConflictError(`${target.email} has no staff access to remove.`);
    if (target.role !== 'case_manager' && !isAdmin(actor.actorRole)) {
      const name = ROLE_NAMES[target.role as Role];
      throw new AppError(403, `${name[0].toUpperCase()}${name.slice(1)} access can only be changed by an administrator.`, 'FORBIDDEN');
    }

    const keep = KEEP_ONE[target.role as Role];
    const updated = await client.query(
      `UPDATE users SET role = 'citizen'
       WHERE id = $1 AND role = $2${keep ? ` AND ${keep.guard}` : ''}
       RETURNING id, email, full_name, role`,
      [target.id, target.role]
    );
    if (updated.rows.length === 0) throw new ConflictError(keep?.message ?? `${target.email}'s access changed just now. Check the list and try again.`);
    await notify(client, target.id, null, `Your ${ROLE_NAMES[target.role as Role]} access was removed by ${actor.actorEmail}.`);
    await logAuditEvent(AuditAction.PERMISSION_REVOKE, 'users', 'success', {
      actor: actor.actorId,
      actorEmail: actor.actorEmail,
      resourceId: target.id,
      details: { email: target.email, role: 'citizen', previousRole: target.role, reason: why, via: 'Staff Access' },
    });
    return toStaffUser(updated.rows[0]);
  });
}

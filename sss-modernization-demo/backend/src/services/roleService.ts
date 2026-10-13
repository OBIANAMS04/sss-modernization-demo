import pool from '../database/connection';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { AuditAction, logAuditEvent } from './auditService';
import { inTransaction, notify } from './caseEvents';

export type Role = 'citizen' | 'case_manager' | 'admin';

export function isStaff(role?: string | null): boolean {
  return role === 'case_manager' || role === 'admin';
}

/** Lower-cased emails from CASE_MANAGER_EMAILS (comma-separated). */
function caseManagerEmails(): string[] {
  return (process.env.CASE_MANAGER_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True when at least one case manager or admin exists. */
async function staffExist(): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM users WHERE role IN ('case_manager', 'admin') LIMIT 1`);
  return result.rows.length > 0;
}

/** What the audit entry says when CASE_MANAGER_EMAILS, not a person, granted the role. */
export const BOOTSTRAP_VIA = 'CASE_MANAGER_EMAILS bootstrap (no staff yet)';

/**
 * Email addresses are not verified, so being listed in CASE_MANAGER_EMAILS does not prove who someone is: whoever
 * registered a listed address first used to get staff access. The list now only bootstraps a database that has no
 * staff yet; after that an existing case manager grants the role in the app (Staff Access).
 */
export async function roleForNewUser(email: string): Promise<Role> {
  if (!caseManagerEmails().includes(email.toLowerCase())) return 'citizen';
  return (await staffExist()) ? 'citizen' : 'case_manager';
}

/**
 * Runs at startup. Grants the role to listed accounts that already exist, but only while nobody has staff access
 * (same reason as above), and never revokes: it used to demote case managers the list no longer named, so a
 * restart could remove access that was granted in the app. Every grant is audited.
 */
export async function bootstrapStaffRoles(): Promise<void> {
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

export async function getUserRole(userId: string): Promise<Role | null> {
  const result = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
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

/** The case manager making a change, as the audit entry and the person's notification name them. */
export interface StaffActor {
  actorId: string;
  actorEmail: string;
}

const MAX_REASON_LENGTH = 500;

// Arbitrary constant so concurrent removals of access are handled one at a time.
const STAFF_LOCK_ID = 7_012_001;

const toStaffUser = (row: any): StaffUser => ({ id: row.id, email: row.email, fullName: row.full_name, role: row.role });

/** Everyone who can work cases. */
export async function listStaff(): Promise<StaffMember[]> {
  const result = await pool.query(
    `SELECT id, email, full_name, role, created_at FROM users WHERE role IN ('case_manager', 'admin') ORDER BY email`
  );
  return result.rows.map((row: any) => ({ ...toStaffUser(row), createdAt: row.created_at }));
}

/** A role change always says why; the reason is kept in the audit log. */
function cleanReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new ValidationError('A reason is required. It is kept in the audit log.');
  if (text.length > MAX_REASON_LENGTH) throw new ValidationError(`The reason must be ${MAX_REASON_LENGTH} characters or less.`);
  return text;
}

/** An existing case manager gives a registered person the case-manager role. */
export async function grantCaseManager(actor: StaffActor, email: string, reason: string): Promise<StaffUser> {
  const why = cleanReason(reason);
  const address = typeof email === 'string' ? email.trim() : '';
  if (!address) throw new ValidationError('An email address is required.');

  // Addresses are matched whatever their case; an exact match wins if two accounts differ only by case
  const found = await pool.query(
    `SELECT id, email, full_name, role FROM users WHERE lower(email) = lower($1) ORDER BY (email = $1) DESC LIMIT 1`,
    [address]
  );
  if (found.rows.length === 0) throw new NotFoundError('No account uses that email. They need to register first.');
  const target = found.rows[0];
  if (isStaff(target.role)) throw new ConflictError(`${target.email} already has staff access.`);

  return inTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE users SET role = 'case_manager' WHERE id = $1 AND role = 'citizen' RETURNING id, email, full_name, role`,
      [target.id]
    );
    if (updated.rows.length === 0) throw new ConflictError(`${target.email} already has staff access.`);
    await notify(client, target.id, null, `You now have case-manager access, granted by ${actor.actorEmail}. Sign in again to see the staff pages.`);
    // Written before the commit, so a role never changes without its audit entry
    await logAuditEvent(AuditAction.PERMISSION_GRANT, 'users', 'success', {
      actor: actor.actorId,
      actorEmail: actor.actorEmail,
      resourceId: target.id,
      details: { email: target.email, role: 'case_manager', reason: why, via: 'Staff Access' },
    });
    return toStaffUser(updated.rows[0]);
  });
}

/** An existing case manager takes the case-manager role away from someone else. Admins are not changed here. */
export async function revokeCaseManager(actor: StaffActor, userId: string, reason: string): Promise<StaffUser> {
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
    if (target.role === 'admin') throw new AppError(403, 'Administrator access cannot be changed here.', 'FORBIDDEN');
    if (target.role !== 'case_manager') throw new ConflictError(`${target.email} is not a case manager.`);

    const updated = await client.query(
      `UPDATE users SET role = 'citizen'
       WHERE id = $1 AND role = 'case_manager'
         AND (SELECT COUNT(*) FROM users WHERE role IN ('case_manager', 'admin')) > 1
       RETURNING id, email, full_name, role`,
      [target.id]
    );
    if (updated.rows.length === 0) throw new ConflictError('At least one case manager must keep access.');
    await notify(client, target.id, null, `Your case-manager access was removed by ${actor.actorEmail}.`);
    await logAuditEvent(AuditAction.PERMISSION_REVOKE, 'users', 'success', {
      actor: actor.actorId,
      actorEmail: actor.actorEmail,
      resourceId: target.id,
      details: { email: target.email, role: 'citizen', reason: why, via: 'Staff Access' },
    });
    return toStaffUser(updated.rows[0]);
  });
}

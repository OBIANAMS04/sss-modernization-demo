import pool from '../database/connection';

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

export function roleForNewUser(email: string): Role {
  return caseManagerEmails().includes(email.toLowerCase()) ? 'case_manager' : 'citizen';
}

/**
 * Makes users.role match CASE_MANAGER_EMAILS: listed users become case managers and
 * case managers no longer listed revert to citizen. Admins are never changed here.
 * Runs at startup, so editing the variable on Render (which restarts the service) applies it.
 */
export async function syncCaseManagerRoles(): Promise<void> {
  const emails = caseManagerEmails();
  await pool.query(`UPDATE users SET role = 'case_manager' WHERE role = 'citizen' AND lower(email) = ANY($1)`, [emails]);
  await pool.query(`UPDATE users SET role = 'citizen' WHERE role = 'case_manager' AND NOT (lower(email) = ANY($1))`, [emails]);
}

export async function getUserRole(userId: string): Promise<Role | null> {
  const result = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.role ?? null;
}

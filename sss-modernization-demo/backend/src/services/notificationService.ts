import pool from '../database/connection';

export interface Notification {
  id: string;
  caseId: string | null;
  message: string;
  read: boolean;
  createdAt: string;
}

export async function listNotifications(userId: string, limit = 20): Promise<{ notifications: Notification[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    pool.query(
      `SELECT id, case_id, message, read_at, created_at FROM notifications
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 100)]
    ),
    pool.query('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]),
  ]);
  return {
    notifications: rows.rows.map((r: any) => ({
      id: r.id,
      caseId: r.case_id,
      message: r.message,
      read: r.read_at !== null,
      createdAt: r.created_at,
    })),
    unread: parseInt(unread.rows[0].n, 10),
  };
}

/** Marks one of the user's own notifications read (other users' ids are silently ignored). */
export async function markRead(userId: string, notificationId: string): Promise<void> {
  await pool.query('UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [
    notificationId,
    userId,
  ]);
}

export async function markAllRead(userId: string): Promise<void> {
  await pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL', [userId]);
}

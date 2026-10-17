import pool from '../database/connection';

// Shared by caseService and complianceService (which must not import each other).

export interface Actor {
  id: string;
  email: string;
  role: string | null;
}

/**
 * Records one entry on a case's timeline and returns its id. For a decision, `eligibility` is the automatic eligibility result in
 * force at that moment (STORY-024): the exemption row is updated in place when eligibility is checked again, so it cannot be read back.
 */
export async function recordEvent(
  client: any,
  caseId: string,
  eventType: string,
  actor: Actor,
  extra: { fromStatus?: string | null; toStatus?: string | null; detail?: string | null; eligibility?: string | null } = {}
): Promise<string> {
  const result = await client.query(
    `INSERT INTO case_events (case_id, event_type, from_status, to_status, actor_id, actor_email, detail, eligibility_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [caseId, eventType, extra.fromStatus ?? null, extra.toStatus ?? null, actor.id, actor.email, extra.detail ?? null, extra.eligibility ?? null]
  );
  return result.rows[0].id;
}

/** A notification about a case links to it; one that is not about a case (a role change) passes null. */
export async function notify(client: any, userId: string, caseId: string | null, message: string): Promise<void> {
  await client.query('INSERT INTO notifications (user_id, case_id, message) VALUES ($1, $2, $3)', [userId, caseId, message]);
}

export async function inTransaction<T>(work: (client: any) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

import pool from '../database/connection';
import { MAX_SESSION_SECONDS } from '../utils/jwt';

/**
 * STORY-041: signing out ends the session on the server. Tokens are signed and checked without a lookup, so until now a copied token
 * kept working for up to an hour after its owner signed out. The session id (sid) is in every token of one sign-in; recording it here
 * makes the per-request role read (getUserRole) refuse all of them at once. A row is kept only until the longest session could have
 * lasted (12 hours after the sign-in), after which the token is expired anyway.
 */
export async function endSession(sid: string, userId: string, authTime: number): Promise<void> {
  await pool.query(
    `INSERT INTO revoked_sessions (sid, user_id, expires_at) VALUES ($1, $2, to_timestamp($3)) ON CONFLICT (sid) DO NOTHING`,
    [sid, userId, authTime + MAX_SESSION_SECONDS]
  );
  await pool.query(`DELETE FROM revoked_sessions WHERE expires_at < NOW()`);
}

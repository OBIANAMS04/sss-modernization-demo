import { createHash, randomBytes } from 'node:crypto';
import pool from '../database/connection';
import { AuditAction, logAuditEvent } from './auditService';

// STORY-010: settings that decide who may call the API, how sign-ins are signed and how long they last,
// who gets staff access, and which database holds the data. Each server start compares them with the
// previous start and records any difference as CONFIG_CHANGE. Public settings appear with their old and
// new values; the others are compared by a salted fingerprint and only named, so no secret or
// connection detail reaches the log.
// STORY-018/019: the policy assistant's settings are tracked too, so turning AI on (ANTHROPIC_API_KEY, AI_PROVIDER), changing the
// model or moving the daily limit is an audited change. The key is hidden like any secret: its fingerprint changes, its value is never kept.
const PUBLIC_SETTINGS = ['CORS_ORIGIN', 'JWT_EXPIRY', 'CASE_MANAGER_EMAILS', 'ADMIN_EMAILS', 'DATABASE_SSL', 'AI_PROVIDER', 'AI_MODEL', 'AI_DAILY_LIMIT'];
const HIDDEN_SETTINGS = ['JWT_SECRET', 'DATABASE_PASSWORD', 'DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_NAME', 'DATABASE_USER', 'ANTHROPIC_API_KEY'];
export const TRACKED_SETTINGS = [...PUBLIC_SETTINGS, ...HIDDEN_SETTINGS];
const NOT_SET = '(not set)';
const SALT_ROW = '__salt';

/** What is kept for one setting: the value itself when public, otherwise a salted fingerprint. */
export function storedValue(name: string, value: string | undefined, salt: string): string {
  if (value === undefined || value === '') return NOT_SET;
  if (PUBLIC_SETTINGS.includes(name)) return value;
  return `sha256:${createHash('sha256').update(`${salt}\0${name}\0${value}`).digest('hex')}`;
}

/** Audit details naming each setting that differs from the previous start, or null if none does. */
export function describeChanges(previous: Record<string, string>, current: Record<string, string>): Record<string, unknown> | null {
  // STORY-019: a setting that was never recorded counts as not set, so starting to track one that is not set is not a change
  const changed = Object.keys(current).filter((name) => (previous[name] ?? NOT_SET) !== current[name]);
  if (!changed.length) return null;
  const details: Record<string, unknown> = { via: 'environment at startup', changed };
  for (const name of changed.filter((n) => PUBLIC_SETTINGS.includes(n))) {
    details[name] = `${previous[name] ?? NOT_SET} → ${current[name]}`;
  }
  return details;
}

/**
 * Records the configuration this start runs with, and audits how it differs from the previous start.
 * The first start with this table records a baseline. Runs at startup, like the role sync, so a
 * setting edited on Render (which restarts the service) is recorded when it takes effect.
 */
export async function recordConfigChanges(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await pool.query('INSERT INTO config_state (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [
    SALT_ROW,
    randomBytes(16).toString('hex'),
  ]);
  const rows: { name: string; value: string }[] = (await pool.query('SELECT name, value FROM config_state')).rows;
  const previous = Object.fromEntries(rows.filter((r) => r.name !== SALT_ROW).map((r) => [r.name, r.value]));
  const salt = rows.find((r) => r.name === SALT_ROW)!.value;
  const current = Object.fromEntries(TRACKED_SETTINGS.map((name) => [name, storedValue(name, env[name], salt)]));

  const details = Object.keys(previous).length
    ? describeChanges(previous, current)
    : { via: 'environment at startup', note: 'first record; later starts are compared with it', settings: TRACKED_SETTINGS };
  if (!details) return;

  // Audit first: if saving the new state then fails, the next start reports the change again
  // rather than never reporting it.
  await logAuditEvent(AuditAction.CONFIG_CHANGE, 'system', 'success', { details });
  for (const [name, value] of Object.entries(current)) {
    await pool.query(
      `INSERT INTO config_state (name, value) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
       WHERE config_state.value IS DISTINCT FROM EXCLUDED.value`,
      [name, value]
    );
  }
}

import pool from '../database/connection';
import { inTransaction } from './caseEvents';

// STORY-021 (4): a change of model (as the API reports it) or of the policy documents' version is recorded when it is noticed, so the
// quality trend can show where it happened. The first model or version ever seen is recorded too, as the start of the record.

export type MarkerKind = 'model' | 'corpus';

export interface ChangeMarker {
  id: string;
  kind: MarkerKind;
  from: string | null;
  to: string;
  at: string;
}

// Arbitrary constant so two requests cannot both record the same change
const MARKER_LOCK_ID = 7_018_022;

// What this process last saw, so the common case (nothing changed) costs no query
const lastSeen: Record<MarkerKind, string | null> = { model: null, corpus: null };

/** Test hook: forget what was last seen. */
export function resetMarkerCache(): void {
  lastSeen.model = null;
  lastSeen.corpus = null;
}

/** Records `value` as the current model or corpus version when it differs from the latest recorded one. Returns whether a marker was added. */
export async function noteChange(kind: MarkerKind, value: string | null | undefined, at: Date = new Date()): Promise<boolean> {
  if (!value || lastSeen[kind] === value) return false;
  const added = await inTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [MARKER_LOCK_ID]);
    const latest = (await client.query('SELECT to_value FROM assistant_change_markers WHERE kind = $1 ORDER BY at DESC, id DESC LIMIT 1', [kind])).rows[0];
    if (latest?.to_value === value) return false;
    await client.query('INSERT INTO assistant_change_markers (kind, from_value, to_value, at) VALUES ($1, $2, $3, $4)', [kind, latest?.to_value ?? null, value, at]);
    return true;
  });
  lastSeen[kind] = value;
  return added;
}

/** The markers of the last `days` days, oldest first. */
export async function listMarkers(days: number): Promise<ChangeMarker[]> {
  const result = await pool.query(
    `SELECT id, kind, from_value, to_value, at FROM assistant_change_markers WHERE at >= NOW() - make_interval(days => $1::int) ORDER BY at, id`,
    [days]
  );
  return result.rows.map((r: any) => ({ id: r.id, kind: r.kind, from: r.from_value, to: r.to_value, at: r.at }));
}

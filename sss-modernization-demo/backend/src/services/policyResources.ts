import pool from '../database/connection';
import { ResourceType } from '../security/accessPolicy';

// STORY-016: the attributes of the record a request is about, loaded for the policy to decide on. One small query each. A record
// that does not exist (or an id that is not even shaped like one) comes back as found: false, and the policy lets the request
// through so the route answers 404 as it always has.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CaseAttributes {
  type: 'case';
  found: true;
  owner_id: string;
  /** The user id of the case manager it is assigned to, or null. (A case stores that person's email.) */
  assigned_to: string | null;
  status: string;
  /** An open compliance review is waiting for a second person. */
  under_compliance_review: boolean;
}

export type Resource =
  | { type: ResourceType; found: false }
  | CaseAttributes
  | { type: 'account'; found: true; owner_id: string }
  | { type: 'audit_trail'; found: true; owner_id: string | null };

// A case is assigned by email. An email that matches no account is kept as it is, so the case counts as assigned to someone
// else and never as unassigned.
const CASE = `
  SELECT c.user_id AS owner_id,
         COALESCE((SELECT u.id::text FROM users u WHERE u.email = c.assigned_to LIMIT 1), c.assigned_to) AS assigned_to,
         c.status,
         EXISTS (SELECT 1 FROM compliance_reviews r WHERE r.case_id = c.id AND r.status = 'Open') AS under_compliance_review
  FROM cases c
  WHERE c.id = $1`;

export async function loadResource(type: ResourceType, id: string | undefined): Promise<Resource> {
  if (type === 'audit_trail') {
    // A person's trail always exists; whose it is decides who may read it
    return { type, found: true, owner_id: id ?? null };
  }
  if (!id || !UUID_PATTERN.test(id)) return { type, found: false };

  if (type === 'case') {
    const result = await pool.query(CASE, [id]);
    if (result.rows.length === 0) return { type, found: false };
    const row = result.rows[0];
    return {
      type,
      found: true,
      owner_id: row.owner_id,
      assigned_to: row.assigned_to ?? null,
      status: row.status,
      under_compliance_review: row.under_compliance_review === true,
    };
  }

  const result = await pool.query('SELECT 1 FROM users WHERE id = $1', [id]);
  return result.rows.length === 0 ? { type, found: false } : { type, found: true, owner_id: id };
}

import pool from '../database/connection';
import { BASELINE_ROUTES, LOCKED_ROUTES, PolicyRole, ResourceType, RULES, RuleDefinition, inOrder, isKnownRoute, recordOf } from '../security/accessPolicy';
import { ValidationError } from '../utils/errors';
import { AuditAction, logAuditEvent } from './auditService';
import { inTransaction } from './caseEvents';
import { Decision, EngineInfo, evaluate, loadEngine, setData } from './policyEngine';
import { Resource } from './policyResources';
import { cleanReason } from './roleService';

// STORY-016: the access policy in force. The rules are Rego (policyEngine.ts); what they are given is the code defaults
// (security/accessPolicy.ts) with the newest saved version applied. A version stores only what an administrator changed (which
// rules are on, which routes are limited to fewer roles), so a deploy that adds or changes routes needs no data migration, and
// a saved change takes effect without a deploy.

/** Each process looks for a newer version at most this often, so a change saved on another instance applies within this time. */
export const REFRESH_MS = 5000;
const HISTORY_LENGTH = 20;
// Arbitrary constant so concurrent policy changes are handled one at a time.
const POLICY_LOCK_ID = 7_016_001;
const VERSION_COLUMNS = 'version, rules, route_roles, summary, reason, changed_by, changed_by_email, created_at';

/** What differs from the code defaults: every rule's switch, and the routes limited to fewer roles than the code allows. */
export interface PolicyState {
  rules: Record<string, boolean>;
  routeRoles: Record<string, PolicyRole[]>;
}

export interface PolicyVersion {
  version: number;
  summary: string;
  reason: string | null;
  changedBy: string | null;
  changedAt: string | null;
}

export interface PolicyActor {
  id: string;
  email: string;
}

export interface PolicyQuestion {
  subject: { id: string | null; role: PolicyRole };
  action: 'read' | 'write';
  /** The access-table key, e.g. "GET /api/cases/:id". */
  route: string;
  resource: Resource | null;
}

export interface PolicyDecision extends Decision {
  /** 0 is the code defaults. */
  policyVersion: number;
}

export interface PolicyView {
  engine: EngineInfo;
  current: PolicyVersion;
  rules: (RuleDefinition & { enabled: boolean; defaultEnabled: boolean })[];
  routes: { key: string; method: string; path: string; resource: ResourceType | null; baselineRoles: PolicyRole[]; roles: PolicyRole[]; locked: boolean }[];
  history: PolicyVersion[];
}

export const defaultState = (): PolicyState => ({ rules: Object.fromEntries(RULES.map((rule) => [rule.id, true])), routeRoles: {} });

/**
 * The state a stored version means today. Only switches for rules that still exist count, and a stored route list counts only
 * as far as it narrows what the route allows now: a route or role removed since, or a locked route, is ignored. With no row
 * (or a row that is not a version) it is the code defaults.
 */
function stateFrom(row: any): PolicyState {
  const state = defaultState();
  if (!Number.isInteger(row?.version)) return state;
  for (const rule of RULES) {
    if (typeof row.rules?.[rule.id] === 'boolean') state.rules[rule.id] = row.rules[rule.id];
  }
  for (const [key, entry] of Object.entries(BASELINE_ROUTES)) {
    const stored = row.route_roles?.[key];
    if (LOCKED_ROUTES.has(key) || !Array.isArray(stored)) continue;
    const roles = entry.roles.filter((role) => stored.includes(role));
    if (roles.length > 0 && roles.length < entry.roles.length) state.routeRoles[key] = roles;
  }
  return state;
}

const versionFrom = (row: any): PolicyVersion | null =>
  Number.isInteger(row?.version)
    ? { version: row.version, summary: row.summary, reason: row.reason, changedBy: row.changed_by_email ?? null, changedAt: row.created_at }
    : null;

/** data.routes and data.rules for the policy. */
export function policyData(state: PolicyState) {
  return {
    routes: Object.fromEntries(Object.entries(BASELINE_ROUTES).map(([key, entry]) => [key, { roles: state.routeRoles[key] ?? entry.roles, resource: entry.resource }])),
    rules: RULES.map((rule) => ({ ...rule, enabled: state.rules[rule.id] })),
  };
}

// ---- The policy in force: loaded once, then re-read when another instance saves a newer version

let loaded: { version: PolicyVersion | null; state: PolicyState } | null = null;
let checkedAt = 0;
let pending: Promise<void> | null = null;

async function load(): Promise<void> {
  await loadEngine();
  const row = (await pool.query(`SELECT ${VERSION_COLUMNS} FROM access_policy_versions ORDER BY version DESC LIMIT 1`)).rows[0];
  const state = stateFrom(row);
  setData(policyData(state));
  loaded = { version: versionFrom(row), state };
  checkedAt = Date.now();
}

async function refresh(): Promise<void> {
  checkedAt = Date.now(); // a database that is down is asked again in REFRESH_MS, not by every request
  try {
    const row = (await pool.query('SELECT COALESCE(MAX(version), 0)::int AS version FROM access_policy_versions')).rows[0];
    if ((Number(row?.version) || 0) !== (loaded?.version?.version ?? 0)) await load();
  } catch (error) {
    // Keep enforcing the policy in force rather than stop answering
    console.error('Access policy not refreshed', { message: (error as Error).message });
  }
}

/** Makes sure a policy is loaded and not older than REFRESH_MS; `force` looks now. Requests that arrive while it looks carry on with the policy in force. */
async function current(force = false): Promise<void> {
  if (force && pending) await pending.catch(() => {}); // a read begun before a save may be out of date: let it finish, then read again
  if (!loaded) {
    pending ??= load().finally(() => (pending = null));
    return pending;
  }
  if (!force && Date.now() - checkedAt < REFRESH_MS) return;
  pending ??= refresh().finally(() => (pending = null));
  return pending;
}

/** Loads the compiled policy and the newest saved version. The server does this before it accepts requests; a policy that cannot load stops the start. */
export async function startPolicy(): Promise<void> {
  await current(true);
}

/** Forgets the policy in force, so the next use loads it again (tests). */
export function forgetPolicy(): void {
  loaded = null;
  pending = null;
  checkedAt = 0;
}

/** The policy's answer for one request, and the version of the policy that gave it. */
export async function decide(question: PolicyQuestion): Promise<PolicyDecision> {
  await current();
  // Evaluated straight after the version is read, so the version reported is the one that decided
  return { ...evaluate(question), policyVersion: loaded?.version?.version ?? 0 };
}

/**
 * The kind of record to load before asking, or null when the answer cannot depend on it: the route is not about a record, or it is
 * closed to this role whatever the record is (so a refused caller costs no lookup).
 */
export async function recordToLoad(routeKey: string, role: PolicyRole): Promise<{ type: ResourceType; param: string } | null> {
  const record = recordOf(routeKey);
  if (!record) return null;
  await current();
  const roles = loaded?.state.routeRoles[routeKey] ?? BASELINE_ROUTES[routeKey]?.roles ?? [];
  return roles.includes(role) ? record : null;
}

// ---- Reading the policy

export async function getPolicyView(): Promise<PolicyView> {
  await current(true);
  const { version, state } = loaded!; // taken together: another request may load a newer policy while the history is read
  const history = await pool.query(
    `SELECT version, summary, reason, changed_by_email, created_at FROM access_policy_versions ORDER BY version DESC LIMIT ${HISTORY_LENGTH}`
  );
  return {
    engine: await loadEngine(),
    current: version ?? { version: 0, summary: 'The defaults that come with the code', reason: null, changedBy: null, changedAt: null },
    rules: RULES.map((rule) => ({ ...rule, enabled: state.rules[rule.id], defaultEnabled: true })),
    routes: Object.entries(BASELINE_ROUTES).map(([key, entry]) => {
      const [method, path] = key.split(' ');
      return { key, method, path, resource: entry.resource, baselineRoles: entry.roles, roles: state.routeRoles[key] ?? entry.roles, locked: LOCKED_ROUTES.has(key) };
    }),
    history: history.rows.map(versionFrom).filter((version): version is PolicyVersion => version !== null),
  };
}

// ---- Changing the policy

interface Change {
  rules: Record<string, boolean>;
  routes: Record<string, PolicyRole[]>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks a request to change the policy; anything wrong is a 400 that says what. */
function parseChange(body: any): { reason: string; change: Change } {
  const reason = cleanReason(body?.reason);
  const change: Change = { rules: {}, routes: {} };

  if (body.rules !== undefined && !isObject(body.rules)) throw new ValidationError('rules must map each rule id to true or false.');
  for (const [id, on] of Object.entries(body.rules ?? {})) {
    if (!RULES.some((rule) => rule.id === id)) throw new ValidationError(`Unknown rule: ${id}.`);
    if (typeof on !== 'boolean') throw new ValidationError(`The rule ${id} must be set to true or false.`);
    change.rules[id] = on;
  }

  if (body.routes !== undefined && !isObject(body.routes)) throw new ValidationError('routes must map each route to a list of roles.');
  for (const [key, roles] of Object.entries(body.routes ?? {})) {
    if (!isKnownRoute(key)) throw new ValidationError(`Unknown route: ${key}.`);
    if (LOCKED_ROUTES.has(key)) throw new ValidationError(`${key} is locked: a policy change cannot restrict it.`);
    if (!Array.isArray(roles) || roles.length === 0 || roles.some((role) => typeof role !== 'string')) {
      throw new ValidationError(`Choose at least one role for ${key}.`);
    }
    const allowed = BASELINE_ROUTES[key].roles;
    const outside = roles.filter((role) => !allowed.includes(role as PolicyRole));
    if (outside.length > 0) {
      throw new ValidationError(`${key} cannot allow ${outside.join(', ')}: roles can only be narrowed, never widened beyond what the code allows (${allowed.join(', ')}).`);
    }
    change.routes[key] = inOrder(roles);
  }
  return { reason, change };
}

/** The state after the change. A route given its whole baseline is no longer restricted. */
function applyChange(before: PolicyState, change: Change): PolicyState {
  const after: PolicyState = { rules: { ...before.rules, ...change.rules }, routeRoles: { ...before.routeRoles } };
  for (const [key, roles] of Object.entries(change.routes)) {
    if (roles.length === BASELINE_ROUTES[key].roles.length) delete after.routeRoles[key];
    else after.routeRoles[key] = roles;
  }
  return after;
}

const roleWords = (roles: PolicyRole[]): string => {
  const names = roles.map((role) => role.replace('_', ' '));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
};

/** What a change did, in words, e.g. "case-manager-team turned off; GET /api/cases/export limited to admin". Empty when nothing changed. */
export function summarise(before: PolicyState, after: PolicyState): string {
  const parts: string[] = [];
  for (const rule of RULES) {
    if (before.rules[rule.id] !== after.rules[rule.id]) parts.push(`${rule.id} turned ${after.rules[rule.id] ? 'on' : 'off'}`);
  }
  for (const key of Object.keys(BASELINE_ROUTES)) {
    const was = before.routeRoles[key];
    const now = after.routeRoles[key];
    if (was?.join() === now?.join()) continue;
    parts.push(now ? `${key} limited to ${roleWords(now)}` : `${key} restriction removed`);
  }
  return parts.join('; ');
}

/**
 * Saves a change as a new version, audits it, and applies it in this process at once (other instances within REFRESH_MS).
 * `body` is { rules?: { [id]: boolean }, routes?: { [key]: roles[] }, reason }.
 */
export async function savePolicy(actor: PolicyActor, body: unknown): Promise<PolicyView> {
  const { reason, change } = parseChange(body);

  await inTransaction(async (client) => {
    // One change at a time, each made on the newest version, so two administrators cannot overwrite each other's change
    await client.query('SELECT pg_advisory_xact_lock($1)', [POLICY_LOCK_ID]);
    const latest = (await client.query(`SELECT ${VERSION_COLUMNS} FROM access_policy_versions ORDER BY version DESC LIMIT 1`)).rows[0];
    const before = stateFrom(latest);
    const after = applyChange(before, change);
    const summary = summarise(before, after);
    if (!summary) throw new ValidationError('That would not change the policy: every rule and route already has these settings.');

    const saved = await client.query(
      `INSERT INTO access_policy_versions (rules, route_roles, summary, reason, changed_by, changed_by_email)
       VALUES ($1::jsonb, $2::jsonb, $3, $4, $5, $6) RETURNING version`,
      [JSON.stringify(after.rules), JSON.stringify(after.routeRoles), summary, reason, actor.id, actor.email]
    );
    const version: number = saved.rows[0].version;
    // Written before the commit, so a policy never changes without its audit entry
    await logAuditEvent(AuditAction.POLICY_CHANGE, 'policies', 'success', {
      actor: actor.id,
      actorEmail: actor.email,
      resourceId: String(version),
      details: { version, summary, reason },
    });
  });

  return getPolicyView();
}

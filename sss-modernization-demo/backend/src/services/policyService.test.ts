// STORY-016: the access policy in force and how an administrator changes it. Runs without a database: the mock below keeps the
// access_policy_versions table in memory and answers the statements the service sends, so a statement it does not know fails
// the test instead of passing silently. The policy itself is the real committed WebAssembly.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('./auditService', () => ({ ...jest.requireActual('./auditService'), logAuditEvent: jest.fn() }));

import pool from '../database/connection';
import { BASELINE_ROUTES, LOCKED_ROUTES, RULES } from '../security/accessPolicy';
import { ValidationError } from '../utils/errors';
import { logAuditEvent } from './auditService';
import { CaseAttributes } from './policyResources';
import { REFRESH_MS, decide, defaultState, forgetPolicy, getPolicyView, recordToLoad, savePolicy, startPolicy, summarise } from './policyService';

interface Row {
  version: number;
  rules: Record<string, boolean>;
  route_roles: Record<string, string[]>;
  summary: string;
  reason: string;
  changed_by: string | null;
  changed_by_email: string | null;
  created_at: Date;
}

let versions: Row[] = [];
let statements: string[] = [];

const latest = () => versions[versions.length - 1];
const stored = (version: number, rules: Record<string, boolean>, routeRoles: Record<string, string[]>): Row => ({
  version,
  rules,
  route_roles: routeRoles,
  summary: `Version ${version}`,
  reason: `Reason ${version}`,
  changed_by: 'u-morgan',
  changed_by_email: 'morgan.lee@example.com',
  created_at: new Date(Date.UTC(2026, 9, 14, 9, version)),
});

/** The statements the service sends, answered over the in-memory table. */
async function run(sql: string, params: any[] = []) {
  const text = sql.replace(/\s+/g, ' ').trim();
  statements.push(text);

  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text) || text.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
  if (text.startsWith('SELECT version, rules, route_roles, summary, reason, changed_by, changed_by_email, created_at FROM access_policy_versions ORDER BY version DESC LIMIT 1')) {
    return { rows: versions.length ? [{ ...latest() }] : [] };
  }
  if (text.startsWith('SELECT COALESCE(MAX(version), 0)::int AS version FROM access_policy_versions')) {
    return { rows: [{ version: versions.length ? latest().version : 0 }] };
  }
  if (text.startsWith('SELECT version, summary, reason, changed_by_email, created_at FROM access_policy_versions ORDER BY version DESC LIMIT 20')) {
    return { rows: [...versions].reverse().slice(0, 20).map((row) => ({ ...row })) };
  }
  if (text.startsWith('INSERT INTO access_policy_versions')) {
    const row: Row = {
      version: versions.length + 1,
      rules: JSON.parse(params[0]),
      route_roles: JSON.parse(params[1]),
      summary: params[2],
      reason: params[3],
      changed_by: params[4],
      changed_by_email: params[5],
      created_at: new Date(Date.UTC(2026, 9, 14, 10, versions.length)),
    };
    versions.push(row);
    return { rows: [{ version: row.version }] };
  }
  throw new Error(`unexpected query: ${text}`);
}

const query = pool.query as unknown as jest.Mock;
const connect = pool.connect as unknown as jest.Mock;
const audit = logAuditEvent as jest.Mock;
const asked = (fragment: string) => statements.filter((s) => s.includes(fragment)).length;
const inserted = () => statements.filter((s) => s.startsWith('INSERT INTO access_policy_versions')).length;

const MORGAN = { id: 'u-morgan', email: 'morgan.lee@example.com' };
const ALDER = { id: 'u-alder', role: 'case_manager' as const };
const APPLICANT = { id: 'u-applicant', role: 'citizen' as const };
const aCase = (attributes: Partial<CaseAttributes> = {}): CaseAttributes => ({
  type: 'case',
  found: true,
  owner_id: APPLICANT.id,
  assigned_to: 'u-bishop',
  status: 'In Review',
  under_compliance_review: false,
  ...attributes,
});
const viewCase = (subject: { id: string; role: 'case_manager' | 'citizen' }, resource = aCase()) =>
  decide({ subject, action: 'read', route: 'GET /api/cases/:id', resource });

let clock = 1_000_000;
beforeEach(() => {
  versions = [];
  statements = [];
  forgetPolicy();
  clock = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  audit.mockReset();
  query.mockReset().mockImplementation(run);
  connect.mockReset().mockImplementation(async () => ({ query: jest.fn(run), release: jest.fn() }));
});

afterEach(() => jest.restoreAllMocks());

const failure = async (promise: Promise<unknown>) => promise.then(() => null, (error: Error) => error);

describe('the policy in force', () => {
  it('is the code defaults, version 0, until a version is saved', async () => {
    const view = await getPolicyView();

    expect(view.engine).toMatchObject({ name: 'Open Policy Agent', version: '1.21.0', format: 'WebAssembly' });
    expect(view.engine.wasmSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(view.current).toMatchObject({ version: 0, changedBy: null, changedAt: null, reason: null });
    expect(view.rules.map((rule) => [rule.id, rule.enabled, rule.defaultEnabled])).toEqual(RULES.map((rule) => [rule.id, true, true]));
    expect(view.history).toEqual([]);
    expect(await viewCase(ALDER)).toMatchObject({ allow: true, rule: 'case-manager-team', policyVersion: 0 });
  });

  it('lists every route with its baseline roles, its current roles and whether it is locked', async () => {
    const { routes } = await getPolicyView();

    expect(routes.map((route) => route.key)).toEqual(Object.keys(BASELINE_ROUTES));
    expect(routes.find((route) => route.key === 'GET /api/cases/export')).toEqual({
      key: 'GET /api/cases/export',
      method: 'GET',
      path: '/api/cases/export',
      resource: null,
      baselineRoles: ['case_manager', 'admin'],
      roles: ['case_manager', 'admin'],
      locked: false,
    });
    expect(routes.find((route) => route.key === 'GET /api/cases/:id')).toMatchObject({ resource: 'case', baselineRoles: ['citizen', 'case_manager', 'leadership', 'admin'] });
    expect(routes.filter((route) => route.locked).map((route) => route.key)).toEqual(Object.keys(BASELINE_ROUTES).filter((key) => LOCKED_ROUTES.has(key)));
  });

  it('applies the newest saved version when it loads, and reports which version decided', async () => {
    versions.push(stored(1, { ...defaultState().rules, 'case-manager-team': false }, {}));
    versions.push(stored(2, { ...defaultState().rules, 'case-manager-team': false }, { 'GET /api/cases/export': ['admin'] }));
    await startPolicy();

    expect(await viewCase(ALDER)).toEqual({ allow: false, rule: 'no-matching-rule', reason: 'No rule lets a case manager view a case assigned to someone else', policyVersion: 2 });
    expect(await decide({ subject: ALDER, action: 'read', route: 'GET /api/cases/export', resource: null })).toMatchObject({ allow: false, rule: 'route-roles', policyVersion: 2 });
    const view = await getPolicyView();
    expect(view.current).toEqual({ version: 2, summary: 'Version 2', reason: 'Reason 2', changedBy: 'morgan.lee@example.com', changedAt: new Date(Date.UTC(2026, 9, 14, 9, 2)) });
  });

  it('ignores what the code no longer has, and anything that would not narrow a route', async () => {
    versions.push(
      stored(
        1,
        { 'a-rule-that-was-removed': false, 'case-applicant': 'no' as any },
        {
          'GET /api/a/route/that/was/removed': ['admin'],
          'GET /api/policies': ['citizen'], // locked
          'GET /api/cases/stats': ['citizen', 'admin'], // citizen is not allowed there: only admin is left
          'GET /api/cases/export': ['citizen'], // nothing left that the route allows
          'GET /api/audit': ['case_manager', 'admin'], // the whole baseline
          'GET /api/dashboards/citizen': 'admin' as any,
        }
      )
    );
    await startPolicy();

    const view = await getPolicyView();
    expect(view.rules.every((rule) => rule.enabled)).toBe(true);
    const roles = (key: string) => view.routes.find((route) => route.key === key)?.roles;
    expect(roles('GET /api/policies')).toEqual(['admin']);
    expect(roles('GET /api/cases/stats')).toEqual(['admin']);
    expect(roles('GET /api/cases/export')).toEqual(['case_manager', 'admin']);
    expect(roles('GET /api/audit')).toEqual(['case_manager', 'admin']);
    expect(roles('GET /api/dashboards/citizen')).toEqual(['citizen', 'case_manager', 'leadership', 'admin']);
    expect(view.routes.some((route) => route.key.includes('removed'))).toBe(false);
  });

  it('reads the record only for a role the route lets through', async () => {
    expect(await recordToLoad('GET /api/cases/:id', 'citizen')).toEqual({ type: 'case', param: 'id' });
    expect(await recordToLoad('GET /api/compliance/cases/:caseId', 'case_manager')).toEqual({ type: 'case', param: 'caseId' });
    expect(await recordToLoad('GET /api/compliance/cases/:caseId', 'citizen')).toBeNull(); // a staff route
    expect(await recordToLoad('GET /api/cases/:id', 'anonymous')).toBeNull();
    expect(await recordToLoad('GET /api/cases/stats', 'case_manager')).toBeNull(); // not about a record
    expect(await recordToLoad('GET /api/not-a-route', 'admin')).toBeNull();
  });
});

describe('keeping up with versions saved elsewhere', () => {
  it('looks for a newer version at most every five seconds, and then applies it', async () => {
    await startPolicy();
    expect((await viewCase(ALDER)).policyVersion).toBe(0);
    const asksBefore = asked('MAX(version)');

    // Another instance saves a version
    versions.push(stored(1, { ...defaultState().rules, 'case-manager-team': false }, {}));

    clock += REFRESH_MS - 1;
    expect(await viewCase(ALDER)).toMatchObject({ allow: true, policyVersion: 0 });
    expect(asked('MAX(version)')).toBe(asksBefore); // not yet

    clock += 1;
    expect(await viewCase(ALDER)).toMatchObject({ allow: false, policyVersion: 1 });
    expect(asked('MAX(version)')).toBe(asksBefore + 1);

    clock += REFRESH_MS - 1;
    await viewCase(ALDER);
    expect(asked('MAX(version)')).toBe(asksBefore + 1); // the five seconds start again
  });

  it('reloads only when the version number changed', async () => {
    await startPolicy();
    const loads = () => asked('ORDER BY version DESC LIMIT 1');
    const before = loads();

    clock += REFRESH_MS;
    await viewCase(ALDER);
    expect(loads()).toBe(before);
  });

  it('asks once for requests that arrive together', async () => {
    await startPolicy();
    const asksBefore = asked('MAX(version)');
    clock += REFRESH_MS;

    await Promise.all([1, 2, 3, 4, 5].map(() => viewCase(ALDER)));

    expect(asked('MAX(version)')).toBe(asksBefore + 1);
  });

  it('keeps enforcing the policy in force when the database cannot be read, and asks again in five seconds', async () => {
    versions.push(stored(1, { ...defaultState().rules, 'case-manager-team': false }, {}));
    await startPolicy();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    query.mockImplementation(async () => {
      throw new Error('connection refused');
    });

    clock += REFRESH_MS;
    expect(await viewCase(ALDER)).toMatchObject({ allow: false, policyVersion: 1 });
    expect(error).toHaveBeenCalledWith('Access policy not refreshed', { message: 'connection refused' });

    query.mockClear();
    await viewCase(ALDER);
    expect(query).not.toHaveBeenCalled(); // not on every request
    clock += REFRESH_MS;
    await viewCase(ALDER);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not start without a database', async () => {
    query.mockImplementation(async () => {
      throw new Error('connection refused');
    });

    expect((await failure(startPolicy()))?.message).toBe('connection refused');
    query.mockImplementation(run);
    await startPolicy(); // and tries again when asked
    expect((await viewCase(ALDER)).policyVersion).toBe(0);
  });
});

describe('changing the policy', () => {
  const REASON = 'Case managers should work their own caseload only';

  it('saves a new version with who, why and what changed, audits it, and applies it at once', async () => {
    const view = await savePolicy(MORGAN, { rules: { 'case-manager-team': false }, routes: { 'GET /api/cases/export': ['admin'] }, reason: `  ${REASON}  ` });

    expect(versions).toHaveLength(1);
    expect(latest()).toMatchObject({
      version: 1,
      summary: 'case-manager-team turned off; GET /api/cases/export limited to admin',
      reason: REASON,
      changed_by: 'u-morgan',
      changed_by_email: 'morgan.lee@example.com',
    });
    expect(latest().rules).toEqual({ ...defaultState().rules, 'case-manager-team': false });
    expect(latest().route_roles).toEqual({ 'GET /api/cases/export': ['admin'] });

    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith('POLICY_CHANGE', 'policies', 'success', {
      actor: 'u-morgan',
      actorEmail: 'morgan.lee@example.com',
      resourceId: '1',
      details: { version: 1, summary: 'case-manager-team turned off; GET /api/cases/export limited to admin', reason: REASON },
    });

    // The saving process applies it straight away, with no wait for the refresh
    expect(await viewCase(ALDER)).toMatchObject({ allow: false, policyVersion: 1 });
    expect(await decide({ subject: ALDER, action: 'read', route: 'GET /api/cases/export', resource: null })).toMatchObject({ allow: false });

    // and the answer is what reading gives
    expect(view).toEqual(await getPolicyView());
    expect(view.current).toMatchObject({ version: 1, changedBy: 'morgan.lee@example.com', reason: REASON });
    expect(view.rules.find((rule) => rule.id === 'case-manager-team')).toMatchObject({ enabled: false, defaultEnabled: true });
    expect(view.routes.find((route) => route.key === 'GET /api/cases/export')).toMatchObject({ roles: ['admin'], baselineRoles: ['case_manager', 'admin'] });
    expect(view.history.map((h) => [h.version, h.summary, h.reason, h.changedBy])).toEqual([[1, latest().summary, REASON, 'morgan.lee@example.com']]);
  });

  it('is made on the newest version, under a lock, so two administrators do not overwrite each other', async () => {
    await savePolicy(MORGAN, { rules: { 'case-manager-team': false }, reason: 'First' });
    forgetPolicy(); // a second administrator's instance, which has not seen the first change
    await savePolicy({ id: 'u-riley', email: 'riley.chen@example.com' }, { rules: { 'case-manager-queue': false }, reason: 'Second' });

    expect(latest().rules).toEqual({ ...defaultState().rules, 'case-manager-team': false, 'case-manager-queue': false });
    expect(latest().summary).toBe('case-manager-queue turned off');
    expect(asked('pg_advisory_xact_lock')).toBe(2);
  });

  it('turns a rule back on, and removes a restriction by sending the route its whole baseline', async () => {
    await savePolicy(MORGAN, { rules: { 'case-manager-team': false }, routes: { 'GET /api/cases/export': ['admin'], 'GET /api/audit': ['admin'] }, reason: 'Limit' });
    await savePolicy(MORGAN, { rules: { 'case-manager-team': true }, routes: { 'GET /api/cases/export': ['case_manager', 'admin'] }, reason: 'Restore' });

    expect(latest().summary).toBe('case-manager-team turned on; GET /api/cases/export restriction removed');
    expect(latest().route_roles).toEqual({ 'GET /api/audit': ['admin'] }); // only the routes still restricted are kept
    expect(await viewCase(ALDER)).toMatchObject({ allow: true, policyVersion: 2 });
  });

  it('keeps roles in the standard order and ignores repeats', async () => {
    await savePolicy(MORGAN, { routes: { 'GET /api/dashboards/citizen': ['admin', 'citizen', 'admin'] }, reason: 'Limit' });

    expect(latest().route_roles).toEqual({ 'GET /api/dashboards/citizen': ['citizen', 'admin'] });
    expect(latest().summary).toBe('GET /api/dashboards/citizen limited to citizen and admin');
  });

  it('says what each change did: the rules first, then the routes in the order of the access table', async () => {
    await savePolicy(MORGAN, {
      rules: { 'case-admin': false, 'case-manager-team': false },
      routes: { 'GET /api/audit': ['admin'], 'GET /api/cases/stats': ['admin'] },
      reason: 'Tighten',
    });

    expect(latest().summary).toBe(
      'case-manager-team turned off; case-admin turned off; GET /api/cases/stats limited to admin; GET /api/audit limited to admin'
    );
  });

  describe('is refused with a 400, and writes nothing, when', () => {
    const refused = async (body: unknown, message: string | RegExp) => {
      const error = await failure(savePolicy(MORGAN, body));
      expect(error).toBeInstanceOf(ValidationError);
      expect([(error as ValidationError).statusCode, (error as ValidationError).code]).toEqual([400, 'VALIDATION_ERROR']);
      expect(error?.message).toMatch(message);
      expect(inserted()).toBe(0);
      expect(audit).not.toHaveBeenCalled();
    };

    it('there is no reason, or it is blank, or over 500 characters', async () => {
      await refused({ rules: { 'case-manager-team': false } }, 'A reason is required. It is kept in the audit log.');
      await refused({ rules: { 'case-manager-team': false }, reason: '   ' }, 'A reason is required.');
      await refused({ rules: { 'case-manager-team': false }, reason: 42 }, 'A reason is required.');
      await refused({ rules: { 'case-manager-team': false }, reason: 'x'.repeat(501) }, 'The reason must be 500 characters or less.');
      await refused(undefined, 'A reason is required.');
      expect((await savePolicy(MORGAN, { rules: { 'case-manager-team': false }, reason: 'x'.repeat(500) })).current.version).toBe(1);
    });

    it('a rule is not one the policy has', async () => {
      await refused({ rules: { 'no-such-rule': false }, reason: REASON }, 'Unknown rule: no-such-rule.');
      await refused({ rules: JSON.parse('{"__proto__": false}'), reason: REASON }, 'Unknown rule: __proto__.');
    });

    it('a rule is not set to true or false', async () => {
      await refused({ rules: { 'case-manager-team': 'off' }, reason: REASON }, 'The rule case-manager-team must be set to true or false.');
      await refused({ rules: ['case-manager-team'], reason: REASON }, 'rules must map each rule id to true or false.');
    });

    it('a route is not one the API serves', async () => {
      await refused({ routes: { 'GET /api/no/such/route': ['admin'] }, reason: REASON }, 'Unknown route: GET /api/no/such/route.');
      await refused({ routes: JSON.parse('{"__proto__": ["admin"]}'), reason: REASON }, 'Unknown route: __proto__.');
      await refused({ routes: ['GET /api/audit'], reason: REASON }, 'routes must map each route to a list of roles.');
    });

    it('a route would be widened: a role must be one the code already allows there', async () => {
      await refused(
        { routes: { 'GET /api/audit': ['citizen'] }, reason: REASON },
        'GET /api/audit cannot allow citizen: roles can only be narrowed, never widened beyond what the code allows (case_manager, admin).'
      );
      await refused({ routes: { 'GET /api/audit': ['admin', 'leadership'] }, reason: REASON }, /cannot allow leadership/);
      await refused({ routes: { 'GET /api/dashboards/admin': ['case_manager'] }, reason: REASON }, /cannot allow case_manager/);
      await refused({ routes: { 'GET /api/audit': ['superuser'] }, reason: REASON }, /cannot allow superuser/);
    });

    it('a route is given no role, or something that is not a list of roles', async () => {
      await refused({ routes: { 'GET /api/audit': [] }, reason: REASON }, 'Choose at least one role for GET /api/audit.');
      await refused({ routes: { 'GET /api/audit': 'admin' }, reason: REASON }, 'Choose at least one role for GET /api/audit.');
      await refused({ routes: { 'GET /api/audit': [7] }, reason: REASON }, 'Choose at least one role for GET /api/audit.');
    });

    it.each([...LOCKED_ROUTES])('%s is locked, even when the roles asked for would change nothing', async (key) => {
      await refused({ routes: { [key]: ['admin'] }, reason: REASON }, `${key} is locked: a policy change cannot restrict it.`);
      await refused({ routes: { [key]: BASELINE_ROUTES[key].roles }, reason: REASON }, 'is locked');
    });

    it('the change would change nothing', async () => {
      const nothing = 'That would not change the policy: every rule and route already has these settings.';
      await refused({ reason: REASON }, nothing);
      await refused({ rules: {}, routes: {}, reason: REASON }, nothing);
      await refused({ rules: { 'case-manager-team': true }, reason: REASON }, nothing); // already on
      await refused({ routes: { 'GET /api/audit': ['case_manager', 'admin'] }, reason: REASON }, nothing); // not restricted
    });

    it('the change repeats the last one', async () => {
      await savePolicy(MORGAN, { rules: { 'case-manager-team': false }, routes: { 'GET /api/audit': ['admin'] }, reason: 'Once' });
      const error = await failure(savePolicy(MORGAN, { rules: { 'case-manager-team': false }, routes: { 'GET /api/audit': ['admin'] }, reason: 'Twice' }));
      expect([error?.message, versions.length]).toEqual(['That would not change the policy: every rule and route already has these settings.', 1]);
    });

    it('one part of a change is wrong, so none of it is saved', async () => {
      await refused({ rules: { 'case-manager-team': false }, routes: { 'GET /api/audit': ['citizen'] }, reason: REASON }, /cannot allow citizen/);
      expect(versions).toHaveLength(0);
      expect((await viewCase(ALDER)).allow).toBe(true);
    });
  });

  it('does not keep a version whose audit entry could not be written', async () => {
    audit.mockRejectedValue(new Error('audit unavailable'));
    let committed = true;
    connect.mockImplementation(async () => ({
      query: jest.fn(async (sql: string, params?: any[]) => {
        if (sql === 'ROLLBACK') committed = false;
        return run(sql, params);
      }),
      release: jest.fn(),
    }));

    const error = await failure(savePolicy(MORGAN, { rules: { 'case-manager-team': false }, reason: REASON }));

    expect(error?.message).toBe('audit unavailable');
    expect(committed).toBe(false); // the transaction was rolled back, so the real database discards the row
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });
});

describe('summarise', () => {
  const was = defaultState();

  it('is empty when nothing differs', () => {
    expect(summarise(was, defaultState())).toBe('');
  });

  it('names each difference, rules first and routes in the order of the access table', () => {
    const now = { rules: { ...was.rules, 'case-admin': false, 'case-manager-team': false }, routeRoles: { 'GET /api/cases/export': ['admin' as const], 'GET /api/audit': ['case_manager' as const] } };

    expect(summarise(was, now)).toBe(
      'case-manager-team turned off; case-admin turned off; GET /api/cases/export limited to admin; GET /api/audit limited to case manager'
    );
  });

  it('says "and" for two roles and commas for more', () => {
    const roles = (list: ('citizen' | 'case_manager' | 'leadership' | 'admin')[]) => summarise(was, { rules: was.rules, routeRoles: { 'GET /api/dashboards/citizen': list } });

    expect(roles(['case_manager', 'admin'])).toBe('GET /api/dashboards/citizen limited to case manager and admin');
    expect(roles(['citizen', 'case_manager', 'admin'])).toBe('GET /api/dashboards/citizen limited to citizen, case manager and admin');
  });

  it('reports a restriction that changed, and one that went', () => {
    const before = { rules: was.rules, routeRoles: { 'GET /api/dashboards/citizen': ['citizen' as const, 'admin' as const] } };

    expect(summarise(before, { rules: was.rules, routeRoles: { 'GET /api/dashboards/citizen': ['admin' as const] } })).toBe('GET /api/dashboards/citizen limited to admin');
    expect(summarise(before, was)).toBe('GET /api/dashboards/citizen restriction removed');
  });
});

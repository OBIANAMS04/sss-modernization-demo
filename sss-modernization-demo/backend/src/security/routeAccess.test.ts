// Runs without a database: every protected route must reject a bad or missing token before it
// reaches any query. The only database call allowed is the audit entry each refusal writes
// (STORY-010), which the mock below records.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn().mockResolvedValue({ rows: [{}] }), on: jest.fn() } }));

import request from 'supertest';
import pool from '../database/connection';
import app from '../app';
import { generateToken } from '../utils/jwt';
import { listRoutes } from './listRoutes';
import { ROUTE_ACCESS } from './routeAccess';

const AUTH_GUARDS = ['authMiddleware', 'authenticate'];
const SIGNED_IN_RULES = ['signed-in', 'owner', 'owner-or-staff', 'staff', 'admin', 'leadership'];

const SAMPLE_PARAMS: Record<string, string> = {
  id: '00000000-0000-4000-8000-000000000000',
  caseId: '00000000-0000-4000-8000-000000000000',
  userId: '00000000-0000-4000-8000-000000000000',
  resourceId: '00000000-0000-4000-8000-000000000000',
  requirementId: 'REQ-01',
  resource: 'cases',
  dateStr: '2026-10-01',
};

const routes = listRoutes(app);
const protectedRoutes = routes.filter((r) => SIGNED_IN_RULES.includes(ROUTE_ACCESS[r.key]));

function concretePath(path: string): string {
  return path.replace(/:([A-Za-z]+)/g, (_m, name: string) => SAMPLE_PARAMS[name] ?? 'sample');
}

function call(method: string, path: string) {
  const agent = request(app) as any;
  return agent[method.toLowerCase()](concretePath(path));
}

beforeAll(() => {
  // The error handler logs every rejected request; keep the test output readable.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => jest.restoreAllMocks());

describe('route access rules', () => {
  // Guards against route discovery silently finding nothing, which would make every check below pass.
  it('finds the routes the app serves', () => {
    expect(routes.length).toBeGreaterThanOrEqual(Object.keys(ROUTE_ACCESS).length);
  });

  it('declares an access rule for every route the app serves', () => {
    const undeclared = routes.filter((r) => !(r.key in ROUTE_ACCESS)).map((r) => r.key);
    expect(undeclared).toEqual([]);
  });

  it('has no rules left over for routes that no longer exist', () => {
    const served = new Set(routes.map((r) => r.key));
    expect(Object.keys(ROUTE_ACCESS).filter((key) => !served.has(key))).toEqual([]);
  });

  it.each(routes.map((r) => [r.key, r] as const))('%s has the middleware its rule requires', (_key, route) => {
    const rule = ROUTE_ACCESS[route.key];
    if (rule === 'optional-sign-in') {
      expect(route.guards).toContain('optionalAuthMiddleware');
    }
    if (SIGNED_IN_RULES.includes(rule)) {
      expect(route.guards.some((g) => AUTH_GUARDS.includes(g))).toBe(true);
    }
    if (rule === 'staff') {
      expect(route.guards).toContain('requireStaff');
    }
    if (rule === 'admin' || rule === 'leadership') {
      expect(route.guards).toContain('requireRole');
    }
  });

  it.each(protectedRoutes.map((r) => [r.key, r] as const))('%s returns 401 without a token', async (_key, route) => {
    const res = await call(route.method, route.path);
    expect(res.status).toBe(401);
  });

  it.each(protectedRoutes.map((r) => [r.key, r] as const))(
    '%s returns 401 (not 500) for an invalid token',
    async (_key, route) => {
      const res = await call(route.method, route.path).set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    }
  );

  it('writes an ACCESS_DENIED audit entry for each refusal (STORY-010)', async () => {
    const query = pool.query as unknown as jest.Mock;
    query.mockClear();
    const route = protectedRoutes[0];
    await call(route.method, route.path);
    await new Promise((resolve) => setImmediate(resolve));
    const audit = query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO audit_logs'));
    expect(audit?.[1].slice(0, 4)).toEqual(['ACCESS_DENIED', null, null, route.path.split('/')[2]]);
    expect(audit?.[1][5]).toBe('failure');
  });
});

// STORY-013 to 015: the staff, admin and leadership rules refuse every role they do not name, whoever holds a valid token.
// The mock answers the role lookup (requireStaff, requireRole) with the role under test.
describe('role rules', () => {
  const USER_ID = '00000000-0000-4000-8000-0000000000aa';
  const query = pool.query as unknown as jest.Mock;
  const routesWith = (rule: string) => protectedRoutes.filter((r) => ROUTE_ACCESS[r.key] === rule);
  const staffRoutes = routesWith('staff');
  const adminRoutes = routesWith('admin');
  const leadershipRoutes = routesWith('leadership');

  /** The headers of a signed-in caller whose role in the database is `role`. */
  function signedInAs(role: string) {
    query.mockImplementation(async (sql: string) => (String(sql).startsWith('SELECT role FROM users WHERE id') ? { rows: [{ role }] } : { rows: [{}] }));
    return { Authorization: `Bearer ${generateToken(USER_ID, 'someone@example.com')}` };
  }

  afterEach(() => query.mockReset().mockResolvedValue({ rows: [{}] }));

  // Guards against the filters above silently finding nothing, which would make every check below pass.
  it('finds routes for each of the three rules', () => {
    expect([staffRoutes.length > 0, adminRoutes.length > 0, leadershipRoutes.length > 0]).toEqual([true, true, true]);
    expect(adminRoutes.map((r) => r.key)).toEqual(['GET /api/dashboards/admin']);
    expect(leadershipRoutes.map((r) => r.key)).toEqual(['GET /api/dashboards/leadership']);
  });

  // Leadership reads aggregates and does no case work, so it is refused the staff routes too
  const refused: [string, string, string[]][] = [
    ['citizen', 'a citizen', ['staff', 'admin', 'leadership']],
    ['case_manager', 'a case manager', ['admin', 'leadership']],
    ['leadership', 'a leadership user', ['staff', 'admin']],
  ];
  describe.each(refused)('%s', (role, who, rules) => {
    it.each(rules.flatMap((rule) => routesWith(rule).map((route) => [rule, route.key, route] as const)))(
      `${who} gets 403 on the %s route %s`,
      async (_rule, _key, route) => {
        const res = await call(route.method, route.path).set(signedInAs(role));
        expect(res.status).toBe(403);
      }
    );
  });

  it.each([
    ['an admin', 'admin', [...adminRoutes, ...leadershipRoutes]],
    ['a leadership user', 'leadership', leadershipRoutes],
  ])('%s is not refused on the routes the rules allow them', async (_who, role, allowed) => {
    for (const route of allowed) {
      const res = await call(route.method, route.path).set(signedInAs(role));
      expect([401, 403]).not.toContain(res.status);
    }
  });

  it('reads the role from the database on every request, not from the token', async () => {
    const route = adminRoutes[0];
    const first = await call(route.method, route.path).set(signedInAs('admin'));
    const second = await call(route.method, route.path).set(signedInAs('citizen'));
    expect(first.status).not.toBe(403);
    expect(second.status).toBe(403);
  });

  it('refuses a caller who no longer exists, as a 403', async () => {
    query.mockImplementation(async (sql: string) => (String(sql).startsWith('SELECT role FROM users WHERE id') ? { rows: [] } : { rows: [{}] }));
    const route = adminRoutes[0];
    const res = await call(route.method, route.path).set({ Authorization: `Bearer ${generateToken(USER_ID, 'gone@example.com')}` });
    expect(res.status).toBe(403);
  });

  it('writes an ACCESS_DENIED audit entry naming who was refused (STORY-010)', async () => {
    const route = adminRoutes[0];
    const headers = signedInAs('citizen');
    query.mockClear();
    await call(route.method, route.path).set(headers);
    await new Promise((resolve) => setImmediate(resolve));
    const audit = query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO audit_logs'));
    expect(audit?.[1].slice(0, 4)).toEqual(['ACCESS_DENIED', USER_ID, 'someone@example.com', 'dashboards']);
    expect(JSON.parse(audit?.[1][6])).toMatchObject({ method: 'GET', path: '/api/dashboards/admin', status: 403 });
  });
});

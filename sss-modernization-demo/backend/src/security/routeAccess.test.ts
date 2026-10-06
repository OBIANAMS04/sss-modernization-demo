import request from 'supertest';
import app from '../app';
import { listRoutes } from './listRoutes';
import { ROUTE_ACCESS } from './routeAccess';

// Runs without a database: every protected route must reject a bad or missing token
// before it reaches any query.

const AUTH_GUARDS = ['authMiddleware', 'authenticate'];
const SIGNED_IN_RULES = ['signed-in', 'owner', 'owner-or-staff', 'staff'];

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
  it('finds the routes the app serves', () => {
    expect(routes.length).toBeGreaterThan(40);
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
});

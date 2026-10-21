// STORY-016: the middleware that asks the access policy about every request. Runs without a database: a small app serves a few of
// the real routes (the policy knows them by method and path), the database mock answers the policy's lookups, and the policy is
// the real committed WebAssembly. What the error handler is asked to audit is recorded by a mock.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../services/roleService', () => ({ ...jest.requireActual('../services/roleService'), getUserRole: jest.fn() }));
jest.mock('../services/auditService', () => ({ ...jest.requireActual('../services/auditService'), recordAudit: jest.fn(), logAuditEvent: jest.fn() }));

import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import pool from '../database/connection';
import { recordAudit } from '../services/auditService';
import { forgetPolicy } from '../services/policyService';
import { getUserRole } from '../services/roleService';
import { generatePendingToken, generateToken } from '../utils/jwt';
import { enforcePolicy } from './enforcePolicy';
import { errorHandler } from './errorHandler';

const SECRET = process.env.JWT_SECRET || 'dev_secret_key'; // the same fallback jwt.ts signs with
const CITIZEN = { id: '11111111-1111-4111-8111-111111111111', email: 'citizen@example.com' };
const ALDER = { id: '22222222-2222-4222-8222-222222222222', email: 'alder@example.com' };
const BISHOP = { id: '33333333-3333-4333-8333-333333333333', email: 'bishop@example.com' };
const CASE_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_CASE_ID = '55555555-5555-4555-8555-555555555555';

const query = pool.query as unknown as jest.Mock;
const roleOf = getUserRole as jest.Mock;
const audited = recordAudit as jest.Mock;

let policyVersion: { version: number; rules: Record<string, boolean>; route_roles: Record<string, string[]> } | null;
let caseRows: Record<string, { owner_id: string; assigned_to: string | null; status: string; under_compliance_review: boolean }>;

/** A small app serving some of the real routes; every handler answers { reached: true }. */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(enforcePolicy);
  const reached = (_req: express.Request, res: express.Response) => res.json({ reached: true });
  app.get('/health', reached);
  app.get('/api/dashboards/citizen', reached);
  app.get('/api/dashboards/admin', reached);
  const cases = express.Router();
  cases.get('/export', reached);
  cases.get('/stats', reached);
  cases.get('/:id', reached);
  cases.put('/:id/assignment', reached);
  app.use('/api/cases', cases);
  app.use((_req, res) => res.status(404).json({ error: { message: 'Route not found', code: 'NOT_FOUND' } }));
  app.use(errorHandler);
  return app;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const session = (person = CITIZEN) => bearer(generateToken(person.id, person.email));
const caseQueries = () => query.mock.calls.filter(([sql]) => String(sql).includes('FROM cases c')).length;
/** The details of the audit entry the refusal produced (recordAudit's arguments: action, resource, status, then the entry's options). */
const refusalDetails = () => audited.mock.calls.find(([action]) => action === 'ACCESS_DENIED')?.[3]?.details;

let app: express.Express;

beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterAll(() => jest.restoreAllMocks());

beforeEach(() => {
  policyVersion = null;
  caseRows = {
    [CASE_ID]: { owner_id: CITIZEN.id, assigned_to: BISHOP.id, status: 'In Review', under_compliance_review: false },
    [OTHER_CASE_ID]: { owner_id: BISHOP.id, assigned_to: null, status: 'Submitted', under_compliance_review: true },
  };
  forgetPolicy();
  audited.mockReset();
  roleOf.mockReset().mockImplementation(async (id: string) => ({ [CITIZEN.id]: 'citizen', [ALDER.id]: 'case_manager', [BISHOP.id]: 'case_manager' })[id] ?? null);
  query.mockReset().mockImplementation(async (sql: string, params: string[] = []) => {
    if (sql.includes('FROM access_policy_versions ORDER BY version DESC LIMIT 1')) return { rows: policyVersion ? [{ ...policyVersion }] : [] };
    if (sql.includes('MAX(version)')) return { rows: [{ version: policyVersion?.version ?? 0 }] };
    if (sql.includes('FROM cases c')) return { rows: caseRows[params[0]] ? [caseRows[params[0]]] : [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  app = buildApp();
});

describe('a request that no route serves', () => {
  it('is left alone: a path nobody serves, a method nobody serves, a preflight', async () => {
    expect((await request(app).get('/api/not-a-route')).status).toBe(404);
    expect((await request(app).post('/api/cases/stats').set(session())).status).toBe(404);
    const preflight = await request(app).options('/api/cases/stats'); // Express answers it itself, listing the methods
    expect([preflight.status, preflight.headers.allow]).toEqual([200, 'GET,HEAD']);

    expect(roleOf).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(audited).not.toHaveBeenCalled();
  });
});

describe('a caller who is not signed in', () => {
  it('is refused a signed-in route with the answer the sign-in check gives, and the refusal is audited with the policy\'s reason', async () => {
    const res = await request(app).get('/api/dashboards/citizen');

    expect([res.status, res.body.error]).toEqual([401, { message: 'Missing or invalid authorization header', code: 'UNAUTHORIZED' }]);
    expect(audited).toHaveBeenCalledTimes(1);
    expect(audited.mock.calls[0].slice(0, 3)).toEqual(['ACCESS_DENIED', 'dashboards', 'failure']);
    expect(refusalDetails()).toEqual({
      method: 'GET',
      path: '/api/dashboards/citizen',
      status: 401,
      code: 'UNAUTHORIZED',
      rule: 'route-roles',
      reason: 'Only signed-in people can use this route',
      policyVersion: 0,
    });
    expect(audited.mock.calls[0][3]).toMatchObject({ actor: undefined, actorEmail: undefined });
  });

  it('is refused the same way when the header is not a bearer token', async () => {
    const res = await request(app).get('/api/dashboards/citizen').set('Authorization', 'Basic dXNlcjpwYXNz');

    expect([res.status, res.body.error.message]).toEqual([401, 'Missing or invalid authorization header']);
  });

  it('keeps the message of a token that was refused: expired, signed with another key, or not a session yet', async () => {
    const expired = jwt.sign({ sub: CITIZEN.id, email: CITIZEN.email }, SECRET, { expiresIn: -10 });
    const otherKey = jwt.sign({ sub: CITIZEN.id, email: CITIZEN.email }, 'another-key', { expiresIn: 300 });

    const answers = [];
    for (const token of [expired, otherKey, generatePendingToken(CITIZEN.id, CITIZEN.email), 'not-a-token']) {
      const res = await request(app).get('/api/dashboards/citizen').set(bearer(token));
      answers.push([res.status, res.body.error.code, res.body.error.message]);
    }

    expect(answers).toEqual([
      [401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.'],
      [401, 'UNAUTHORIZED', 'Invalid or malformed token'],
      [401, 'UNAUTHORIZED', 'Sign-in is not finished. Enter your authentication code first.'],
      [401, 'UNAUTHORIZED', 'Invalid or malformed token'],
    ]);
    expect(audited).toHaveBeenCalledTimes(4);
    expect(audited.mock.calls.every(([, , , options]) => options.details.rule === 'route-roles')).toBe(true);
    expect(roleOf).not.toHaveBeenCalled(); // none of them was a session
  });

  it('may still use a public route, whatever token they send', async () => {
    for (const headers of [{}, bearer('not-a-token'), bearer(jwt.sign({ sub: CITIZEN.id }, SECRET, { expiresIn: -10 }))]) {
      const res = await request(app).get('/health').set(headers);
      expect([res.status, res.body]).toEqual([200, { reached: true }]);
    }
    expect(audited).not.toHaveBeenCalled();
  });

  it('is what a person whose account no longer exists is', async () => {
    roleOf.mockResolvedValue(null);

    const res = await request(app).get('/api/dashboards/citizen').set(session());

    expect([res.status, res.body.error.message]).toEqual([401, 'Your session has ended. Please sign in again.']);
    expect(audited.mock.calls[0][3]).toMatchObject({ actor: CITIZEN.id, actorEmail: CITIZEN.email }); // the token still names who tried
  });
});

describe('a signed-in caller the policy refuses', () => {
  it('gets a 403 that says why, and the refusal is audited with who, the rule and the policy version', async () => {
    const res = await request(app).get('/api/cases/stats').set(session());

    expect([res.status, res.body.error]).toEqual([
      403,
      { message: 'Access denied: Only case managers and administrators can use this route', code: 'POLICY_DENIED' },
    ]);
    expect(audited).toHaveBeenCalledTimes(1);
    expect(audited.mock.calls[0].slice(0, 3)).toEqual(['ACCESS_DENIED', 'cases', 'failure']);
    expect(audited.mock.calls[0][3]).toMatchObject({ actor: CITIZEN.id, actorEmail: CITIZEN.email });
    expect(refusalDetails()).toEqual({
      method: 'GET',
      path: '/api/cases/stats',
      status: 403,
      code: 'POLICY_DENIED',
      rule: 'route-roles',
      reason: 'Only case managers and administrators can use this route',
      policyVersion: 0,
    });
  });

  it('is not asked about a record it is refused whatever the record is', async () => {
    await request(app).put(`/api/cases/${CASE_ID}/assignment`).set(session()).send({ assignedTo: null });

    expect(caseQueries()).toBe(0);
  });

  it('reads the role from the database on every request, not from the token', async () => {
    const headers = session(ALDER);
    const statuses: number[] = [];
    for (const role of ['admin', 'citizen', 'case_manager', 'leadership']) {
      roleOf.mockResolvedValue(role);
      statuses.push((await request(app).get('/api/dashboards/admin').set(headers)).status);
    }

    expect(statuses).toEqual([200, 403, 403, 403]);
    expect(roleOf).toHaveBeenCalledTimes(4);
    expect(roleOf).toHaveBeenCalledWith(ALDER.id, expect.any(String)); // STORY-041: with the session id, for the deny list
  });

  it('refuses the request when the policy cannot be asked, rather than let it through', async () => {
    roleOf.mockRejectedValue(new Error('database unavailable'));

    const res = await request(app).get('/api/dashboards/citizen').set(session());

    expect([res.status, res.body.error.code]).toEqual([500, 'INTERNAL_ERROR']);
  });
});

describe('a route that is about a case', () => {
  it('lets the owner and a case manager in, and refuses another citizen with the rule that found no match', async () => {
    const other = { id: '66666666-6666-4666-8666-666666666666', email: 'other@example.com' };
    roleOf.mockImplementation(async (id: string) => (id === ALDER.id ? 'case_manager' : 'citizen'));

    expect((await request(app).get(`/api/cases/${CASE_ID}`).set(session(CITIZEN))).status).toBe(200);
    expect((await request(app).get(`/api/cases/${CASE_ID}`).set(session(ALDER))).status).toBe(200);
    const refused = await request(app).get(`/api/cases/${CASE_ID}`).set(session(other));

    expect([refused.status, refused.body.error.code, refused.body.error.message]).toEqual([
      403,
      'POLICY_DENIED',
      "Access denied: No rule lets a citizen view another person's case",
    ]);
    expect(refusalDetails()).toMatchObject({ rule: 'no-matching-rule', policyVersion: 0, status: 403, path: `/api/cases/${CASE_ID}` });
  });

  it('lets the request through when there is no such case, or the id is not an id, so the route answers 404 itself', async () => {
    expect((await request(app).get('/api/cases/00000000-0000-4000-8000-000000000000').set(session())).body).toEqual({ reached: true });
    const looked = caseQueries();
    expect((await request(app).get('/api/cases/not-a-uuid').set(session())).body).toEqual({ reached: true });
    expect(caseQueries()).toBe(looked); // an id that is not an id is not looked up
    expect(audited).not.toHaveBeenCalled();
  });

  it('matches routes the way Express does: any case, a trailing slash, and the first route in the order they are declared', async () => {
    expect((await request(app).get('/API/Cases/Stats/').set(session())).status).toBe(403); // not a way round the policy
    expect((await request(app).get('/api/cases/export').set(session())).body.error.message).toBe('Access denied: Only case managers and administrators can use this route');
    expect(caseQueries()).toBe(0); // /export is its own route, not a case called "export"
  });

  it('treats HEAD as a read, as Express does', async () => {
    expect((await request(app).head('/api/dashboards/citizen')).status).toBe(401);
    expect((await request(app).head('/api/dashboards/citizen').set(session())).status).toBe(200);
  });

  it('tells a read from a write, and applies the version of the policy saved by an administrator', async () => {
    // Version 3: the team rule is off, so a case manager has only their own work, the queue and reviews
    policyVersion = { version: 3, rules: { 'case-manager-team': false }, route_roles: {} };
    roleOf.mockResolvedValue('case_manager');
    const waiting = OTHER_CASE_ID; // Bishop's case, waiting for a compliance review
    caseRows[waiting] = { owner_id: BISHOP.id, assigned_to: BISHOP.id, status: 'In Review', under_compliance_review: true };

    const read = await request(app).get(`/api/cases/${waiting}`).set(session(ALDER));
    const write = await request(app).put(`/api/cases/${waiting}/assignment`).set(session(ALDER)).send({});
    const theirs = await request(app).get(`/api/cases/${CASE_ID}`).set(session(ALDER));

    expect([read.status, write.status, theirs.status]).toEqual([200, 403, 403]);
    expect(write.body.error.message).toBe('Access denied: No rule lets a case manager work a case assigned to someone else');
    expect(refusalDetails()).toMatchObject({ rule: 'no-matching-rule', policyVersion: 3 });
  });
});

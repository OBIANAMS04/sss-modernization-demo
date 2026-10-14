// STORY-011 (WCAG 2.2.1): a person warned that their session is about to end can extend it.
// Runs without a database: the database calls are the audit entry each request may write, which the mock below records, and
// the role lookup of the access policy (STORY-016), which it answers with a citizen.
jest.mock('../database/connection', () => ({
  __esModule: true,
  default: {
    query: jest.fn(async (sql: string) => ({ rows: [String(sql).startsWith('SELECT role FROM users WHERE id') ? { role: 'citizen' } : {}] })),
    on: jest.fn(),
  },
}));

import jwt from 'jsonwebtoken';
import request from 'supertest';
import pool from '../database/connection';
import app from '../app';
import { decodeToken, generateToken, MAX_SESSION_SECONDS } from '../utils/jwt';

const SECRET = process.env.JWT_SECRET || 'dev_secret_key'; // the same fallback jwt.ts signs with
const USER = 'user-1';
const EMAIL = 'person@example.com';

const now = () => Math.floor(Date.now() / 1000);

function refresh(token?: string) {
  const req = request(app).post('/api/auth/refresh');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

/** The INSERT parameters of each audit entry written so far: action, actor, actor email, resource, resource id, status. */
function auditEntries(): unknown[][] {
  const query = pool.query as unknown as jest.Mock;
  return query.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO audit_logs')).map(([, params]) => params.slice(0, 6));
}

const settle = () => new Promise((resolve) => setImmediate(resolve)); // audit entries are written after the response

beforeAll(() => {
  // The error handler logs every rejected request; keep the test output readable.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => (pool.query as unknown as jest.Mock).mockClear());

afterAll(() => jest.restoreAllMocks());

describe('generateToken', () => {
  it('stamps a new token with the time of sign-in', () => {
    const before = now();
    const token = decodeToken(generateToken(USER, EMAIL))!;
    expect(token.auth_time).toBeGreaterThanOrEqual(before);
    expect(token.auth_time).toBeLessThanOrEqual(now());
  });

  it('keeps the sign-in time it is given', () => {
    expect(decodeToken(generateToken(USER, EMAIL, 1_700_000_000))!.auth_time).toBe(1_700_000_000);
  });
});

describe('POST /api/auth/refresh', () => {
  it('issues a new token for the same person, with the original sign-in time and a later expiry', async () => {
    const signedInAt = now() - 2 * 3600;
    const original = generateToken(USER, EMAIL, signedInAt);

    const res = await refresh(original);

    expect(res.status).toBe(200);
    const before = decodeToken(original)!;
    const after = decodeToken(res.body.token)!;
    expect([after.sub, after.email, after.auth_time]).toEqual([USER, EMAIL, signedInAt]);
    expect(after.exp).toBeGreaterThanOrEqual(before.exp);
  });

  it('can be repeated, and every token keeps the original sign-in time', async () => {
    const signedInAt = now() - 3600;
    let token = generateToken(USER, EMAIL, signedInAt);
    for (let i = 0; i < 3; i++) {
      const res = await refresh(token);
      expect(res.status).toBe(200);
      token = res.body.token;
    }
    expect(decodeToken(token)!.auth_time).toBe(signedInAt);
  });

  it('refuses once the original sign-in is more than 12 hours old', async () => {
    const res = await refresh(generateToken(USER, EMAIL, now() - (MAX_SESSION_SECONDS + 3600)));

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({ message: 'Your session has reached its maximum length. Please sign in again.', code: 'UNAUTHORIZED' });
  });

  it('still extends a session that is just inside the 12 hours, but only up to the 12 hours', async () => {
    const authTime = now() - (MAX_SESSION_SECONDS - 60);

    const res = await refresh(generateToken(USER, EMAIL, authTime));

    expect(res.status).toBe(200);
    expect(decodeToken(res.body.token)!.exp).toBeLessThanOrEqual(authTime + MAX_SESSION_SECONDS);
  });

  it('counts from when the token was issued if it has no sign-in time (issued before this change)', async () => {
    const legacy = jwt.sign({ sub: USER, email: EMAIL }, SECRET, { expiresIn: 3600 });

    const res = await refresh(legacy);

    expect(res.status).toBe(200);
    expect(decodeToken(res.body.token)!.auth_time).toBe(decodeToken(legacy)!.iat);
  });

  it('refuses a request with no token', async () => {
    expect((await refresh()).status).toBe(401);
  });

  it('refuses a token that has already expired', async () => {
    const res = await refresh(jwt.sign({ sub: USER, email: EMAIL }, SECRET, { expiresIn: -10 }));

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Your session has expired. Please sign in again.');
  });

  it('records an extension in the audit log, and a refusal as a refusal instead', async () => {
    await refresh(generateToken(USER, EMAIL));
    await settle();
    expect(auditEntries()).toEqual([['SESSION_EXTEND', USER, EMAIL, 'auth', USER, 'success']]);

    (pool.query as unknown as jest.Mock).mockClear();
    await refresh(generateToken(USER, EMAIL, now() - (MAX_SESSION_SECONDS + 3600)));
    await settle();
    expect(auditEntries().map((entry) => entry[0])).toEqual(['ACCESS_DENIED']);
  });
});

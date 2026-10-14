// STORY-003: two-step verification over HTTP. Runs without a database: the pool mock answers the password check and
// records the audit entries each request writes, and the code check itself (mfaService, tested on its own) is mocked, so
// these tests are about the routes: the pending sign-in token, what is returned, what is refused, and what is audited.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn(), on: jest.fn() } }));
jest.mock('../services/mfaService', () => ({
  ...jest.requireActual('../services/mfaService'),
  generateMFASecret: jest.fn(),
  verifyAndEnableMFA: jest.fn(),
  verifyMFACode: jest.fn(),
  verifySignInCode: jest.fn(),
  disableMFA: jest.fn(),
  isMFAEnabled: jest.fn(),
}));

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import pool from '../database/connection';
import app from '../app';
import { authenticate } from '../middleware/authenticate';
import { listRoutes } from '../security/listRoutes';
import { ROUTE_ACCESS } from '../security/routeAccess';
import { CodeRefusedError, disableMFA, generateMFASecret, isMFAEnabled, verifyAndEnableMFA, verifyMFACode, verifySignInCode } from '../services/mfaService';
import { AppError, ConflictError } from '../utils/errors';
import { decodeToken, generatePendingToken, generateToken, PENDING_MFA_SECONDS, verifyPendingToken, verifyToken } from '../utils/jwt';

const SECRET_KEY = process.env.JWT_SECRET || 'dev_secret_key'; // the same fallback jwt.ts signs with
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'person@example.com' };
const PASSWORD = 'Str0ng!Passw0rd';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
const KEY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // what an authenticator app holds: must never reach the audit log
const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPQ';
const RIGHT = '482913';
const WRONG = '735210';

const query = pool.query as unknown as jest.Mock;
const asMock = (fn: unknown) => fn as jest.Mock;
const settle = () => new Promise((resolve) => setImmediate(resolve)); // audit entries are written after the response
const now = () => Math.floor(Date.now() / 1000);

let account: { mfa_enabled: boolean };

const pending = () => generatePendingToken(USER.id, USER.email);
const session = (authTime?: number) => generateToken(USER.id, USER.email, authTime);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** The audit entries written so far: action, actor, status and details (the INSERT's parameters, after sanitising). */
async function audits() {
  await settle();
  return query.mock.calls
    .filter(([sql]) => String(sql).startsWith('INSERT INTO audit_logs'))
    .map(([, p]) => ({ action: p[0], actor: p[1], email: p[2], resource: p[3], resourceId: p[4], status: p[5], details: p[6] ? JSON.parse(p[6]) : null }));
}
const actions = async () => (await audits()).map((a) => `${a.action}:${a.status}`);

beforeAll(() => {
  // The error handler logs every rejected request; keep the test output readable.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  account = { mfa_enabled: true };
  query.mockReset().mockImplementation(async (sql: string) =>
    String(sql).startsWith('SELECT id, email, password_hash')
      ? { rows: [{ id: USER.id, email: USER.email, password_hash: PASSWORD_HASH, full_name: 'Person One', role: 'citizen', mfa_enabled: account.mfa_enabled, created_at: '2026-10-01T09:00:00.000Z' }] }
      : { rows: [{}] }
  );
  [generateMFASecret, verifyAndEnableMFA, verifyMFACode, verifySignInCode, disableMFA, isMFAEnabled].forEach((fn) => asMock(fn).mockReset());
});

afterAll(() => jest.restoreAllMocks());

const login = (password = PASSWORD) => request(app).post('/api/auth/login').send({ email: USER.email, password });
const verifyCode = (body: object) => request(app).post('/api/auth/mfa/verify').send(body);

describe('signing in with two-step verification on', () => {
  it('answers a correct password with a pending token and no session', async () => {
    const res = await login();

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['expiresIn', 'mfaRequired', 'pendingToken']);
    expect([res.body.mfaRequired, res.body.expiresIn]).toEqual([true, PENDING_MFA_SECONDS]);
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).not.toHaveProperty('user'); // nothing about the person (name, role) before the second factor
  });

  it('makes the pending token a five-minute token that says what it is for, with an id for counting tries', async () => {
    const claims = decodeToken((await login()).body.pendingToken)!;

    expect(claims.purpose).toBe('mfa');
    expect([claims.sub, claims.email]).toEqual([USER.id, USER.email]);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.exp - claims.iat).toBe(300);
    expect(claims).not.toHaveProperty('auth_time'); // the sign-in time belongs to the session, issued after the code
  });

  it('gives each sign-in its own pending token id', async () => {
    const ids = await Promise.all([login(), login()]).then((r) => r.map((x) => decodeToken(x.body.pendingToken)!.jti));
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('records the code request, and no sign-in yet', async () => {
    await login();

    expect(await audits()).toEqual([
      { action: 'MFA_CHALLENGE', actor: USER.id, email: USER.email, resource: 'mfa', resourceId: USER.id, status: 'success', details: { via: 'sign-in' } },
    ]);
  });

  it('still refuses a wrong password, and records it as a failed sign-in', async () => {
    const res = await login('Wrong-Passw0rd!');

    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('pendingToken');
    expect(await actions()).toEqual(['USER_LOGIN:failure']);
  });

  it('is unchanged for an account without it: a session, as before', async () => {
    account.mfa_enabled = false;

    const res = await login();

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['token', 'user']);
    const claims = decodeToken(res.body.token)!;
    expect(claims.auth_time).toBeGreaterThan(0);
    expect(claims).not.toHaveProperty('purpose');
    expect(await actions()).toEqual(['USER_LOGIN:success']);
  });
});

describe('the pending token is not a session', () => {
  const protectedRoutes = listRoutes(app).filter((r) => ROUTE_ACCESS[r.key] && !['public', 'optional-sign-in'].includes(ROUTE_ACCESS[r.key]));
  const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');

  it('is refused by verifyToken, the one place a session is accepted, and is accepted only by verifyPendingToken', () => {
    const token = pending();

    expect(() => verifyToken(token)).toThrow(expect.objectContaining({ statusCode: 401, message: 'Sign-in is not finished. Enter your authentication code first.' }));
    expect(verifyPendingToken(token)).toEqual({ sub: USER.id, email: USER.email, jti: decodeToken(token)!.jti });
  });

  it('is refused by the authenticate middleware, which sets no user', () => {
    const req: any = { headers: { authorization: `Bearer ${pending()}` } };
    const next = jest.fn();

    authenticate(req, {} as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    expect(req.user).toBeUndefined();
  });

  it('cannot be traded for a session at /auth/refresh', async () => {
    const res = await request(app).post('/api/auth/refresh').set(bearer(pending()));

    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('token');
    expect(await actions()).toEqual(['ACCESS_DENIED:failure']); // refused and recorded as such, not as SESSION_EXTEND
  });

  it('finds routes to check (a guard against route discovery silently finding nothing)', () => {
    expect(protectedRoutes.length).toBeGreaterThan(30);
  });

  it.each(protectedRoutes.map((r) => [r.key, r] as const))('%s refuses it with 401', async (_key, route) => {
    const res = await (request(app) as any)[route.method.toLowerCase()](concrete(route.path)).set(bearer(pending()));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('turns nothing on or off, whatever the route would have done', async () => {
    await request(app).post('/api/mfa/disable').set(bearer(pending())).send({ totpCode: RIGHT });
    await request(app).post('/api/mfa/verify').set(bearer(pending())).send({ totpCode: RIGHT });
    await request(app).post('/api/mfa/setup').set(bearer(pending()));

    expect([verifyMFACode, disableMFA, verifyAndEnableMFA, generateMFASecret].map((fn) => asMock(fn).mock.calls.length)).toEqual([0, 0, 0, 0]);
  });

  it('is not a pending token when it is really a session', async () => {
    const res = await verifyCode({ pendingToken: session(), code: RIGHT });

    expect(res.status).toBe(401);
    expect(asMock(verifySignInCode)).not.toHaveBeenCalled();
  });

  it('is refused when it has expired, with a message that says so', async () => {
    const expired = jwt.sign({ sub: USER.id, email: USER.email, purpose: 'mfa' }, SECRET_KEY, { expiresIn: -10, jwtid: 'abc' });

    const res = await verifyCode({ pendingToken: expired, code: RIGHT });

    expect([res.status, res.body.error.message]).toEqual([401, 'Your sign-in timed out. Please sign in again.']);
    expect(asMock(verifySignInCode)).not.toHaveBeenCalled();
  });

  it('is not accepted by either check when the token was made for another purpose', async () => {
    const other = jwt.sign({ sub: USER.id, email: USER.email, purpose: 'password-reset' }, SECRET_KEY, { expiresIn: 300, jwtid: 'abc' });

    expect(() => verifyPendingToken(other)).toThrow(expect.objectContaining({ statusCode: 401 }));
    expect(() => verifyToken(other)).toThrow(expect.objectContaining({ statusCode: 401 })); // any purpose, not only 'mfa'
    expect((await verifyCode({ pendingToken: other, code: RIGHT })).status).toBe(401);
    expect((await request(app).get('/api/mfa/status').set(bearer(other))).status).toBe(401);
  });

  it('is refused when it has no id, or is signed with another key, or is not a token at all', async () => {
    const noId = jwt.sign({ sub: USER.id, email: USER.email, purpose: 'mfa' }, SECRET_KEY, { expiresIn: 300 });
    const otherKey = jwt.sign({ sub: USER.id, email: USER.email, purpose: 'mfa' }, 'another-key', { expiresIn: 300, jwtid: 'abc' });

    for (const pendingToken of [noId, otherKey, 'not-a-token']) {
      expect((await verifyCode({ pendingToken, code: RIGHT })).status).toBe(401);
    }
    expect(asMock(verifySignInCode)).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/mfa/verify (the code, after the password)', () => {
  const signedInAs = { id: USER.id, email: USER.email, fullName: 'Person One', createdAt: '2026-10-01T09:00:00.000Z', role: 'citizen' };

  it('issues a session shaped like a password login when the code is right', async () => {
    asMock(verifySignInCode).mockResolvedValue(signedInAs);
    const token = pending();

    const res = await verifyCode({ pendingToken: token, code: RIGHT });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['token', 'user']);
    expect(res.body.user).toEqual(signedInAs);
    const claims = decodeToken(res.body.token)!;
    expect([claims.sub, claims.email]).toEqual([USER.id, USER.email]);
    expect(claims.auth_time).toBeGreaterThanOrEqual(now() - 2);
    expect(claims.auth_time).toBeLessThanOrEqual(now());
    const usual = decodeToken(session())!; // lasts as long as any session
    expect(claims.exp - claims.iat).toBe(usual.exp - usual.iat);
    expect(claims).not.toHaveProperty('purpose');
    expect(claims).not.toHaveProperty('jti');
    expect(asMock(verifySignInCode)).toHaveBeenCalledWith({ sub: USER.id, email: USER.email, jti: decodeToken(token)!.jti }, RIGHT);
  });

  it('gives a session that works everywhere a session does', async () => {
    asMock(verifySignInCode).mockResolvedValue(signedInAs);
    asMock(isMFAEnabled).mockResolvedValue(true);
    const { token } = (await verifyCode({ pendingToken: pending(), code: RIGHT })).body;

    expect((await request(app).post('/api/auth/refresh').set(bearer(token))).status).toBe(200);
    const status = await request(app).get('/api/mfa/status').set(bearer(token));
    expect([status.status, status.body]).toEqual([200, { mfaEnabled: true }]);
  });

  it('records the code as verified and the person as signed in', async () => {
    asMock(verifySignInCode).mockResolvedValue(signedInAs);

    await verifyCode({ pendingToken: pending(), code: RIGHT });

    expect(await audits()).toEqual([
      { action: 'MFA_VERIFIED', actor: USER.id, email: USER.email, resource: 'mfa', resourceId: USER.id, status: 'success', details: { via: 'sign-in' } },
      { action: 'USER_LOGIN', actor: USER.id, email: USER.email, resource: 'auth', resourceId: USER.id, status: 'success', details: { mfa: true } },
    ]);
  });

  it('refuses a wrong code with how many tries are left, issues no session, and records the failure with the try number', async () => {
    asMock(verifySignInCode).mockRejectedValue(new CodeRefusedError(400, 'That code is not correct. 4 tries left.', 'INVALID_CODE', 1));

    const res = await verifyCode({ pendingToken: pending(), code: WRONG });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { message: 'That code is not correct. 4 tries left.', code: 'INVALID_CODE' } });
    expect(await audits()).toEqual([
      { action: 'MFA_VERIFY_FAILED', actor: USER.id, email: USER.email, resource: 'mfa', resourceId: USER.id, status: 'failure', details: { via: 'sign-in', reason: 'INVALID_CODE', attempt: 1 } },
    ]);
  });

  it('ends the sign-in with 429 when the tries are used up, and records it', async () => {
    asMock(verifySignInCode).mockRejectedValue(new CodeRefusedError(429, 'Too many incorrect codes. Please sign in again.', 'TOO_MANY_ATTEMPTS', 5));

    const res = await verifyCode({ pendingToken: pending(), code: WRONG });

    expect([res.status, res.body.error.code]).toEqual([429, 'TOO_MANY_ATTEMPTS']);
    expect(res.body).not.toHaveProperty('token');
    expect((await audits())[0]).toMatchObject({ action: 'MFA_VERIFY_FAILED', details: { reason: 'TOO_MANY_ATTEMPTS', attempt: 5 } });
  });

  it('does not check, or count, a code that is not six digits', async () => {
    for (const code of ['12345', '1234567', 'abcdef', '123 456', '', 123456, null, undefined]) {
      const res = await verifyCode({ pendingToken: pending(), code });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(asMock(verifySignInCode)).not.toHaveBeenCalled();
    expect(await actions()).toEqual([]);
  });

  it('asks for the token when there is none', async () => {
    for (const body of [{}, { code: RIGHT }, { pendingToken: '', code: RIGHT }, { pendingToken: 5, code: RIGHT }]) {
      expect((await verifyCode(body)).status).toBe(400);
    }
    expect(asMock(verifySignInCode)).not.toHaveBeenCalled();
  });

  it('records a refused token as an access denial, not as an MFA failure (nobody is known)', async () => {
    await verifyCode({ pendingToken: 'not-a-token', code: RIGHT });

    expect(await actions()).toEqual(['ACCESS_DENIED:failure']);
  });

  it('does not answer a server fault as a wrong code', async () => {
    asMock(verifySignInCode).mockRejectedValue(new Error('connection lost'));

    const res = await verifyCode({ pendingToken: pending(), code: RIGHT });

    expect(res.status).toBe(500);
    expect(await actions()).toEqual([]);
  });
});

describe('setting up and turning two-step verification on and off (signed in)', () => {
  const authTime = now() - 120;
  const budget = `session:${USER.id}:${authTime}`;
  const token = () => session(authTime);

  it('setup returns the key, its address and the QR code, and is never cached', async () => {
    asMock(generateMFASecret).mockResolvedValue({ secret: KEY, otpauthUrl: `otpauth://totp/x?secret=${KEY}`, qrCode: QR });

    const res = await request(app).post('/api/mfa/setup').set(bearer(token()));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ secret: KEY, otpauthUrl: `otpauth://totp/x?secret=${KEY}`, qrCode: QR });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(asMock(generateMFASecret)).toHaveBeenCalledWith(USER.id, USER.email);
    expect(await audits()).toEqual([
      { action: 'MFA_SETUP', actor: USER.id, email: USER.email, resource: 'mfa', resourceId: USER.id, status: 'success', details: null },
    ]);
  });

  it('setup is refused while two-step verification is on, and not recorded as a setup', async () => {
    asMock(generateMFASecret).mockRejectedValue(new ConflictError('Two-step verification is already on.'));

    const res = await request(app).post('/api/mfa/setup').set(bearer(token()));

    expect(res.status).toBe(409);
    expect(res.body).not.toHaveProperty('secret');
    expect(await actions()).toEqual([]);
  });

  it('confirming checks the code against the stored key, not a key from the request, and records it as enabling', async () => {
    asMock(verifyAndEnableMFA).mockResolvedValue(undefined);

    const res = await request(app).post('/api/mfa/verify').set(bearer(token())).send({ secret: 'A-KEY-THE-CLIENT-MADE-UP', totpCode: RIGHT });

    expect([res.status, res.body.success]).toEqual([200, true]);
    expect(asMock(verifyAndEnableMFA).mock.calls).toEqual([[USER.id, RIGHT, budget]]);
    expect(await actions()).toEqual(['MFA_ENABLE:success']);
  });

  it('confirming with a wrong code is refused, and recorded as a failed verification with its reason', async () => {
    asMock(verifyAndEnableMFA).mockRejectedValue(new CodeRefusedError(400, 'That code is not correct. 4 tries left.', 'INVALID_CODE', 1));

    const res = await request(app).post('/api/mfa/verify').set(bearer(token())).send({ totpCode: WRONG });

    expect([res.status, res.body.error.code]).toEqual([400, 'INVALID_CODE']);
    expect(await audits()).toEqual([
      { action: 'MFA_VERIFY_FAILED', actor: USER.id, email: USER.email, resource: 'mfa', resourceId: USER.id, status: 'failure', details: { via: 'setup', reason: 'INVALID_CODE', attempt: 1 } },
    ]);
  });

  it('refuses a code that is not six digits before any check, and does not record it as a failed verification', async () => {
    asMock(isMFAEnabled).mockResolvedValue(true);
    for (const body of [{}, { totpCode: '12345' }, { totpCode: 'abcdef' }, { totpCode: 123456 }]) {
      expect((await request(app).post('/api/mfa/verify').set(bearer(token())).send(body)).status).toBe(400);
      expect((await request(app).post('/api/mfa/disable').set(bearer(token())).send(body)).status).toBe(400);
    }
    expect(asMock(verifyAndEnableMFA)).not.toHaveBeenCalled();
    expect(asMock(verifyMFACode)).not.toHaveBeenCalled();
    expect(await actions()).toEqual([]);
  });

  it('turning it off needs a current code, then removes the device, and is recorded', async () => {
    asMock(isMFAEnabled).mockResolvedValue(true);
    asMock(verifyMFACode).mockResolvedValue(undefined);
    asMock(disableMFA).mockResolvedValue(undefined);

    const res = await request(app).post('/api/mfa/disable').set(bearer(token())).send({ totpCode: RIGHT });

    expect([res.status, res.body.success]).toEqual([200, true]);
    expect(asMock(verifyMFACode).mock.calls).toEqual([[USER.id, RIGHT, budget]]);
    expect(asMock(disableMFA).mock.calls).toEqual([[USER.id]]);
    expect(await actions()).toEqual(['MFA_DISABLE:success']);
  });

  it('turning it off with a wrong code does nothing, and is recorded as a failed verification', async () => {
    asMock(isMFAEnabled).mockResolvedValue(true);
    asMock(verifyMFACode).mockRejectedValue(new CodeRefusedError(400, 'That code is not correct. 4 tries left.', 'INVALID_CODE', 1));

    const res = await request(app).post('/api/mfa/disable').set(bearer(token())).send({ totpCode: WRONG });

    expect(res.status).toBe(400);
    expect(asMock(disableMFA)).not.toHaveBeenCalled();
    expect(await audits()).toEqual([
      { action: 'MFA_VERIFY_FAILED', actor: USER.id, email: USER.email, resource: 'mfa', resourceId: USER.id, status: 'failure', details: { via: 'disable', reason: 'INVALID_CODE', attempt: 1 } },
    ]);
  });

  it('says so when there is nothing to turn off', async () => {
    asMock(isMFAEnabled).mockResolvedValue(false);

    const res = await request(app).post('/api/mfa/disable').set(bearer(token())).send({ totpCode: RIGHT });

    expect(res.status).toBe(409);
    expect(asMock(verifyMFACode)).not.toHaveBeenCalled();
  });

  it('counts a session extended with /auth/refresh as the same session, and a new sign-in as a new one', async () => {
    asMock(verifyAndEnableMFA).mockResolvedValue(undefined);
    const extended = (await request(app).post('/api/auth/refresh').set(bearer(token()))).body.token;
    const signedInAgain = session(now());

    await request(app).post('/api/mfa/verify').set(bearer(extended)).send({ totpCode: RIGHT });
    await request(app).post('/api/mfa/verify').set(bearer(signedInAgain)).send({ totpCode: RIGHT });

    const budgets = asMock(verifyAndEnableMFA).mock.calls.map((call) => call[2]);
    expect(budgets[0]).toBe(budget);
    expect(budgets[1]).not.toBe(budget);
  });

  it('reports only whether it is on', async () => {
    asMock(isMFAEnabled).mockResolvedValue(true);

    const res = await request(app).get('/api/mfa/status').set(bearer(token()));

    expect(res.body).toEqual({ mfaEnabled: true });
  });

  it('no longer has the old sign-in check behind a session: that is /auth/mfa/verify', async () => {
    expect((await request(app).post('/api/mfa/verify-code').set(bearer(token())).send({ totpCode: RIGHT })).status).toBe(404);
  });
});

describe('what the audit log keeps', () => {
  it('holds no key, QR code, code or token in any entry, whatever happened', async () => {
    const pendingToken = pending();
    const sessionToken = session();
    asMock(generateMFASecret).mockResolvedValue({ secret: KEY, otpauthUrl: `otpauth://totp/x?secret=${KEY}`, qrCode: QR });
    asMock(verifyAndEnableMFA).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new CodeRefusedError(400, 'no', 'INVALID_CODE', 2));
    asMock(isMFAEnabled).mockResolvedValue(true);
    asMock(verifyMFACode).mockRejectedValue(new CodeRefusedError(400, 'no', 'CODE_ALREADY_USED', 3));
    asMock(verifySignInCode)
      .mockResolvedValueOnce({ id: USER.id, email: USER.email, fullName: 'Person One', createdAt: 'x', role: 'citizen' })
      .mockRejectedValueOnce(new CodeRefusedError(400, 'no', 'INVALID_CODE', 1))
      .mockRejectedValueOnce(new CodeRefusedError(429, 'no', 'TOO_MANY_ATTEMPTS', 5));

    await login();
    await request(app).post('/api/mfa/setup').set(bearer(sessionToken));
    await request(app).post('/api/mfa/verify').set(bearer(sessionToken)).send({ secret: KEY, totpCode: RIGHT });
    await request(app).post('/api/mfa/verify').set(bearer(sessionToken)).send({ secret: KEY, totpCode: WRONG });
    await request(app).post('/api/mfa/disable').set(bearer(sessionToken)).send({ totpCode: WRONG });
    await verifyCode({ pendingToken, code: RIGHT });
    await verifyCode({ pendingToken, code: WRONG });
    await verifyCode({ pendingToken, code: WRONG });
    await request(app).get('/api/mfa/status').set(bearer(pendingToken)); // a pending token used as a session

    const entries = await audits();
    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['MFA_CHALLENGE', 'MFA_SETUP', 'MFA_ENABLE', 'MFA_VERIFY_FAILED', 'MFA_VERIFIED', 'USER_LOGIN', 'ACCESS_DENIED'])
    );
    const everything = JSON.stringify(query.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO audit_logs')));
    for (const forbidden of [KEY, QR, RIGHT, WRONG, pendingToken, sessionToken, PASSWORD, 'Bearer']) {
      expect(everything).not.toContain(forbidden);
    }
  });

  it('records only these facts about an MFA event: how, why it failed and which try', async () => {
    asMock(verifySignInCode).mockRejectedValue(new CodeRefusedError(400, 'no', 'INVALID_CODE', 2));
    asMock(verifyMFACode).mockRejectedValue(new CodeRefusedError(400, 'no', 'INVALID_CODE', 2));
    asMock(isMFAEnabled).mockResolvedValue(true);
    await verifyCode({ pendingToken: pending(), code: WRONG });
    await request(app).post('/api/mfa/disable').set(bearer(session())).send({ totpCode: WRONG });

    const mfa = (await audits()).filter((e) => e.action.startsWith('MFA_'));
    expect(mfa.length).toBe(2);
    for (const entry of mfa) expect(Object.keys(entry.details).sort()).toEqual(['attempt', 'reason', 'via']);
  });
});

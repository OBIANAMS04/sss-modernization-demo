// STORY-003 two-step verification: set up an authenticator app, sign in with a password and then a code, and the
// limits around it: a pending token is not a session, five wrong codes end a sign-in, a code works once, and every
// step is audited without a key or a code in it (local backend only; see lib.mjs). The codes are computed here
// (RFC 6238, totp.mjs), the way an authenticator app would show them.
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { account, call, expect, MANAGER, PASSWORD, run, stamp, staffAccount } from './lib.mjs';
import { totpSteps } from './totp.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const NO_BODY = null;

/** An HS256 token like the backend's (local development secret only), for tokens the API itself would never issue. */
function forge(claims, lifetimeSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ ...claims, iat: now, exp: now + lifetimeSeconds })}`;
  return `${body}.${createHmac('sha256', process.env.JWT_SECRET || 'dev_secret_key').update(body).digest('base64url')}`;
}

/** A well-formed code that is valid in none of the steps the server accepts (the last, this and the next one). */
function wrongCode(secret) {
  const valid = [-1, 0, 1].map((steps) => totpSteps(secret, steps));
  return ['000000', '111111', '222222'].find((c) => !valid.includes(c));
}

/** Registers a person, starts a setup and confirms it with the code on screen: the code for this step is then spent. */
async function enrolled(label) {
  const session = await account(`mfa-${label}-${stamp}@example.com`, `MFA ${label}`);
  const { secret } = (await call('POST', '/mfa/setup', session.token)).data;
  const confirmed = await call('POST', '/mfa/verify', session.token, { totpCode: totpSteps(secret, 0) });
  if (confirmed.status !== 200) throw new Error(`enrol ${label}: ${confirmed.status} ${JSON.stringify(confirmed.data)}`);
  return { ...session, secret };
}

/** Password only: what the sign-in page does first. */
const password = (email) => call('POST', '/auth/login', NO_BODY, { email, password: PASSWORD });
const verify = (pendingToken, code) => call('POST', '/auth/mfa/verify', NO_BODY, { pendingToken, code });

run(async () => {
  const db = new Client({ host: 'localhost', database: process.env.DATABASE_NAME || 'sss_demo', user: 'admin', password: 'dev_password' });
  await db.connect();
  try {
    await checks(db);
  } finally {
    await db.end();
  }
});

async function checks(db) {
  /** What the database holds for a person: their authenticator devices and whether two-step verification is flagged on. */
  const stored = async (id) => ({
    devices: (await db.query('SELECT verified, secret_key, last_used_step FROM mfa_devices WHERE user_id = $1', [id])).rows,
    enabled: (await db.query('SELECT mfa_enabled FROM users WHERE id = $1', [id])).rows[0].mfa_enabled,
  });
  const m = await staffAccount(MANAGER, 'Manager Test');
  const find = async (query) => (await call('GET', `/audit?${new URLSearchParams({ limit: 200, ...query })}`, m.token)).data.logs;

  // 1-4. Setup: a QR code and the key as text, confirmed with the 6-digit code from the app
  const a = await account(`mfa-user-${stamp}@example.com`, 'MFA User');
  expect('two-step verification starts off', (await call('GET', '/mfa/status', a.token)).data, { mfaEnabled: false, recoveryCodesLeft: 0 });

  const setup = await call('POST', '/mfa/setup', a.token);
  const secret = setup.data.secret;
  expect('setup answers with a 32-character base32 key', [setup.status, /^[A-Z2-7]{32}$/.test(secret)], [200, true]);
  expect('setup carries a QR code image (a PNG)', [setup.data.qrCode?.startsWith('data:image/png;base64,'), Buffer.from(setup.data.qrCode?.split(',')[1] ?? '', 'base64').subarray(1, 4).toString()], [true, 'PNG']);
  const url = new URL(setup.data.otpauthUrl);
  expect(
    'and the address an authenticator app adds: totp, this key and issuer, 6 digits, 30 seconds',
    [url.protocol, url.hostname, url.searchParams.get('secret'), url.searchParams.get('issuer'), url.searchParams.get('digits'), url.searchParams.get('period'), decodeURIComponent(url.pathname).endsWith(a.user.email)],
    ['otpauth:', 'totp', secret, 'SSS Modernization Demo', '6', '30', true]
  );
  expect('and the response is never cached', setup.headers.get('cache-control'), 'no-store');
  const second = await call('POST', '/mfa/setup', a.token);
  expect('setting up again replaces the first key', [second.status, second.data.secret !== secret], [200, true]);
  const key = second.data.secret;
  expect('a setup that is not confirmed does not turn it on', (await call('GET', '/mfa/status', a.token)).data, { mfaEnabled: false, recoveryCodesLeft: 0 });
  const waiting = await stored(a.user.id);
  expect('it is held as one unverified device, the latest key, and the account is not flagged', [waiting.devices.map((d) => [d.verified, d.secret_key === key, d.last_used_step]), waiting.enabled], [[[false, true, null]], false]);
  expect('so sign-in is still password only', (await password(a.user.email)).data.token !== undefined, true);

  expect('a wrong code does not turn it on', [(await call('POST', '/mfa/verify', a.token, { totpCode: wrongCode(key) })).status, (await call('GET', '/mfa/status', a.token)).data.mfaEnabled], [400, false]);
  const notSix = await call('POST', '/mfa/verify', a.token, { totpCode: '12345' });
  expect('a code that is not 6 digits is refused', [notSix.status, notSix.data.error.code], [400, 'VALIDATION_ERROR']);
  const lie = await call('POST', '/mfa/verify', a.token, { secret: 'JBSWY3DPEHPK3PXP', totpCode: totpSteps('JBSWY3DPEHPK3PXP', 0) });
  expect('a key sent with the request is not used: the code must match the key the server holds', [lie.status, lie.data.error?.code], [400, 'INVALID_CODE']);

  const enable = await call('POST', '/mfa/verify', a.token, { totpCode: totpSteps(key, 0) });
  expect('the right code turns it on', [enable.status, enable.data.success], [200, true]);
  expect('status shows it on', (await call('GET', '/mfa/status', a.token)).data, { mfaEnabled: true, recoveryCodesLeft: 10 }); // STORY-041: ten recovery codes
  const held = await stored(a.user.id);
  expect(
    'mfa_devices holds the device as verified, with the step of the code that confirmed it, and users.mfa_enabled is true',
    [held.devices.map((d) => [d.verified, d.secret_key === key, Math.abs(Number(d.last_used_step) - Math.floor(Date.now() / 1000 / 30)) <= 1]), held.enabled],
    [[[true, true, true]], true]
  );
  expect('and so does the profile', (await call('GET', `/users/${a.user.id}`, a.token)).data.mfaEnabled, true);
  expect('the key is never returned again: setup is refused while it is on', [(await call('POST', '/mfa/setup', a.token)).status, JSON.stringify((await call('GET', '/mfa/status', a.token)).data).includes(key)], [409, false]);

  // 5. Sign-in: the password alone no longer gives a session
  const first = await password(a.user.email);
  expect('the password alone returns "MFA required" and no session', [first.status, first.data.mfaRequired, 'token' in first.data, 'user' in first.data, typeof first.data.pendingToken], [200, true, false, false, 'string']);
  const pendingClaims = claimsOf(first.data.pendingToken);
  expect(
    'the pending token says what it is, lasts five minutes and has no sign-in time',
    [pendingClaims.purpose, pendingClaims.exp - pendingClaims.iat, first.data.expiresIn, 'auth_time' in pendingClaims, pendingClaims.sub],
    ['mfa', 300, 300, false, a.user.id]
  );
  const pending = first.data.pendingToken;

  // The pending token is not a session anywhere
  expect('a staff route refuses the pending token (401)', (await call('GET', '/cases/stats', pending)).status, 401);
  expect('/auth/refresh refuses it (401) and gives no token', await call('POST', '/auth/refresh', pending).then((r) => [r.status, 'token' in r.data]), [401, false]);
  expect('so do the profile, the MFA status and turning MFA off', [(await call('GET', `/users/${a.user.id}`, pending)).status, (await call('GET', '/mfa/status', pending)).status, (await call('POST', '/mfa/disable', pending, { totpCode: totpSteps(key, 1) })).status], [401, 401, 401]);
  expect('a session token is not a pending token', (await verify(a.token, totpSteps(key, 1))).status, 401);
  const expired = forge({ sub: a.user.id, email: a.user.email, purpose: 'mfa', jti: 'expired-test' }, -10);
  const late = await verify(expired, totpSteps(key, 1));
  expect('an expired pending token is refused', [late.status, late.data.error.message], [401, 'Your sign-in timed out. Please sign in again.']);
  expect('no token at all is a 400', (await call('POST', '/auth/mfa/verify', NO_BODY, { code: totpSteps(key, 1) })).status, 400);

  // The code step
  const bad = await verify(pending, wrongCode(key));
  expect('a wrong code is refused and says how many tries are left', [bad.status, bad.data.error.code, bad.data.error.message], [400, 'INVALID_CODE', 'That code is not correct. 4 tries left.']);
  expect('and gives no session', 'token' in bad.data, false);
  expect('a code from two steps away, either side, is refused (the window is one step)', [(await verify(pending, totpSteps(key, -2))).status, (await verify(pending, totpSteps(key, 2))).status], [400, 400]);
  expect('a code that is not 6 digits is refused and not counted', [(await verify(pending, 'abcdef')).status, (await verify(pending, '12 3456')).status], [400, 400]);
  const next = totpSteps(key, 1); // the code for the next step: the one for this step was spent turning it on
  const signedIn = await verify(pending, next);
  expect('the right code gives a session', [signedIn.status, typeof signedIn.data.token, signedIn.data.user?.id, signedIn.data.user?.email], [200, 'string', a.user.id, a.user.email]);
  expect('shaped like a login: the same user fields', Object.keys(signedIn.data.user).sort(), Object.keys(a.user).sort());
  const sessionClaims = claimsOf(signedIn.data.token);
  const usual = claimsOf(a.token); // the session registering gave
  expect(
    'with a sign-in time of now, the usual session length and no pending-token claims',
    [Math.abs(sessionClaims.auth_time - Date.now() / 1000) < 60, sessionClaims.exp - sessionClaims.iat === usual.exp - usual.iat, 'purpose' in sessionClaims, 'jti' in sessionClaims],
    [true, true, false, false]
  );
  expect(
    'and it works: profile, MFA status and /auth/refresh',
    [(await call('GET', `/users/${a.user.id}`, signedIn.data.token)).status, (await call('GET', '/mfa/status', signedIn.data.token)).data.mfaEnabled, (await call('POST', '/auth/refresh', signedIn.data.token)).status],
    [200, true, 200]
  );
  expect('a citizen is still refused a staff route (a session, not a role)', (await call('GET', '/cases/stats', signedIn.data.token)).status, 403);

  // A code works once
  const again = await password(a.user.email);
  const reused = await verify(again.data.pendingToken, next);
  expect('the same code is not accepted twice, even for a new sign-in', [reused.status, reused.data.error.code], [400, 'CODE_ALREADY_USED']);
  expect('nor the code of the step before', (await verify(again.data.pendingToken, totpSteps(key, 0))).data.error?.code, 'CODE_ALREADY_USED');

  // A pending sign-in ends at its first accepted code. Winding the device back two steps leaves this step's code and
  // the next one unspent, so only the single-use rule can stop the same password step from giving a second session.
  const once = await enrolled('once');
  await db.query('UPDATE mfa_devices SET last_used_step = last_used_step - 2 WHERE user_id = $1', [once.user.id]);
  const oncePending = (await password(once.user.email)).data.pendingToken;
  const firstUse = await verify(oncePending, totpSteps(once.secret, -1));
  expect('a pending sign-in gives a session with the first right code', [firstUse.status, typeof firstUse.data.token], [200, 'string']);
  const secondUse = await verify(oncePending, totpSteps(once.secret, 0));
  expect('but not a second one, even with a later right code (401)', [secondUse.status, 'token' in secondUse.data, secondUse.data.error?.message], [401, false, 'This sign-in is already finished. Please sign in again.']);
  const fresh = await verify((await password(once.user.email)).data.pendingToken, totpSteps(once.secret, 0));
  expect('that refusal does not use up the code: a new sign-in accepts it', [fresh.status, typeof fresh.data.token], [200, 'string']);

  // 6. Five wrong codes end a pending sign-in; the code is not used up by the refusals
  const b = await enrolled('limit');
  const attempt = await password(b.user.email);
  const tries = [];
  for (let i = 0; i < 5; i++) tries.push(await verify(attempt.data.pendingToken, wrongCode(b.secret)));
  expect(
    'five wrong codes: four say how many tries are left, the fifth ends the sign-in (429)',
    tries.map((t) => [t.status, t.data.error.code]),
    [[400, 'INVALID_CODE'], [400, 'INVALID_CODE'], [400, 'INVALID_CODE'], [400, 'INVALID_CODE'], [429, 'TOO_MANY_ATTEMPTS']]
  );
  expect('the tries left count down', tries.slice(0, 4).map((t) => t.data.error.message.match(/\d+ tr(y|ies) left/)[0]), ['4 tries left', '3 tries left', '2 tries left', '1 try left']);
  const rightCode = totpSteps(b.secret, 1);
  const lateRight = await verify(attempt.data.pendingToken, rightCode);
  expect('then even the right code is refused for that pending token', [lateRight.status, lateRight.data.error.code, 'token' in lateRight.data], [429, 'TOO_MANY_ATTEMPTS', false]);
  await sleep(1100); // a session's tries are counted by its sign-in time in whole seconds: let this one differ from the one that set MFA up
  const retry = await password(b.user.email);
  const ok = await verify(retry.data.pendingToken, rightCode);
  expect('signing in again starts a new count, and the same right code, unspent, works', [ok.status, typeof ok.data.token], [200, 'string']);

  // The same five tries apply to a signed-in session turning MFA off
  const off = [];
  for (let i = 0; i < 5; i++) off.push((await call('POST', '/mfa/disable', ok.data.token, { totpCode: wrongCode(b.secret) })).status);
  expect('five wrong codes while turning MFA off end the tries for that session', off, [400, 400, 400, 400, 429]);
  expect('after which the right code is refused too, and MFA stays on', [(await call('POST', '/mfa/disable', ok.data.token, { totpCode: totpSteps(b.secret, 1) })).status, (await call('GET', '/mfa/status', ok.data.token)).data.mfaEnabled], [429, true]);

  // Turning it off needs a current code
  const c = await enrolled('off');
  const wrongOff = await call('POST', '/mfa/disable', c.token, { totpCode: wrongCode(c.secret) });
  expect('turning it off with a wrong code fails and leaves it on', [wrongOff.status, (await call('GET', '/mfa/status', c.token)).data.mfaEnabled], [400, true]);
  expect('with no code it fails too', (await call('POST', '/mfa/disable', c.token, {})).status, 400);
  const offNow = await call('POST', '/mfa/disable', c.token, { totpCode: totpSteps(c.secret, 1) });
  expect('with the right code it is turned off', [offNow.status, (await call('GET', '/mfa/status', c.token)).data.mfaEnabled], [200, false]);
  expect('and the device is removed and the flag cleared', await stored(c.user.id), { devices: [], enabled: false });
  const back = await password(c.user.email);
  expect('and the password alone gives a session again', [back.status, typeof back.data.token, 'mfaRequired' in back.data], [200, 'string', false]);
  expect('turning it off when it is off is refused', (await call('POST', '/mfa/disable', c.token, { totpCode: totpSteps(c.secret, 1) })).status, 409);

  // 7. The audit log
  await sleep(1000); // most entries are written in the background
  const trail = await find({ user: a.user.email });
  const events = trail.map((l) => `${l.action}:${l.status}`);
  for (const event of ['MFA_SETUP:success', 'MFA_ENABLE:success', 'MFA_CHALLENGE:success', 'MFA_VERIFIED:success', 'MFA_VERIFY_FAILED:failure', 'USER_LOGIN:success'])
    expect(`the audit log has ${event} for the user`, events.includes(event), true);
  const count = (action, status) => trail.filter((l) => l.action === action && l.status === status).length;
  expect('a code was asked for after each of the two passwords, and accepted once', [count('MFA_CHALLENGE', 'success'), count('MFA_VERIFIED', 'success')], [2, 1]);
  expect(
    'a sign-in is recorded when a session is issued: once with a code, and once before MFA was on',
    [count('USER_LOGIN', 'success'), trail.filter((l) => l.action === 'USER_LOGIN' && l.status === 'success' && l.details?.mfa).length],
    [2, 1]
  );
  expect('and setup is recorded each time it was started', count('MFA_SETUP', 'success'), 2);
  const failures = trail.filter((l) => l.action === 'MFA_VERIFY_FAILED');
  expect(
    'failed codes say where and why, and which try',
    failures.map((l) => [l.details.via, l.details.reason, l.details.attempt].join()).sort(),
    [['setup', 'INVALID_CODE', 1], ['setup', 'INVALID_CODE', 2], ['sign-in', 'INVALID_CODE', 1], ['sign-in', 'INVALID_CODE', 2], ['sign-in', 'INVALID_CODE', 3], ['sign-in', 'CODE_ALREADY_USED', 1], ['sign-in', 'CODE_ALREADY_USED', 2]]
      .map((row) => row.join())
      .sort()
  );
  expect('a failed code is recorded against the person, with the caller address', [failures.every((l) => l.actorEmail === a.user.email && l.actor === a.user.id), failures.every((l) => Boolean(l.ipAddress))], [true, true]);

  const limit = await find({ user: b.user.email });
  expect(
    'the exhausted sign-in is recorded, up to the refused sixth try',
    limit.filter((l) => l.action === 'MFA_VERIFY_FAILED' && l.details.via === 'sign-in').map((l) => `${l.details.reason}:${l.details.attempt}`).sort(),
    ['INVALID_CODE:1', 'INVALID_CODE:2', 'INVALID_CODE:3', 'INVALID_CODE:4', 'TOO_MANY_ATTEMPTS:5', 'TOO_MANY_ATTEMPTS:6']
  );
  const turnedOff = await find({ user: c.user.email });
  expect('turning it off is recorded, and so is the wrong code', [turnedOff.some((l) => l.action === 'MFA_DISABLE' && l.status === 'success'), turnedOff.some((l) => l.action === 'MFA_VERIFY_FAILED' && l.details.via === 'disable')], [true, true]);

  const everything = JSON.stringify([...trail, ...limit, ...turnedOff]);
  const mfaDetails = JSON.stringify([...trail, ...limit, ...turnedOff].filter((l) => l.action.startsWith('MFA_')).map((l) => l.details));
  const spent = [key, secret, b.secret, c.secret, pending, first.data.pendingToken, signedIn.data.token, ok.data.token, PASSWORD];
  expect('no key, token or password anywhere in their trail', spent.some((s) => everything.includes(s)), false);
  const codes = ['000000', '111111', '222222', ...[-2, -1, 0, 1, 2].flatMap((n) => [key, b.secret, c.secret].map((k) => totpSteps(k, n)))];
  expect('no 6-digit code in the details of any MFA entry', codes.some((code) => mfaDetails.includes(`"${code}"`) || mfaDetails.includes(code)), false);
  expect('MFA entries carry only how, why and which try', [...trail, ...limit, ...turnedOff].filter((l) => l.action === 'MFA_VERIFY_FAILED').every((l) => Object.keys(l.details).sort().join() === 'attempt,reason,via'), true);
}

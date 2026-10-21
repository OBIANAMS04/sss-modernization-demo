// STORY-041: the attack suite. Run against a LOCAL backend only (see lib.mjs): it tries to get past sign-in, read other people's
// records, inject SQL and script, tamper with tokens, guess passwords, and checks the security headers and CORS, then the hardening:
// sign-in and registration throttling, sign-out ending a session on the server, and MFA recovery codes.
//   node scripts/e2e/security.mjs
// Throttling by address is tested by sending X-Forwarded-For, which the API trusts only from this machine (app.ts, trust proxy).
import { BASE, PASSWORD, account, call, exemptionId, expect, run, stamp, staffAccount, MANAGER } from './lib.mjs';
import { totpSteps } from './totp.mjs';

/** A request with headers of our choosing (lib.call sets only the token). */
async function raw(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data, headers: res.headers };
}

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const msNow = () => performance.now();
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

run(async () => {
  const a = await account(`sec-a-${stamp}@example.com`, 'Avery Security');
  const b = await account(`sec-b-${stamp}@example.com`, 'Blair Security');
  const m = await staffAccount(MANAGER, 'Morgan Manager');

  // 1. Security headers, on a success, a refusal and a not-found alike
  for (const [label, res] of [
    ['health', await raw('GET', '/../health')],
    ['a refusal', await raw('GET', '/cases')],
    ['a signed-in read', await raw('GET', `/users/${a.user.id}`, { token: a.token })],
  ]) {
    const h = res.headers;
    expect(`headers on ${label}: CSP, nosniff, frame DENY, HSTS, no-referrer, no-store, no X-Powered-By`, [
      h.get('content-security-policy')?.includes("default-src 'none'") && h.get('content-security-policy')?.includes("frame-ancestors 'none'"),
      h.get('x-content-type-options'),
      h.get('x-frame-options'),
      h.get('strict-transport-security')?.startsWith('max-age='),
      h.get('referrer-policy'),
      h.get('cache-control'),
      h.get('x-powered-by'),
    ], [true, 'nosniff', 'DENY', true, 'no-referrer', 'no-store', null]);
  }

  // 2. CORS: another site's page gets no permission to read the API
  const preflight = await raw('OPTIONS', '/cases', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  // The API names only its own site; a browser on any other site finds its origin missing and refuses to hand over the response
  const allowed = (h) => h.get('access-control-allow-origin');
  expect('CORS: a preflight from another site is not allowed (neither its origin nor *)', ['https://evil.example', '*'].includes(allowed(preflight.headers)), false);
  const simple = await raw('GET', `/users/${a.user.id}`, { token: a.token, headers: { Origin: 'https://evil.example' } });
  expect('CORS: a read from another site is not allowed (neither its origin nor *)', ['https://evil.example', '*'].includes(allowed(simple.headers)), false);

  // 3. Getting past sign-in
  const [head, payload, signature] = a.token.split('.');
  const asB = b64url({ ...claimsOf(a.token), sub: b.user.id, email: b.user.email });
  for (const [label, token] of [
    ['garbage', 'not-a-token'],
    ['alg "none" (no signature)', `${b64url({ alg: 'none', typ: 'JWT' })}.${payload}.`],
    ['a payload changed to another person, old signature', `${head}.${asB}.${signature}`],
    ['a signature from another key', `${head}.${payload}.${Buffer.from('x'.repeat(32)).toString('base64url')}`],
    ['HS256 header swapped for RS256', `${b64url({ alg: 'RS256', typ: 'JWT' })}.${payload}.${signature}`],
  ]) {
    const res = await raw('GET', `/users/${b.user.id}`, { token });
    expect(`token tampering: ${label} is a 401`, res.status, 401);
  }
  expect('no token: 401', (await raw('GET', '/cases')).status, 401);

  // 4. Other people's records (a citizen with a valid session)
  await call('POST', '/exemptions/check', b.token);
  const caseOfB = await call('POST', '/cases', b.token, { exemptionId: await exemptionId(b.token, 'Type A') });
  const bCaseId = caseOfB.data?.case?.id ?? caseOfB.data?.id;
  expect('setup: B has a case', typeof bCaseId, 'string');
  expect('another person: GET /users/:id', (await call('GET', `/users/${b.user.id}`, a.token)).status, 403);
  expect('another person: PUT /users/:id', (await call('PUT', `/users/${b.user.id}`, a.token, { phone: '555-000-0000' })).status, 403);
  expect('another person: GET /cases/:id', [403, 404].includes((await call('GET', `/cases/${bCaseId}`, a.token)).status), true);
  expect('another person: GET /audit/user/:id', (await call('GET', `/audit/user/${b.user.id}`, a.token)).status, 403);
  const listOfA = await call('GET', '/cases', a.token);
  expect("a citizen's case list holds none of B's cases", JSON.stringify(listOfA.data).includes(bCaseId), false);

  // 5. Injection: no statement breaks (no 500) and nothing extra comes back
  for (const evil of ["' OR '1'='1", "'; DROP TABLE users; --", '%', '\\', '"', '${7*7}', '<script>alert(1)</script>']) {
    const res = await call('GET', `/cases?applicant=${encodeURIComponent(evil)}&status=${encodeURIComponent(evil)}`, m.token);
    expect(`SQL injection in case filters (${evil}): no server error`, res.status < 500, true);
  }
  const loginInjection = await call('POST', '/auth/login', null, { email: "' OR '1'='1' --", password: "' OR '1'='1" });
  expect('SQL injection at sign-in: refused, not a 500', loginInjection.status, 400);
  const sneaky = await call('POST', '/auth/login', null, { email: { $ne: '' }, password: { $ne: '' } });
  expect('objects in place of strings at sign-in: refused, not a 500', sneaky.status < 500 && sneaky.status !== 200, true);

  // 6. Script in data: stored as text and returned as JSON, never as a page
  const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  await call('PUT', `/users/${a.user.id}`, a.token, { address: xss });
  const profile = await raw('GET', `/users/${a.user.id}`, { token: a.token });
  expect('stored script comes back as JSON text (application/json, nosniff)', [
    profile.headers.get('content-type')?.startsWith('application/json'),
    JSON.stringify(profile.data).includes('<script>alert(2)</script>'),
  ], [true, true]);

  // 7. Oversized and malformed bodies
  expect('a body over 100 kB is refused (413)', (await raw('POST', '/auth/login', { body: JSON.stringify({ email: 'x', password: 'y'.repeat(120_000) }) })).status, 413);
  expect('malformed JSON is a 400, not a 500', (await raw('POST', '/auth/login', { body: '{"email":' })).status, 400);

  // 8. Telling registered addresses apart by timing: a wrong password for an account and for no account take about as long
  const known = [];
  const unknown = [];
  for (let i = 0; i < 3; i++) {
    let t = msNow();
    await call('POST', '/auth/login', null, { email: b.user.email, password: `wrong-${i}` });
    known.push(msNow() - t);
    t = msNow();
    await call('POST', '/auth/login', null, { email: `nobody-${stamp}-${i}@example.com`, password: `wrong-${i}` });
    unknown.push(msNow() - t);
  }
  const ratio = median(unknown) / median(known);
  console.log(`      timing: account ${Math.round(median(known))} ms, no account ${Math.round(median(unknown))} ms`);
  expect('timing: no account takes at least half as long as a wrong password (bcrypt either way)', ratio > 0.5, true);
  await call('POST', '/auth/login', null, { email: b.user.email, password: PASSWORD }); // B's count starts afresh

  // 9. Password guessing: 10 tries per account in 15 minutes, then 429 with Retry-After, even with the right password
  const victim = await account(`sec-victim-${stamp}@example.com`, 'Vic Tim');
  await call('POST', '/auth/login', null, { email: victim.user.email, password: PASSWORD }); // account() tried a sign-in first; start afresh
  const tries = [];
  for (let i = 0; i < 10; i++) tries.push((await call('POST', '/auth/login', null, { email: victim.user.email, password: `guess-${i}` })).status);
  expect('guessing: ten wrong passwords are each refused as wrong (400)', tries.every((s) => s === 400), true);
  const eleventh = await raw('POST', '/auth/login', { body: { email: victim.user.email, password: PASSWORD } });
  expect('guessing: the eleventh try is throttled, the right password too (429, Retry-After)', [eleventh.status, Number(eleventh.headers.get('retry-after')) > 0], [429, true]);
  expect('guessing: the account in another case is the same account', (await call('POST', '/auth/login', null, { email: victim.user.email.toUpperCase(), password: 'x' })).status, 429);

  // 10. Guessing from one address across many accounts: 30 failures in 15 minutes, then 429 for that address only
  const attacker = { 'X-Forwarded-For': `203.0.113.${(stamp % 200) + 1}` };
  let lastStatus = 0;
  for (let i = 0; i < 30; i++) lastStatus = (await raw('POST', '/auth/login', { headers: attacker, body: { email: `spray-${stamp}-${i}@example.com`, password: 'Winter2026!' } })).status;
  expect('spraying: thirty failures from one address are refused as wrong', lastStatus, 400);
  expect('spraying: the next sign-in from that address is throttled', (await raw('POST', '/auth/login', { headers: attacker, body: { email: a.user.email, password: PASSWORD } })).status, 429);
  expect('spraying: another address is not affected', (await raw('POST', '/auth/login', { headers: { 'X-Forwarded-For': '198.51.100.250' }, body: { email: a.user.email, password: PASSWORD } })).status, 200);

  // 11. Mass registration from one address: 10 an hour (counted before the form is even checked)
  const farm = { 'X-Forwarded-For': `192.0.2.${(stamp % 200) + 1}` };
  const regs = [];
  for (let i = 0; i < 11; i++) regs.push((await raw('POST', '/auth/register', { headers: farm, body: { email: `farm-${i}` } })).status);
  expect('registration: ten from one address are processed, the eleventh is throttled', [regs.slice(0, 10).every((s) => s === 400), regs[10]], [true, 429]);

  // 12. Signing out ends the session on the server, extended tokens included
  const fresh = await call('POST', '/auth/login', null, { email: a.user.email, password: PASSWORD });
  const extended = await call('POST', '/auth/refresh', fresh.data.token);
  expect('sign-out: the extended token belongs to the same session', claimsOf(extended.data.token).sid, claimsOf(fresh.data.token).sid);
  expect('sign-out: 204', (await call('POST', '/auth/logout', fresh.data.token)).status, 204);
  const after = await call('GET', `/users/${a.user.id}`, fresh.data.token);
  expect('sign-out: the signed-out token is refused', [after.status, after.data?.error?.message], [401, 'Your session has ended. Please sign in again.']);
  expect('sign-out: the extended token is refused too', (await call('GET', `/users/${a.user.id}`, extended.data.token)).status, 401);
  expect('sign-out: it cannot be extended again', (await call('POST', '/auth/refresh', fresh.data.token)).status, 401);
  expect('sign-out: other sessions of the person still work', (await call('GET', `/users/${a.user.id}`, a.token)).status, 200);

  // 13. Two-step verification and recovery codes
  const p = await account(`sec-mfa-${stamp}@example.com`, 'Pat Recovery');
  const setup = await call('POST', '/mfa/setup', p.token);
  const enabled = await call('POST', '/mfa/verify', p.token, { totpCode: totpSteps(setup.data.secret, 0) });
  const codes = enabled.data.recoveryCodes ?? [];
  expect('recovery: ten codes come back once, when two-step verification is turned on', [enabled.status, codes.length, new Set(codes).size], [200, 10, 10]);
  expect('recovery: status counts them', (await call('GET', '/mfa/status', p.token)).data.recoveryCodesLeft, 10);
  const pendingOf = async () => (await call('POST', '/auth/login', null, { email: p.user.email, password: PASSWORD })).data.pendingToken;
  const pending1 = await pendingOf();
  expect('a pending sign-in token is not a session', (await call('GET', `/users/${p.user.id}`, pending1)).status, 401);
  const used = await call('POST', '/auth/mfa/verify', null, { pendingToken: pending1, recoveryCode: codes[0].toLowerCase() });
  expect('recovery: a code signs in (any case) and says how many are left', [used.status, typeof used.data.token, used.data.recoveryCodesLeft], [200, 'string', 9]);
  const replay = await call('POST', '/auth/mfa/verify', null, { pendingToken: await pendingOf(), recoveryCode: codes[0] });
  expect('recovery: the same code is refused the second time', [replay.status, replay.data?.error?.code], [400, 'INVALID_RECOVERY_CODE']);
  const fresher = await call('POST', '/mfa/recovery-codes', p.token, { totpCode: totpSteps(setup.data.secret, 1) });
  expect('recovery: new codes need a current code, and replace the old ones', [fresher.status, fresher.data.recoveryCodes?.length], [200, 10]);
  const old = await call('POST', '/auth/mfa/verify', null, { pendingToken: await pendingOf(), recoveryCode: codes[1] });
  expect('recovery: an old code no longer works', old.status, 400);
  const pending5 = await pendingOf();
  const fives = [];
  for (let i = 0; i < 5; i++) fives.push((await call('POST', '/auth/mfa/verify', null, { pendingToken: pending5, recoveryCode: 'AAAA-BBBB-CCCC-DDDD' })).status);
  expect('recovery: guesses share the five tries of a sign-in', fives, [400, 400, 400, 400, 429]);
  const audit = await call('GET', `/audit/user/${p.user.id}`, p.token);
  const actions = JSON.stringify(audit.data);
  expect('recovery: making and using codes is in the audit log, the codes are not', [
    actions.includes('MFA_RECOVERY_CODES_CREATED'),
    actions.includes('MFA_RECOVERY_CODE_USED'),
    codes.some((c) => actions.includes(c) || actions.includes(c.replace(/-/g, ''))),
  ], [true, true, false]);
});

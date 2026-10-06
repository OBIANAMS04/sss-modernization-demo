#!/usr/bin/env node
// Checks the live site as an ordinary signed-in citizen: every staff GET route in
// backend/src/security/routeAccess.ts must answer 403, and the citizen's pages must not offer
// staff features. Complements verify-deploy.mjs, which checks the same routes without a token.
//
// Usage (from sss-modernization-demo/): node scripts/verify-live-citizen.mjs [screenshot-dir]
//
// Uses one synthetic citizen account ("Deploy Check", deploy-check@example.com), registered on
// first use. Its generated password is kept OUTSIDE the repo, in ~/.claude/sss-verify/live-citizen.json
// (override with LIVE_CITIZEN_FILE). GET requests only, so the check never changes live data.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { launch } from './evidence/browser.mjs';

const API = process.env.API_URL || 'https://sss-demo-backend.onrender.com';
const SITE = process.env.SITE_URL || 'https://sss-demo-frontend.onrender.com';
const CREDS = process.env.LIVE_CITIZEN_FILE || join(homedir(), '.claude', 'sss-verify', 'live-citizen.json');
const shotsDir = process.argv[2] && resolve(process.argv[2]);
const DUMMY_ID = '00000000-0000-4000-8000-000000000000';

async function call(method, path, token, body) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

async function signIn() {
  let creds = existsSync(CREDS) ? JSON.parse(readFileSync(CREDS, 'utf8')) : null;
  if (!creds) {
    creds = { email: 'deploy-check@example.com', password: `${randomBytes(12).toString('base64url')}Aa1!` };
    const r = await call('POST', '/auth/register', null, {
      email: creds.email,
      password: creds.password,
      fullName: 'Deploy Check',
      ssn: '900-00-0011', // 900-series numbers are never issued
      dob: '1990-01-01',
    });
    if (r.status !== 201) throw new Error(`register: ${r.status} ${JSON.stringify(r.data)}`);
    mkdirSync(dirname(CREDS), { recursive: true });
    writeFileSync(CREDS, JSON.stringify(creds, null, 2), { mode: 0o600 });
    console.log(`registered ${creds.email}; password saved to ${CREDS}`);
  }
  const login = await call('POST', '/auth/login', null, { email: creds.email, password: creds.password });
  if (login.status !== 200) throw new Error(`login: ${login.status} ${JSON.stringify(login.data)}`);
  return login.data;
}

const failures = [];
const check = (label, ok, detail = '') => {
  if (!ok) failures.push(`${label} ${detail}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
};

const session = await signIn();
check('signed in as a citizen', session.user.role === 'citizen', session.user.role);

const table = readFileSync(new URL('../backend/src/security/routeAccess.ts', import.meta.url), 'utf8');
const staffGets = [...table.matchAll(/'GET \/api(\/[^']*)': 'staff'/g)].map(([, path]) => path.replace(/:[A-Za-z]+/g, DUMMY_ID));
const open = [];
for (const path of staffGets) {
  const r = await call('GET', path, session.token);
  if (r.status !== 403) open.push(`${path} -> ${r.status}`);
}
check(`all ${staffGets.length} staff GET routes refuse a citizen (403)`, open.length === 0, open.join(', '));

const matrix = await call('GET', '/compliance/matrix', session.token);
check('compliance matrix readable when signed in (8 controls)', matrix.status === 200 && matrix.data.controls?.length === 8, `${matrix.status}`);

if (shotsDir) {
  mkdirSync(shotsDir, { recursive: true });
  const page = await launch();
  try {
    await page.signIn(SITE, session);
    await page.goto(`${SITE}/dashboard`);
    await page.waitForText('Release Progress', 60_000);
    check('live dashboard lists compliance validation as done', await page.hasText('R1: Compliance validation'));
    check('no Compliance link for a citizen', await page.evaluate(`!document.querySelector('a[href="/compliance"]')`));
    await page.screenshot(join(shotsDir, 'live-01-citizen-dashboard.png'));
    await page.goto(`${SITE}/compliance`);
    await page.waitForText('available to case managers only', 60_000);
    await page.screenshot(join(shotsDir, 'live-02-citizen-compliance-page.png'));
    console.log(`      saved live screenshots in ${shotsDir}`);
  } finally {
    await page.close();
  }
}

console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL PASSED');
process.exit(failures.length ? 1 : 0);

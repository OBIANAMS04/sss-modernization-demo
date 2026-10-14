// Evidence for STORY-003 (two-step verification at sign-in) and STORY-013 to 015 (the case manager, admin and
// leadership dashboards, with the roles behind them).
//
// Runs on the same local stack as story-008.mjs, against a FRESH database, with the evidence backend's
// CASE_MANAGER_EMAILS listing dana.whitfield@example.com and ADMIN_EMAILS listing morgan.lee@example.com:
//   E2E_BASE=http://localhost:3002/api DATABASE_NAME=sss_demo_shots node scripts/evidence/story-003-015.mjs
// Cases are created and worked through the API, then their timelines are moved back with SQL so the dashboards
// show several weeks of work and some overdue cases. Screenshots land in docs/evidence/story-003/ and story-013/ to 015/.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { account, adminAccount, call, exemptionId, expect, PASSWORD, run, staffAccount } from '../e2e/lib.mjs';
import { totpSteps } from '../e2e/totp.mjs';
import { launch } from './browser.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');

const SITE = process.env.EVIDENCE_SITE || 'http://localhost:4173';
const dir = (story) => {
  const out = fileURLToPath(new URL(`../../docs/evidence/${story}/`, import.meta.url));
  mkdirSync(out, { recursive: true });
  return out;
};
const OUT = { mfa: dir('story-003'), cm: dir('story-013'), admin: dir('story-014'), lead: dir('story-015') };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const setStatus = (token, caseId, status, reason) => call('POST', `/cases/${caseId}/status`, token, { status, reason });
const REQUIRED_DOCUMENT = { 'Type A': 'proof_of_age', 'Type B': 'income_statement' };

run(async () => {
  const db = new Client({ host: 'localhost', database: process.env.DATABASE_NAME || 'sss_demo_shots', user: 'admin', password: 'dev_password' });
  await db.connect();
  try {
    await capture(db);
  } finally {
    await db.end();
  }
});

async function capture(db) {
  // Staff: Dana bootstraps the empty system; Morgan becomes its administrator through ADMIN_EMAILS; Sam is granted in the app
  const dana = await staffAccount('dana.whitfield@example.com', 'Dana Whitfield');
  const morgan = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
  const sam = await staffAccount('sam.ortiz@example.com', 'Sam Ortiz');
  expect('Dana is the first case manager, Morgan the administrator, Sam a case manager', [dana.user.role, morgan.user.role, sam.user.role], ['case_manager', 'admin', 'case_manager']);

  // Applicants and their cases. Each line: who, exemption, who works it, how far it goes, and how many days ago it began.
  const plan = [
    ['jordan.rivera@example.com', 'Jordan Rivera', 'Type A', dana, 'Approved', 34],
    ['jordan.rivera@example.com', 'Jordan Rivera', 'Type B', dana, 'Appealed', 20],
    ['avery.johnson@example.com', 'Avery Johnson', 'Type A', dana, 'In Review', 3],
    ['pat.kim@example.com', 'Pat Kim', 'Type B', dana, 'In Review', 8],
    ['skyler.reed@example.com', 'Skyler Reed', 'Type A', dana, 'Submitted', 2],
    ['casey.morgan@example.com', 'Casey Morgan', 'Type A', null, 'Submitted', 6],
    ['drew.patel@example.com', 'Drew Patel', 'Type B', null, 'Submitted', 1],
    ['quinn.davis@example.com', 'Quinn Davis', 'Type A', sam, 'Approved', 13],
    ['reese.carter@example.com', 'Reese Carter', 'Type B', sam, 'Denied', 27],
    ['taylor.brooks@example.com', 'Taylor Brooks', 'Type A', sam, 'Approved', 47],
    ['morgan.hayes@example.com', 'Morgan Hayes', 'Type B', dana, 'Approved', 61],
    ['jamie.fox@example.com', 'Jamie Fox', 'Type A', sam, 'Denied', 75],
  ];
  const cases = [];
  for (const [email, name, type, manager, goal, daysAgo] of plan) {
    const person = await account(email, name, '1951-02-20');
    await call('PUT', `/users/${person.user.id}`, person.token, { phone: '555-0108', address: '27 Oak Avenue, Columbus, OH', annualIncome: 18500 });
    const created = await call('POST', '/cases', person.token, { exemptionId: await exemptionId(person.token, type) });
    if (created.status !== 201) throw new Error(`apply ${email} ${type}: ${created.status} ${JSON.stringify(created.data)}`);
    const id = created.data.id;
    // The document each type requires, except for Quinn: Sam approves without it, so a compliance review opens for another
    // case manager (Dana) to resolve, and shows on her dashboard
    if (email !== 'quinn.davis@example.com') {
      await call('POST', `/cases/${id}/documents`, person.token, { documentType: REQUIRED_DOCUMENT[type], documentUrl: `https://example.com/${email.split('@')[0]}-${type.slice(-1)}.pdf` });
    }
    if (manager) {
      await call('PUT', `/cases/${id}/assignment`, manager.token, { assignedTo: manager.user.email });
      if (goal !== 'Submitted') await setStatus(manager.token, id, 'In Review');
      if (goal === 'Approved' || goal === 'Appealed' || goal === 'Denied') {
        const decision = goal === 'Approved' ? 'Approved' : 'Denied';
        await setStatus(manager.token, id, decision, decision === 'Denied' ? 'The income statement on file is from 2024; please upload a current one.' : undefined);
      }
      if (goal === 'Appealed') await setStatus(person.token, id, 'Appealed');
    }
    cases.push({ id, email, name, type, goal, daysAgo });
  }
  const statuses = (await Promise.all(cases.map(async (c) => (await call('GET', `/cases/${c.id}`, dana.token)).data.status))).join(',');
  expect('every case reached its planned status', statuses, cases.map((c) => c.goal).join(','));

  // Lay each case's timeline out over the past weeks: it starts `daysAgo` days back, and each status change follows the
  // one before after a realistic gap (other events a few minutes later), so the trends cover several weeks, the stage
  // times are real numbers and some open cases are overdue. Gaps vary by case; no step lands in the future.
  const DAY = 86_400_000;
  for (const [n, c] of cases.entries()) {
    const gap = { 'In Review': 1 + (n % 3), Approved: 2 + ((n * 5) % 7), Denied: 2 + ((n * 5) % 7), Appealed: 2 };
    const events = (await db.query('SELECT id, to_status FROM case_events WHERE case_id = $1 ORDER BY created_at, id', [c.id])).rows;
    const start = Date.now() - c.daysAgo * DAY;
    let at = start;
    for (const [i, e] of events.entries()) {
      if (i > 0) at = Math.min(at + (e.to_status && gap[e.to_status] ? gap[e.to_status] * DAY : 10 * 60_000), Date.now() - 3_600_000);
      await db.query('UPDATE case_events SET created_at = $2 WHERE id = $1', [e.id, new Date(at)]);
    }
    await db.query('UPDATE cases SET created_at = $2, submitted_at = $2, updated_at = $3 WHERE id = $1', [c.id, new Date(start), new Date(at)]);
  }

  const cm = (await call('GET', '/dashboards/case-manager', dana.token)).data;
  expect('Dana sees her overdue case and the overdue unassigned one', cm.overdue.total >= 2, true);
  expect("and Sam's decision on Quinn's case, waiting for her compliance review", cm.waitingOnMe.reviews.total, 1);
  const lead = (await call('GET', '/dashboards/leadership', morgan.token)).data;
  expect('the leadership figures name no applicant', cases.some((c) => JSON.stringify(lead).includes(c.name) || JSON.stringify(lead).includes(c.email)), false);
  expect('processing takes days, as laid out (not the seconds the setup took)', lead.kpis.averageProcessingDays > 2, true);

  // Kim Nguyen will turn on two-step verification; Riley Chen will be given leadership access in the app
  const kim = await account('kim.nguyen@example.com', 'Kim Nguyen', '1990-07-04');
  await account('riley.chen@example.com', 'Riley Chen', '1985-03-12');

  const page = await launch();
  const shot = async (out, name) => {
    await page.screenshot(`${out}${name}.png`);
    console.log(`      saved ${name}.png`);
  };
  let secret;
  try {
    // STORY-003 1: setting up an authenticator app
    await page.signIn(SITE, kim);
    await page.goto(`${SITE}/mfa`);
    await page.waitForText('Two-step verification is');
    await page.click('Set up an authenticator app');
    await page.waitForText('Set up your authenticator app');
    secret = (await page.evaluate(`document.querySelector('main code').innerText`)).replace(/\s/g, '');
    expect('the page shows a QR code and a 32-character key', [await page.evaluate(`!!document.querySelector('main img[alt^="QR code"]')`), /^[A-Z2-7]{32}$/.test(secret)], [true, true]);
    await shot(OUT.mfa, '01-mfa-setup');
    await page.type('#mfa-setup-code', totpSteps(secret, 0));
    await page.click('Verify and turn on');
    await page.waitForText('After your password, sign-in asks for a code from your authenticator app.');
    expect('two-step verification is on', (await call('GET', '/mfa/status', kim.token)).data.mfaEnabled, true);

    // STORY-003 2: signing in now asks for the code; a wrong one is refused and counted
    await page.evaluate(`localStorage.clear(); sessionStorage.clear(); true`);
    await page.goto(`${SITE}/login`);
    await page.type('#login-email', 'kim.nguyen@example.com');
    await page.type('#login-password', PASSWORD);
    await page.click('Sign In');
    await page.waitForText('Verify and sign in');
    const valid = [-1, 0, 1].map((s) => totpSteps(secret, s));
    await page.type('#mfa-code', ['000000', '111111', '222222'].find((c) => !valid.includes(c)));
    await page.click('Verify and sign in');
    await page.waitForText('That code is not correct. 4 tries left.');
    await shot(OUT.mfa, '02-sign-in-code');
    await page.evaluate(`document.querySelector('#mfa-code').select(); true`);
    await page.type('#mfa-code', totpSteps(secret, 1)); // this step's code was spent turning it on
    await page.click('Verify and sign in');
    await page.waitForText('Your applications');
    expect('the right code signs Kim in', await page.evaluate(`!!localStorage.getItem('auth_token')`), true);

    // STORY-003 3: every step in the Security Audit Log, without the key or a code
    await page.signIn(SITE, dana);
    await page.goto(`${SITE}/audit`);
    await page.waitForText('Write-once');
    await page.type('#l-user', 'kim.nguyen@example.com');
    await page.click('Search');
    await page.waitForText('MFA code refused');
    expect('the trail names each step and never holds the key', [await page.hasText('MFA setup'), await page.hasText('MFA enabled'), await page.hasText('MFA code accepted'), await page.hasText(secret)], [true, true, true, false]);
    await shot(OUT.mfa, '03-mfa-audit');

    // STORY-013: Dana's dashboard is her work list
    await page.goto(`${SITE}/dashboard`);
    await page.waitForText('Waiting on me');
    expect('it shows what waits on her, what is overdue and the queue', [await page.hasText('Overdue'), await page.hasText('Unassigned queue'), await page.hasText('Pat Kim')], [true, true, true]);
    await shot(OUT.cm, '01-case-manager-dashboard');
    const field = await page.evaluate(`[...document.querySelectorAll('label')].find((l) => l.innerText.trim() === 'Applicant name or email').htmlFor`);
    await page.type(`#${field}`, 'Jordan');
    await page.click('Search cases');
    await page.waitForText('Jordan Rivera');
    await sleep(600);
    expect('the search opens the case list filtered by its address', await page.evaluate(`location.pathname + location.search`), '/cases?applicant=Jordan');
    await shot(OUT.cm, '02-case-search');

    // STORY-014: the admin dashboard, then giving leadership access in Staff Access
    const admin = await account('morgan.lee@example.com', 'Morgan Lee');
    await page.signIn(SITE, admin);
    await page.goto(`${SITE}/dashboard`);
    await page.waitForText('System health');
    expect('it shows all cases, the team and system health', [await page.hasText('All cases'), await page.hasText('Team performance'), await page.hasText('Sam Ortiz')], [true, true, true]);
    await shot(OUT.admin, '01-admin-dashboard');
    await page.goto(`${SITE}/staff`);
    await page.waitForText('Current staff');
    await page.type('#grant-email', 'riley.chen@example.com');
    await page.select('#grant-role', 'leadership');
    await page.type('#grant-reason', 'Program director: needs the totals and trends, not case files.');
    await page.click('Give access');
    await page.waitForText('Confirm: give riley.chen@example.com');
    await shot(OUT.admin, '02-give-leadership');
    await page.click('Confirm access');
    await page.waitForText('riley.chen@example.com', 10_000);
    await sleep(800);

    // STORY-015: Riley signs in again and sees the leadership dashboard: aggregates only
    const riley = await account('riley.chen@example.com', 'Riley Chen');
    expect('Riley now holds the leadership role', riley.user.role, 'leadership');
    await page.signIn(SITE, riley);
    await page.goto(`${SITE}/dashboard`);
    await page.waitForText('Bottlenecks');
    await sleep(600);
    expect('no applicant is named on the page', await page.evaluate(`${JSON.stringify(cases.map((c) => c.name))}.some((n) => document.body.innerText.includes(n))`), false);
    expect('and no case-work links show', [await page.hasText('My Work'), await page.hasText('Staff Access')], [false, false]);
    await shot(OUT.lead, '01-leadership-dashboard');
  } finally {
    await page.close();
  }

  // A leadership user is refused case work and personal data
  const riley = await account('riley.chen@example.com', 'Riley Chen');
  expect('Riley is refused the case list for staff, the audit log and the admin dashboard', [
    (await call('GET', '/cases/stats', riley.token)).status,
    (await call('GET', '/audit', riley.token)).status,
    (await call('GET', '/dashboards/admin', riley.token)).status,
  ], [403, 403, 403]);
}

// STORY-010 evidence: ordinary activity through the API (sign-ups, a mistyped password, refusals, a decision,
// an export), then the Security Audit Log in headless Chrome: the overview, one person's whole trail, and the
// refusals. Also tries to edit and delete history directly in the database, which must be refused.
//
// Runs on the same local stack as story-008.mjs, against a FRESH database (see that file's header). Start
// the backend once as usual (the first record of its settings), then restart it with JWT_EXPIRY=1800 and a
// new JWT_SECRET, so that screen 4 shows a configuration change; pass the same secret here:
//   EVIDENCE_JWT_SECRET=<secret> E2E_BASE=http://localhost:3002/api node scripts/evidence/story-010.mjs
// Screenshots land in docs/evidence/story-010/.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { account, call, exemptionId, expect, PASSWORD, run, staffAccount } from '../e2e/lib.mjs';
import { launch } from './browser.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');

const SITE = process.env.EVIDENCE_SITE || 'http://localhost:4173';
const OUT = fileURLToPath(new URL('../../docs/evidence/story-010/', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

run(async () => {
  mkdirSync(OUT, { recursive: true });
  const dana = await staffAccount('dana.whitfield@example.com', 'Dana Whitfield');
  const sam = await staffAccount('sam.ortiz@example.com', 'Sam Ortiz');
  expect('two case managers', [dana.user.role, sam.user.role], ['case_manager', 'case_manager']);
  if ((await call('GET', '/audit?action=CASE_STATUS_CHANGE', sam.token)).data.total !== 0) {
    throw new Error('Run this against a fresh database: decisions have already been recorded here.');
  }

  // Jordan Rivera signs up, mistypes the password once, signs in, applies, and pokes at a staff page
  const jordanEmail = 'jordan.rivera@example.com';
  const jordan = await account(jordanEmail, 'Jordan Rivera', '1951-02-20');
  await call('POST', '/auth/login', null, { email: jordanEmail, password: 'Wrong-Passw0rd!' });
  const session = (await call('POST', '/auth/login', null, { email: jordanEmail, password: PASSWORD })).data;
  await call('PUT', `/users/${jordan.user.id}`, session.token, { phone: '555-0108', address: '27 Oak Avenue, Columbus, OH' });
  const caseId = (await call('POST', '/cases', session.token, { exemptionId: await exemptionId(session.token, 'Type A') })).data.id;
  await call('POST', `/cases/${caseId}/documents`, session.token, { documentType: 'proof_of_age', documentUrl: 'https://example.com/jordan-rivera-birth-certificate.pdf' });
  await call('GET', '/cases/stats', session.token); // refused: staff only
  await call('GET', '/compliance/dashboard', session.token); // refused: staff only

  // Dana decides; Sam exports; an anonymous caller is turned away
  await call('PUT', `/cases/${caseId}/assignment`, dana.token, { assignedTo: dana.user.email });
  await call('POST', `/cases/${caseId}/status`, dana.token, { status: 'In Review' });
  await call('POST', `/cases/${caseId}/status`, dana.token, { status: 'Approved' });
  await call('GET', '/cases/export', sam.token);
  await call('GET', '/cases', null);
  await call('POST', '/auth/logout', session.token);
  await sleep(1000);

  const page = await launch();
  const shot = async (name) => {
    await page.screenshot(`${OUT}${name}.png`);
    console.log(`      saved ${name}.png`);
  };
  const search = async (field, value) => {
    if (field === '#l-user') await page.type(field, value);
    else await page.select(field, value);
    await page.click('Search');
    await sleep(600);
  };
  try {
    // 1. Overview: write-once, retention, no personal data, every kind of event
    await page.signIn(SITE, sam);
    await page.goto(`${SITE}/audit`);
    await page.waitForText('Write-once');
    expect('page confirms write-once from the database', await page.hasText('The database refuses any edit or deletion of an entry.'), true);
    const events = await page.evaluate(`[...document.querySelectorAll('tbody tr td:nth-child(3) p:last-child')].map((p) => p.innerText)`);
    expect(
      'the newest entries span sign-ins, refusals, reads, exports and decisions',
      ['USER_LOGOUT', 'ACCESS_DENIED', 'DATA_READ', 'DATA_EXPORT', 'CASE_STATUS_CHANGE'].every((a) => events.includes(a)),
      true
    );
    await shot('01-audit-overview');

    // 2. One person's whole trail, including the failed sign-in made before they were signed in
    await search('#l-user', 'jordan.rivera');
    await page.waitForText('jordan.rivera@example.com (not signed in)');
    const trail = await page.evaluate(`[...document.querySelectorAll('tbody tr td:nth-child(3) p:last-child')].map((p) => p.innerText)`);
    expect(
      "Jordan's trail: registration, failed and successful sign-in, refusals, reads, sign-out",
      ['USER_REGISTRATION', 'USER_LOGIN', 'ACCESS_DENIED', 'DATA_READ', 'USER_LOGOUT'].every((a) => trail.includes(a)),
      true
    );
    expect('no SSN or password on the page', /900-?00-?0010|Passw0rd/.test(await page.evaluate('document.body.innerText')), false);
    await shot('02-one-persons-trail');

    // 3. Every refusal, signed in or not
    await page.click('Reset');
    await sleep(400);
    await search('#l-action', 'ACCESS_DENIED');
    await page.waitForText('/api/cases/stats');
    expect('refusals show who, what was tried and the answer', [await page.hasText('GET /api/cases/stats → 403'), await page.hasText('GET /api/cases → 401')], [true, true]);
    await shot('03-refusals');

    // 4. Settings changed between server starts (see the header): public values shown, secrets only named
    await page.click('Reset');
    await sleep(400);
    await search('#l-action', 'CONFIG_CHANGE');
    await page.waitForText('(not set) → 1800');
    const text = await page.evaluate('document.body.innerText');
    expect('the change shows the new session length and names the rotated secret', /changed: JWT_EXPIRY, JWT_SECRET/.test(text), true);
    expect('no secret value or fingerprint on the page', /sha256:/.test(text) || text.includes(process.env.EVIDENCE_JWT_SECRET || '\u0000'), false);
    await shot('04-configuration-changes');

    // The applicant cannot open the log
    await page.signIn(SITE, session);
    await page.goto(`${SITE}/audit`);
    await page.waitForText('available to case managers only');
  } finally {
    await page.close();
  }

  // History cannot be rewritten, even with direct database access
  const db = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    database: process.env.EVIDENCE_DB || 'sss_demo_shots',
    user: process.env.DATABASE_USER || 'admin',
    password: process.env.DATABASE_PASSWORD || 'dev_password',
  });
  await db.connect();
  try {
    const target = `(SELECT id FROM audit_logs WHERE action = 'USER_LOGIN' AND status = 'failure' LIMIT 1)`;
    for (const [label, sql] of [
      ['edit', `UPDATE audit_logs SET status = 'success' WHERE id = ${target}`],
      ['delete', `DELETE FROM audit_logs WHERE id = ${target}`],
    ]) {
      const error = await db.query(sql).then(() => null, (e) => e.message);
      expect(`the database refuses to ${label} the failed sign-in entry`, error, `audit_logs is append-only: ${label === 'edit' ? 'UPDATE' : 'DELETE'} is not allowed`);
    }
  } finally {
    await db.end();
  }
});

// STORY-012 evidence: the citizen dashboard (applications, eligibility, case history, notifications) and Staff
// Access (case-manager access granted in the app by an existing case manager, never by registering).
//
// Runs on the same local stack as story-008.mjs, against a FRESH database, with the evidence backend's
// CASE_MANAGER_EMAILS listing dana.whitfield@example.com and sam.ortiz@example.com:
//   E2E_BASE=http://localhost:3002/api node scripts/evidence/story-012.mjs
// Screenshots land in docs/evidence/story-012/.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { account, call, exemptionId, expect, run, staffAccount } from '../e2e/lib.mjs';
import { launch } from './browser.mjs';

const SITE = process.env.EVIDENCE_SITE || 'http://localhost:4173';
const OUT = fileURLToPath(new URL('../../docs/evidence/story-012/', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const setStatus = (token, caseId, status, reason) => call('POST', `/cases/${caseId}/status`, token, { status, reason });
const apply = async (token, type) => (await call('POST', '/cases', token, { exemptionId: await exemptionId(token, type) })).data.id;
const NOTE = 'Internal: compare the income statement with the 2025 return before deciding.';

run(async () => {
  mkdirSync(OUT, { recursive: true });

  // The first listed address bootstraps an empty system; after that, being listed grants nothing
  const dana = await staffAccount('dana.whitfield@example.com', 'Dana Whitfield');
  expect('Dana bootstraps the empty system as its first case manager', dana.user.role, 'case_manager');
  const samRegistered = await account('sam.ortiz@example.com', 'Sam Ortiz');
  expect('Sam is listed in CASE_MANAGER_EMAILS but registers as a citizen, because staff exist', samRegistered.user.role, 'citizen');
  expect('so the staff pages refuse him', (await call('GET', '/cases/stats', samRegistered.token)).status, 403);

  // Jordan Rivera: Type A approved; Type B denied with a reason, then appealed; an internal note on Type B
  const jordan = await account('jordan.rivera@example.com', 'Jordan Rivera', '1951-02-20');
  await call('PUT', `/users/${jordan.user.id}`, jordan.token, { phone: '555-0108', address: '27 Oak Avenue, Columbus, OH', annualIncome: 18500 });
  const typeA = await apply(jordan.token, 'Type A');
  const typeB = await apply(jordan.token, 'Type B');
  await call('POST', `/cases/${typeA}/documents`, jordan.token, { documentType: 'proof_of_age', documentUrl: 'https://example.com/jordan-rivera-birth-certificate.pdf' });
  for (const id of [typeA, typeB]) {
    await call('PUT', `/cases/${id}/assignment`, dana.token, { assignedTo: dana.user.email });
    await setStatus(dana.token, id, 'In Review');
  }
  await call('POST', `/cases/${typeB}/notes`, dana.token, { content: NOTE });
  expect('Type A approved', (await setStatus(dana.token, typeA, 'Approved')).data.status, 'Approved');
  expect('Type B denied with a reason', (await setStatus(dana.token, typeB, 'Denied', 'The income statement on file is from 2024; please upload a current one.')).data.status, 'Denied');
  expect('Jordan appeals the denial', (await setStatus(jordan.token, typeB, 'Appealed')).data.status, 'Appealed');

  const dash = (await call('GET', '/dashboards/citizen', jordan.token)).data;
  expect('the dashboard lists both applications with their status', dash.applications.map((a) => a.status).sort(), ['Appealed', 'Approved']);
  expect('the case history shows the decisions', dash.history.some((h) => /Denied/.test(h.description)) && dash.history.some((h) => /Approved/.test(h.description)), true);
  expect('the internal note and the SSN never reach the applicant', /compare the income statement|900-00-0010|ssn/i.test(JSON.stringify(dash)), false);
  expect('unread notifications are counted', dash.notifications.unread > 0, true);
  expect('another applicant gets only their own dashboard', (await call('GET', '/dashboards/citizen', samRegistered.token)).data.applications.length, 0);

  const taylor = await account('taylor.brooks@example.com', 'Taylor Brooks', '1990-07-04');

  const page = await launch();
  const shot = async (name) => {
    await page.screenshot(`${OUT}${name}.png`);
    console.log(`      saved ${name}.png`);
  };
  try {
    // 1. Jordan's dashboard: applications with next steps, eligibility, recent activity, notifications
    await page.signIn(SITE, jordan);
    await page.goto(`${SITE}/dashboard`);
    await page.waitForText('Your appeal is waiting for review.');
    expect('the page shows each application and its next step', [await page.hasText('Your applications'), await page.hasText('Exemption granted. Nothing more to do.')], [true, true]);
    expect('no internal note on the page', await page.hasText('compare the income statement'), false);
    await shot('01-citizen-dashboard');

    // 2. A new registrant: what to do first
    await page.signIn(SITE, taylor);
    await page.goto(`${SITE}/dashboard`);
    await page.waitForText('No applications yet.');
    await shot('02-new-applicant');

    // 3-4. Dana gives Sam case-manager access on Staff Access, with a reason, confirmed in place
    await page.signIn(SITE, dana);
    await page.goto(`${SITE}/staff`);
    await page.waitForText('Current staff');
    await page.type('#grant-email', 'sam.ortiz@example.com');
    await page.type('#grant-reason', 'Second case manager, so every decision can be reviewed by someone else.');
    await page.click('Give access');
    await page.waitForText('Confirm: give sam.ortiz@example.com case-manager access?');
    await shot('03-staff-access-confirm');
    await page.click('Confirm access');
    await page.waitForText('sam.ortiz@example.com', 10_000);
    await sleep(800);
    expect('the change is confirmed on the page', Boolean(await page.evaluate(`document.querySelector('[role="status"]')?.innerText.trim()`)), true);
    await shot('04-access-granted');
  } finally {
    await page.close();
  }

  // The grant takes effect at once, is recorded, and the person is told
  expect('Sam can now open the staff pages', (await call('GET', '/cases/stats', samRegistered.token)).status, 200);
  const sam = await account('sam.ortiz@example.com', 'Sam Ortiz');
  expect('and signs in as a case manager', sam.user.role, 'case_manager');
  const inbox = (await call('GET', '/notifications?limit=10', sam.token)).data;
  expect('Sam is told who granted access', JSON.stringify(inbox).includes('granted by dana.whitfield@example.com'), true);
  expect('nobody can remove their own access', (await call('POST', `/staff/${sam.user.id}/revoke`, sam.token, { reason: 'Trying to remove myself' })).status, 403);

  // 5. The Security Audit Log: the bootstrap grant and Dana's grant, each with who, why and how
  const page2 = await launch();
  try {
    await page2.signIn(SITE, sam);
    await page2.goto(`${SITE}/audit`);
    await page2.waitForText('Write-once');
    await page2.select('#l-action', 'PERMISSION_GRANT');
    await page2.click('Search');
    await page2.waitForText('Staff Access');
    expect('both grants are listed: the bootstrap and Dana\'s', [await page2.hasText('bootstrap (no staff yet)'), await page2.hasText('Second case manager')], [true, true]);
    await page2.screenshot(`${OUT}05-role-changes-audit.png`);
    console.log('      saved 05-role-changes-audit.png');
  } finally {
    await page2.close();
  }
});

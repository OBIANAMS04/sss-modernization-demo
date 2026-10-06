// STORY-008 evidence: seeds a small scenario through the API, then drives a compliance review
// through the real UI in headless Chrome, checking each screen and saving a screenshot of it.
//
// Needs a FRESH database (the dashboard counts every decision), a backend whose
// CASE_MANAGER_EMAILS lists the two managers below, and a frontend built against that backend:
//   createdb -U admin sss_demo_shots
//   cd backend && DATABASE_NAME=sss_demo_shots PORT=3002 CORS_ORIGIN=http://localhost:4173 \
//     CASE_MANAGER_EMAILS="dana.whitfield@example.com,sam.ortiz@example.com" node dist/index.js
//   cd frontend && VITE_API_BASE_URL=http://localhost:3002/api npx vite build --outDir <dir> --emptyOutDir
//                && npx vite preview --outDir <dir> --port 4173
//   E2E_BASE=http://localhost:3002/api node scripts/evidence/story-008.mjs
// Screenshots land in docs/evidence/story-008/.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { account, call, exemptionId, expect, run } from '../e2e/lib.mjs';
import { launch } from './browser.mjs';

const SITE = process.env.EVIDENCE_SITE || 'http://localhost:4173';
const OUT = fileURLToPath(new URL('../../docs/evidence/story-008/', import.meta.url));

const openCase = async (token, type) => (await call('POST', '/cases', token, { exemptionId: await exemptionId(token, type) })).data.id;
const setStatus = (token, caseId, status, reason) => call('POST', `/cases/${caseId}/status`, token, { status, reason });

run(async () => {
  mkdirSync(OUT, { recursive: true });
  const dana = await account('dana.whitfield@example.com', 'Dana Whitfield');
  const sam = await account('sam.ortiz@example.com', 'Sam Ortiz');
  expect('two case managers', [dana.user.role, sam.user.role], ['case_manager', 'case_manager']);
  if ((await call('GET', '/compliance/dashboard?days=30', sam.token)).data.totalDecisions !== 0) {
    throw new Error('Run this against a fresh database: the dashboard already has decisions.');
  }

  // Casey Morgan: Type B (low income), income statement on file, assigned to and approved by Dana
  const casey = await account('casey.morgan@example.com', 'Casey Morgan', '1988-04-12');
  await call('PUT', `/users/${casey.user.id}`, casey.token, { phone: '555-0142', address: '18 Elm Street, Dayton, OH', annualIncome: 15000 });
  const caseyCase = await openCase(casey.token, 'Type B');
  await call('POST', `/cases/${caseyCase}/documents`, casey.token, { documentType: 'income_statement', documentUrl: 'https://example.com/casey-morgan-w2.pdf' });
  await call('PUT', `/cases/${caseyCase}/assignment`, dana.token, { assignedTo: dana.user.email });
  await setStatus(dana.token, caseyCase, 'In Review');
  expect('Casey approved', (await setStatus(dana.token, caseyCase, 'Approved')).data.status, 'Approved');

  // Taylor Brooks: Type A, denied with a reason by Sam
  const taylor = await account('taylor.brooks@example.com', 'Taylor Brooks', '1949-11-02');
  await call('POST', '/exemptions/check', taylor.token);
  const taylorCase = await openCase(taylor.token, 'Type A');
  await call('PUT', `/cases/${taylorCase}/assignment`, sam.token, { assignedTo: sam.user.email });
  await setStatus(sam.token, taylorCase, 'In Review');
  expect('Taylor denied', (await setStatus(sam.token, taylorCase, 'Denied', 'Proof of age was not provided.')).data.status, 'Denied');

  // Jordan Rivera: Type A, approved by Dana without being assigned and without proof of age
  const jordan = await account('jordan.rivera@example.com', 'Jordan Rivera', '1951-02-20');
  await call('POST', '/exemptions/check', jordan.token);
  const jordanCase = await openCase(jordan.token, 'Type A');
  await setStatus(dana.token, jordanCase, 'In Review');
  expect('Jordan approved', (await setStatus(dana.token, jordanCase, 'Approved')).data.status, 'Approved');

  const page = await launch();
  const shot = async (name) => {
    await page.screenshot(`${OUT}${name}.png`);
    console.log(`      saved ${name}.png`);
  };
  try {
    // 1. Sam sees the alert and the open review
    await page.signIn(SITE, sam);
    await page.goto(`${SITE}/compliance`);
    await page.waitForText('Below target');
    expect('dashboard: 2 of 3 decisions compliant, alert raised', await page.hasText('Compliance rate 66.67% is below the 99% target'), true);
    expect('dashboard: Jordan listed under open reviews', await page.hasText('Jordan Rivera · Type A · Approved by dana.whitfield@example.com'), true);
    await shot('01-dashboard-alert');

    // 2. Dana sees which controls her decision failed, and cannot resolve the review herself
    await page.signIn(SITE, dana);
    await page.goto(`${SITE}/cases/${jordanCase}`);
    await page.waitForText('Compliance review open');
    expect('decider: failed controls named', await page.hasText('failed CTRL-05, CTRL-07'), true);
    expect('decider: told to ask another manager', await page.hasText('A different case manager must resolve a review of your own decision.'), true);
    expect('decider: no resolve buttons', await page.evaluate(`![...document.querySelectorAll('button')].some((b) => b.innerText === 'Reopen case')`), true);
    await shot('02-decider-cannot-resolve');

    // 3-4. Sam writes a justification and reopens the case through the UI
    await page.signIn(SITE, sam);
    await page.goto(`${SITE}/cases/${jordanCase}`);
    await page.waitForText('Compliance review open');
    await page.type('#review-note', 'Approved without proof of age and without an assigned reviewer. Reopening so the applicant can provide it.');
    await shot('03-reviewer-justifies');
    await page.click('Reopen case');
    await page.waitForText('Case reopened for review.');
    expect('reopened: timeline records why', await page.hasText('Reason: Reopened after a compliance review'), true);
    expect('reopened: review closed with the note', await page.hasText('case reopened by sam.ortiz@example.com'), true);
    await shot('04-case-reopened');

    // 5. Jordan provides proof of age; Sam takes the case and approves it again, compliantly
    await call('POST', `/cases/${jordanCase}/documents`, jordan.token, { documentType: 'proof_of_age', documentUrl: 'https://example.com/jordan-rivera-birth-certificate.pdf' });
    await page.goto(`${SITE}/cases/${jordanCase}`);
    await page.waitForText('Assign to me');
    await page.click('Assign to me');
    await page.waitForText('Assigned to you.');
    await page.click('Approve');
    await page.waitForText('Case moved to Approved.');
    expect('re-decided: all controls passed', await page.hasText('All controls passed'), true);
    await page.click('1 earlier decision');
    await page.waitForText('not compliant');
    await shot('05-redecided-compliant');

    // 6. The audit log, filtered to failed checks
    await page.goto(`${SITE}/compliance/audit`);
    await page.waitForText('Search');
    await page.select('#a-result', 'fail');
    await page.click('Search');
    await page.waitForText('2 checks');
    expect(
      'audit log: only the two failed checks',
      await page.evaluate(`[...document.querySelectorAll('tbody tr')].map((tr) => tr.cells[3].querySelector('p').innerText + ' ' + tr.cells[4].innerText)`),
      ['CTRL-05 Failed', 'CTRL-07 Failed']
    );
    await shot('06-audit-log-failures');

    // 7. Dashboard after the review: nothing open, the failed decision still counts
    await page.goto(`${SITE}/compliance`);
    await page.waitForText('Every failed decision has been reviewed.');
    expect('dashboard after: 3 of 4 compliant, no open reviews', [await page.hasText('Compliance rate 75% is below'), await page.hasText('No open reviews.')], [true, true]);
    await shot('07-dashboard-after-review');

    // 8. The applicant sees the outcome and the reason, but no compliance internals
    await page.signIn(SITE, jordan);
    await page.goto(`${SITE}/cases/${jordanCase}`);
    await page.waitForText('Your application');
    expect('applicant: no compliance panel or link', await page.evaluate(
      `!document.querySelector('a[href="/compliance"]') && !document.body.innerText.includes('Decision controls, checked automatically')`
    ), true);
    expect('applicant: sees why the case was reopened', await page.hasText('Reason: Reopened after a compliance review'), true);
    await shot('08-applicant-view');
    await page.goto(`${SITE}/compliance`);
    await page.waitForText('available to case managers only');
  } finally {
    await page.close();
  }
});

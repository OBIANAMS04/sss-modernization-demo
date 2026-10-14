// STORY-016 evidence: access policies decided by Open Policy Agent on every request, changed by an administrator in the
// app without a deploy. Runs right after story-003-015.mjs on the same database (it uses that run's people and cases):
//   E2E_BASE=http://localhost:3002/api node scripts/evidence/story-016.mjs
// Screenshots land in docs/evidence/story-016/. The policy is back to its defaults at the end.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { account, call, expect, run } from '../e2e/lib.mjs';
import { launch } from './browser.mjs';

const SITE = process.env.EVIDENCE_SITE || 'http://localhost:4173';
const OUT = fileURLToPath(new URL('../../docs/evidence/story-016/', import.meta.url));
const TEAM_RULE = 'team visibility';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

run(async () => {
  mkdirSync(OUT, { recursive: true });
  const morgan = await account('morgan.lee@example.com', 'Morgan Lee');
  const dana = await account('dana.whitfield@example.com', 'Dana Whitfield');
  const sam = await account('sam.ortiz@example.com', 'Sam Ortiz');
  const listed = (await call('GET', '/cases?scope=all&applicant=Pat%20Kim', dana.token)).data;
  const pat = (Array.isArray(listed) ? listed : listed.cases)[0];
  expect("by default Sam can open Pat Kim's case, which is assigned to Dana", (await call('GET', `/cases/${pat.id}`, sam.token)).status, 200);

  const page = await launch();
  const shot = async (name) => {
    await page.screenshot(`${OUT}${name}.png`);
    console.log(`      saved ${name}.png`);
  };
  try {
    // 1. Morgan switches team visibility off, with a reason
    await page.signIn(SITE, morgan);
    await page.goto(`${SITE}/admin/policies`);
    await page.waitForText('Case and account rules');
    expect('the page names the engine', await page.hasText('Open Policy Agent'), true);
    await page.evaluate(`[...document.querySelectorAll('label')].find((l) => l.innerText.includes(${JSON.stringify(TEAM_RULE)})).querySelector('input').click(); true`);
    await page.type('main textarea', 'Pilot: case managers work only their own cases, the queue and reviews.');
    await page.waitForText('Changed, not saved yet');
    await shot('01-policy-change');
    await page.click('Save policy');
    await page.waitForText('Pilot: case managers work only their own cases');
    await sleep(500);

    // 2. At once, with no deploy: Sam is refused a case assigned to Dana
    await page.signIn(SITE, sam);
    await page.goto(`${SITE}/cases/${pat.id}`);
    await page.waitForText('Access denied');
    expect('the case page says why', await page.hasText('a case assigned to someone else'), true);
    await shot('02-policy-refusal');

    // 3. The refusal in the Security Audit Log, with the rule and the policy version
    await page.signIn(SITE, dana);
    await page.goto(`${SITE}/audit`);
    await page.waitForText('Write-once');
    await page.type('#l-user', 'sam.ortiz@example.com');
    await page.select('#l-action', 'ACCESS_DENIED');
    await page.click('Search');
    await page.waitForText('no-matching-rule');
    await shot('03-policy-audit');
  } finally {
    await page.close();
  }

  // Back to the defaults through the API, then the history as Morgan sees it
  const restored = await call('PUT', '/policies', morgan.token, { rules: { 'case-manager-team': true }, reason: 'Pilot over: team visibility back on.' });
  expect('the defaults are back', [restored.status, (await call('GET', `/cases/${pat.id}`, sam.token)).status], [200, 200]);
  const page2 = await launch();
  try {
    await page2.signIn(SITE, morgan);
    await page2.goto(`${SITE}/admin/policies`);
    await page2.waitForText('Pilot over: team visibility back on.');
    await page2.evaluate(`document.querySelector('h2[tabindex]') && [...document.querySelectorAll('h2')].find((h) => h.innerText === 'History').scrollIntoView(); true`);
    await page2.screenshot(`${OUT}04-policy-history.png`);
    console.log('      saved 04-policy-history.png');
  } finally {
    await page2.close();
  }
});

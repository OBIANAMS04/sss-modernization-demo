// STORY-035 evidence: the training portal through the real pages of a LOCAL stack (backend with ADMIN_EMAILS listing
// morgan.lee@example.com; site built for that API and served at the given address).
//   E2E_BASE=http://localhost:3001/api node scripts/evidence/r3-training.mjs http://localhost:4173
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
import { adminAccount, call, leadershipAccount, stamp, staffAccount, MANAGER } from '../e2e/lib.mjs';

const SITE = process.argv[2] || 'http://localhost:4173';
const out = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'docs/evidence/r3-m3');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await staffAccount(MANAGER, 'Morgan Manager'); // the first case manager, who grants the role to the next
const manager = await staffAccount(`training-cm-${stamp}@example.com`, 'Casey Manager');
const admin = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
const leader = await leadershipAccount(`training-shots-${stamp}@example.com`, 'Lee Leader');
// The right answers come back with any graded attempt; the screens show a person answering, so we read them first
const graded = await call('POST', '/training/case-work/attempts', admin.token, { answers: { cw1: 0, cw2: 0, cw3: 0, cw4: 0 } });
const key = Object.fromEntries(graded.data.results.map((r) => [r.questionId, r.correctOption]));

const page = await launch({ width: 1280, height: 900 });
try {
  await page.signIn(SITE, manager);
  await page.goto(`${SITE}/training`);
  await page.waitForText('Start Case work');
  await page.screenshot(join(out, '01-training-modules.png'));

  await page.click('Start Case work', 'button');
  await page.waitForText('Knowledge check');
  await page.screenshot(join(out, '02-training-module-open.png'));

  // Answer: three right and one wrong, to show a pass with an explanation of the miss
  const choose = (q, n) => page.evaluate(`(() => { document.querySelector('input[name="case-work-${q}"][value="${n}"]').click(); return true; })()`);
  await choose('cw1', key.cw1);
  await choose('cw2', key.cw2);
  await choose('cw3', key.cw3);
  await choose('cw4', (key.cw4 + 1) % 4);
  await page.click('Check my answers', 'button');
  await page.waitForText('Passed: 3 of 4');
  await sleep(300);
  await page.evaluate(`(() => { document.querySelector('#check-case-work').scrollIntoView(); return true; })()`);
  await page.screenshot(join(out, '03-training-knowledge-check-result.png'));

  await page.signIn(SITE, leader);
  await page.goto(`${SITE}/training`);
  await page.waitForText('Start Leadership');
  await page.screenshot(join(out, '04-training-leadership.png'));

  await page.signIn(SITE, admin);
  await page.goto(`${SITE}/training`);
  await page.waitForText('Team progress');
  await page.waitForText(manager.user.email);
  await page.screenshot(join(out, '05-training-team-progress.png'));
  console.log('wrote 5 training screens');
} finally {
  await page.close();
}

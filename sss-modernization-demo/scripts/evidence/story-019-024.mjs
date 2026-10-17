// STORY-019, 023 and 024 evidence: the policy assistant page, its review queue and the override rate, driven through the real UI in
// headless Chrome, checking each screen and saving a screenshot of it. Needs a backend running with AI_PROVIDER=stub (a deterministic
// stand-in: no key, no call to any model) and ADMIN_EMAILS listing morgan.lee@example.com, and a frontend built against it:
//   createdb -U admin sss_demo_shots
//   cd backend && DATABASE_NAME=sss_demo_shots PORT=3002 CORS_ORIGIN=http://localhost:4173 AI_PROVIDER=stub ADMIN_EMAILS=morgan.lee@example.com \
//     CASE_MANAGER_EMAILS="manager-local-test@example.com,reviewer-local-test@example.com" node dist/index.js
//   cd frontend && VITE_API_BASE_URL=http://localhost:3002/api npx vite build --outDir <dir> --emptyOutDir
//                && npx vite preview --outDir <dir> --port 4173
//   E2E_BASE=http://localhost:3002/api node scripts/evidence/story-019-024.mjs
// Screenshots land in docs/evidence/story-019-024/ (EVIDENCE_OUT names another folder). Everything is synthetic demo data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { account, adminAccount, call, exemptionId, expect, leadershipAccount, MANAGER, REVIEWER, run, stamp, staffAccount } from '../e2e/lib.mjs';
import { launch } from './browser.mjs';

const SITE = process.env.EVIDENCE_SITE || 'http://localhost:4173';
const OUT = process.env.EVIDENCE_OUT ? `${process.env.EVIDENCE_OUT.replace(/\/?$/, '/')}` : fileURLToPath(new URL('../../docs/evidence/story-019-024/', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const QUESTION = `What is the income limit for the Type B exemption? (${stamp})`;
const PERSONAL = `Am I eligible for the senior exemption? (${stamp})`;
const CORRECTION = `Eligibility is decided by a case manager from your case, not by this assistant. (${stamp})`;

run(async () => {
  mkdirSync(OUT, { recursive: true });
  const citizen = await account(`avery.lane.${stamp}@example.com`, 'Avery Lane');
  await staffAccount(MANAGER, 'Manager Test');
  const reviewer = await staffAccount(REVIEWER, 'Reviewer Test');
  const admin = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
  const lead = await leadershipAccount(`riley.chen.${stamp}@example.com`, 'Riley Chen');

  // Some decisions for the override rate: two approvals that agree with the eligibility check and a denial of someone it found Eligible
  const decide = async (label, status, reason) => {
    const person = await account(`evidence-${label}-${stamp}@example.com`, `Evidence ${label}`);
    await call('PUT', `/users/${person.user.id}`, person.token, { phone: '555-0160', address: '4 Oak Lane, Dayton, OH' });
    const caseId = (await call('POST', '/cases', person.token, { exemptionId: await exemptionId(person.token, 'Type A') })).data.id;
    if (status === 'Approved') await call('POST', `/cases/${caseId}/documents`, person.token, { documentType: 'proof_of_age', documentUrl: 'https://example.com/birth.pdf' });
    await call('PUT', `/cases/${caseId}/assignment`, reviewer.token, { assignedTo: reviewer.user.email });
    await call('POST', `/cases/${caseId}/status`, reviewer.token, { status: 'In Review' });
    await call('POST', `/cases/${caseId}/status`, reviewer.token, { status, reason });
  };
  await decide('one', 'Approved');
  await decide('two', 'Approved');
  await decide('three', 'Denied', 'Proof of age not provided.');

  const page = await launch();
  const shot = async (name) => {
    await page.screenshot(`${OUT}${name}.png`);
    console.log(`      saved ${name}.png`);
  };
  /** A screenshot of one section of a dashboard, found by its heading. */
  const shotSection = async (title, name) => {
    const rect = await page.evaluate(`(() => {
      const s = [...document.querySelectorAll('h2')].find((h) => h.innerText.trim() === ${JSON.stringify(title)})?.closest('section');
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
    })()`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: Math.ceil(rect.y + rect.height + 40), deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } });
    writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    console.log(`      saved ${name}.png`);
  };
  const active = () => page.evaluate(`(() => { const e = document.activeElement; return e ? e.tagName + ':' + (e.innerText || e.id || '').trim().slice(0, 40) : null; })()`);
  try {
    // 1. A citizen asks. The answer is checked, says how much oversight it got, and cites the policy
    await page.signIn(SITE, citizen);
    await page.goto(`${SITE}/assistant`);
    await page.waitForText('Your question');
    await sleep(300);
    await shot('01-assistant');
    await page.type('textarea', QUESTION);
    await page.click('Ask', 'button');
    await page.waitForText('Checked against the policy');
    await sleep(400);
    expect('focus goes to the answer', await active(), 'H2:Answer');
    expect('two numbered citations in the answer', await page.evaluate(`[...document.querySelectorAll('main p button')].filter((b) => /^\\[\\d\\]/.test(b.innerText.trim())).length`), 2);
    await shot('02-assistant-answer');

    // 2. A number in the answer opens the passage and puts focus on its button
    await page.evaluate(`[...document.querySelectorAll('main p button')].find((b) => /^\\[2\\]/.test(b.innerText.trim())).click(); true`);
    await sleep(700);
    expect('the second source is open and has focus', [(await active()).startsWith('BUTTON:[2]'), await page.evaluate(`document.activeElement.getAttribute('aria-expanded')`)], [true, 'true']);
    await shot('03-assistant-citation-open');

    // 3. Feedback: helpful, then a reported problem with a comment, which withholds the answer and sends it to the review queue
    await page.click('Helpful', 'button');
    await sleep(600);
    await page.click('Report a problem', 'button');
    await sleep(300);
    await page.send('Input.insertText', { text: 'It does not say what happens at exactly $20,000.' });
    await shot('04-assistant-report');
    await page.click('Send report', 'button');
    await page.waitForText('A case manager will review this question and reply');
    await sleep(500);
    await shot('05-assistant-reported');

    // 4. A question about the person's own eligibility is not answered by the assistant: it waits for a case manager
    await page.type('textarea', PERSONAL);
    await page.click('Ask', 'button');
    await sleep(1500);
    expect('it is withheld for a case manager', await page.hasText('A case manager will review this question and reply'), true);

    // 5. A case manager's queue: the draft, its citations, the grounding result and why it is here; a review that is not complete is refused
    await page.signIn(SITE, reviewer);
    await page.goto(`${SITE}/assistant/reviews`);
    await page.waitForText('Waiting for review');
    await sleep(700);
    const card = await page.evaluate(`[...document.querySelectorAll('article h3')].findIndex((h) => h.innerText === ${JSON.stringify(PERSONAL)})`);
    expect('the question is waiting', card >= 0, true);
    const inCard = (code) => page.evaluate(`(() => { const card = document.querySelectorAll('article')[${card}]; ${code} })()`);
    await inCard(`card.scrollIntoView(); card.querySelector('button[type=submit]').click(); return true;`);
    await sleep(400);
    expect('an empty review is refused in words, and focus is on the first field', await inCard(`return [card.querySelectorAll('[role=alert]').length, document.activeElement.tagName];`), [2, 'SELECT']);
    await shot('06-reviews-queue');

    // 6. The case manager corrects the draft, with a note for the record; the card leaves the queue
    await inCard(`const s = card.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'corrected'); s.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
    await sleep(300);
    await inCard(`card.querySelectorAll('textarea')[0].focus(); return true;`);
    await page.send('Input.insertText', { text: CORRECTION });
    await inCard(`card.querySelectorAll('textarea')[1].focus(); return true;`);
    await page.send('Input.insertText', { text: 'The draft treated a question about the person\'s own case as a general one.' });
    await shot('07-reviews-correction');
    await inCard(`[...card.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Send review').click(); return true;`);
    await sleep(1500);
    expect('the review is confirmed and the card is gone', await page.evaluate(`[document.querySelector('[role=status]')?.innerText.startsWith('Corrected.'), [...document.querySelectorAll('article h3')].some((h) => h.innerText === ${JSON.stringify(PERSONAL)})]`), [true, false]);
    await shot('08-reviews-sent');

    // 7. The citizen sees the reviewed answer, marked as reviewed, and is notified
    await page.signIn(SITE, citizen);
    await page.goto(`${SITE}/assistant`);
    await page.waitForText('Your recent questions');
    await sleep(700);
    expect('the history shows the correction, marked as reviewed', [await page.hasText('Reviewed by a case manager'), await page.hasText(CORRECTION)], [true, true]);
    await shot('09-assistant-history-reviewed');
    await page.goto(`${SITE}/dashboard`);
    await page.waitForText('Notifications');
    await sleep(500);
    expect('the notification carries the reply', await page.hasText('A case manager reviewed your policy question'), true);
    await shot('10-citizen-notification');

    // 8. The same page at 320 px, with an answer
    await page.goto(`${SITE}/assistant`);
    await page.waitForText('Your question');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const { cssContentSize } = await page.send('Page.getLayoutMetrics');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: Math.ceil(cssContentSize.height), deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    expect('no sideways scrolling at 320 px', await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}11-assistant-320px.png`, Buffer.from(data, 'base64'));
    console.log('      saved 11-assistant-320px.png');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    // 9. The override rate, on the admin and leadership dashboards
    await page.signIn(SITE, admin);
    await page.goto(`${SITE}/admin`);
    await page.waitForText('Override rate');
    await sleep(600);
    await shotSection('Override rate', '12-admin-override-rate');
    await page.signIn(SITE, lead);
    await page.goto(`${SITE}/leadership`);
    await page.waitForText('Override rate');
    await sleep(600);
    expect('leadership sees it too, as counts and rates', await page.hasText('Items reviewed'), true);
    await shotSection('Override rate', '13-leadership-override-rate');

    // 10. The audit log: the assistant's entries, with what happened to each exchange and never the question
    await page.signIn(SITE, reviewer);
    await page.goto(`${SITE}/audit`);
    await page.waitForText('Write-once');
    await page.select('#l-resource', 'assistant');
    await page.click('Search');
    await page.waitForText('AI_REVIEW'); // the code in the table, which the filter's own option labels do not hold
    await sleep(500);
    expect('the audit log never holds the question', await page.hasText(QUESTION), false);
    await shot('14-audit-assistant');
  } finally {
    await page.close();
  }
});

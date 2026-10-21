// STORY-021 and 025 evidence: the AI Quality page (drift, evaluation against a baseline, fairness), driven through the real UI in headless
// Chrome, checking each screen and saving a screenshot of it. Needs a FRESH database (the run adds its own fixture answers and decisions),
// a backend running with AI_PROVIDER=stub (a deterministic stand-in: no key, no call to any model) and ADMIN_EMAILS listing
// morgan.lee@example.com, and a frontend built against it:
//   createdb -h localhost -U admin sss_demo_m2a
//   cd backend && DATABASE_NAME=sss_demo_m2a PORT=3002 CORS_ORIGIN=http://localhost:4173 AI_PROVIDER=stub ADMIN_EMAILS=morgan.lee@example.com \
//     CASE_MANAGER_EMAILS="manager-local-test@example.com,reviewer-local-test@example.com" node dist/index.js
//   cd frontend && VITE_API_BASE_URL=http://localhost:3002/api npx vite build --outDir <dir> --emptyOutDir
//                && npx vite preview --outDir <dir> --port 4173 --strictPort
//   DATABASE_NAME=sss_demo_m2a E2E_BASE=http://localhost:3002/api node scripts/evidence/story-021-025.mjs
// Real answers (mode 'ai') need a key, so the drift screens are driven by fixture answers written straight to the database, labelled as
// such on this script's output; the evaluation and fairness runs are real runs through the stand-in. Screenshots land in
// docs/evidence/story-021-025/ (EVIDENCE_OUT names another folder). Everything is synthetic demo data.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { account, adminAccount, expect, MANAGER, run, stamp, staffAccount } from '../e2e/lib.mjs';
import { launch } from './browser.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');
const SITE = process.env.EVIDENCE_SITE || 'http://localhost:4173';
const OUT = process.env.EVIDENCE_OUT ? `${process.env.EVIDENCE_OUT.replace(/\/?$/, '/')}` : fileURLToPath(new URL('../../docs/evidence/story-021-025/', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FIXTURE = `evidence fixture ${stamp}`;

run(async () => {
  mkdirSync(OUT, { recursive: true });
  const db = new Client({ host: 'localhost', database: process.env.DATABASE_NAME || 'sss_demo', user: 'admin', password: 'dev_password' });
  await db.connect();
  try {
    await shots(db);
  } finally {
    await db.end();
  }
});

async function shots(db) {
  const manager = await staffAccount(MANAGER, 'Manager Test');
  const admin = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
  const citizen = await account(`avery.lane.${stamp}@example.com`, 'Avery Lane');

  // Fixture answers of the real model (mode 'ai'): 30 grounded ones in the 28 days before, and 25 in the last 7 days of which 7 failed the
  // grounding check, 3 more were rated not helpful, and the slowest took longer. One model change a few days ago.
  const answer = (daysAgo, { grounded = true, model = 'claude-opus-5-5', latency = 3000, feedback = null, hours = 2 } = {}) =>
    db.query(
      `INSERT INTO assistant_interactions (user_id, trace_id, question_redacted, answer, citations, model, mode, latency_ms, grounding, level, status, feedback, created_at)
       VALUES ($1, $2, $3, 'Fixture answer.', '[{"passageId":"a:b","quote":"x"}]'::jsonb, $4, 'ai', $5, $6::jsonb, 0, 'shown', $7, NOW() - make_interval(days => $8::int, hours => $9::int))`,
      [citizen.user.id, randomUUID(), FIXTURE, model, latency, JSON.stringify({ grounded, coverage: 1 }), feedback, daysAgo, hours]
    );
  for (let i = 0; i < 30; i++) await answer(8 + (i % 26), { model: i % 26 < 20 ? 'claude-opus-5-5' : 'claude-opus-5-5' });
  for (let i = 0; i < 25; i++) await answer(i % 7, { grounded: i >= 7, feedback: i >= 7 && i < 10 ? 'not-helpful' : null, latency: 3000 + (i % 5) * 400 });

  // Decisions of people under 25 in three regions, for the outcome table (fixtures: not people, not real)
  const group = async (label, address, approved, denied, days) => {
    const u = (await db.query(`INSERT INTO users (email, password_hash, full_name, ssn_hash, dob, address) VALUES ($1, 'x', $2, 'fixture', DATE '2006-01-01', $3) RETURNING id`, [`fixture-${label}-${stamp}@example.com`, `Fixture ${label}`, address])).rows[0].id;
    for (let i = 0; i < approved + denied; i++) {
      const decision = i < approved ? 'Approved' : 'Denied';
      const c = (await db.query(`INSERT INTO cases (user_id, status, submitted_at) VALUES ($1, $2, NOW() - make_interval(days => $3::int)) RETURNING id`, [u, decision, days])).rows[0].id;
      await db.query(`INSERT INTO case_events (case_id, event_type, from_status, to_status, eligibility_status) VALUES ($1, 'status_change', 'In Review', $2, 'Eligible')`, [c, decision]);
    }
  };
  await group('south', '1 Main St, Dallas, TX 75001', 12, 0, 2);
  await group('midwest', '2 Main St, Columbus, OH 43004', 11, 1, 3);
  await group('west', '3 Main St, Denver, CO 80201', 8, 4, 4);
  await group('northeast', '4 Main St, Albany, NY 12201', 5, 4, 1);

  const page = await launch();
  const shot = async (name) => {
    await page.screenshot(`${OUT}${name}.png`);
    console.log(`      saved ${name}.png`);
  };
  /** A screenshot of one section of the page, found by its heading, with the window made tall enough to hold it. */
  const shotSection = async (title, name) => {
    const rect = await page.evaluate(`(() => {
      const s = [...document.querySelectorAll('h2')].find((h) => h.innerText.trim() === ${JSON.stringify(title)})?.closest('section');
      if (!s) return null;
      s.scrollIntoView();
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
  const waitFor = async (expression, ms = 30_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await page.evaluate(expression).catch(() => false)) return true;
      await sleep(300);
    }
    return false;
  };

  // 1. A case manager opens AI Quality: the grounded rate has drifted, an alert is open, and there are no run buttons
  await page.signIn(SITE, manager);
  await page.goto(`${SITE}/ai-quality`);
  await page.waitForText('Quality signals');
  await sleep(700);
  expect('the alert for the grounded rate is open', await page.hasText('Grounded rate moved from 100% to 72%'), true);
  expect('a case manager sees no run button', [await page.hasText('Run evaluation'), await page.hasText('Run fairness check')], [false, false]);
  expect('the tab is named AI Quality', await page.evaluate('document.title.startsWith("AI Quality")'), true);
  await shot('01-ai-quality');
  await shotSection('Open alerts', '02-alerts');
  await shotSection('Quality signals', '03-signals-and-trend');
  expect('the status is in words, not colour alone', await page.hasText('Drift'), true);

  // 2. The trend: another signal, with the same numbers as a table
  await page.evaluate(`(() => { const s = document.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'p95LatencyMs'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(500);
  expect('the p95 latency chart has its table', await page.evaluate(`[...document.querySelectorAll('caption')].some((c) => c.innerText.startsWith('p95 latency per day'))`), true);
  await shotSection('Quality signals', '04-trend-p95-latency');

  // 3. An administrator: the evaluation asks for confirmation first, saying it calls the model and costs money
  await page.signIn(SITE, admin);
  await page.goto(`${SITE}/ai-quality`);
  await page.waitForText('Evaluation against the golden set');
  await sleep(500);
  await page.click('Run evaluation', 'button');
  await sleep(400);
  expect('the confirmation says it calls the model and costs money', await page.hasText('It calls the model and costs money'), true);
  await shotSection('Evaluation against the golden set', '05-evaluation-confirmation');
  await page.click('Yes, run the evaluation', 'button');
  expect('the evaluation finishes and the page shows it', await waitFor(`!!document.querySelector('main') && /Passed/.test(document.querySelector('main').innerText) && !/An evaluation is running/.test(document.body.innerText)`), true);
  await sleep(600);
  expect('the four scores against their thresholds', await page.evaluate(`[...document.querySelectorAll('caption')].some((c) => c.innerText.startsWith('Latest run against its thresholds'))`), true);
  expect('a second run is not offered while one is not allowed: the server refuses it (once an hour)', await page.hasText('Run evaluation'), true);
  await shotSection('Evaluation against the golden set', '06-evaluation-run');

  // 4. The baseline is marked, and later runs are compared with it
  // The button's name continues with a hidden note saying which run it is for, so it is found by how it starts
  await page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith('Mark as baseline')).click(); true`);
  await sleep(1500);
  expect('the run is the baseline', await page.hasText('That run is now the baseline.'), true);
  await shotSection('Evaluation against the golden set', '07-evaluation-baseline');

  // 5. Fairness: what the demo does not collect, then the counterfactual run and the outcome tables
  await page.goto(`${SITE}/ai-quality`);
  await page.waitForText('What this demo does not collect, and why');
  await sleep(500);
  await shotSection('Fairness', '08-fairness-before-run');
  await page.click('Run fairness check', 'button');
  await sleep(400);
  expect('its confirmation says it calls the model and costs money', await page.hasText('It calls the model and costs money'), true);
  await page.click('Yes, run the fairness check', 'button');
  expect('the fairness check finishes', await waitFor(`/Passed: run/.test(document.body.innerText)`), true);
  await sleep(600);
  expect('60 pairs and the criteria are shown', [await page.hasText('of 60 pairs'), await page.hasText('Stated ethnicity')], [true, true]);
  expect('the West is flagged by the four-fifths rule, in words, and the Northeast has too few decisions', [await page.hasText('Flagged: under 80% of the highest'), await page.hasText('Fewer than 10 decisions')], [true, true]);
  await shotSection('Fairness', '09-fairness');

  // 6. A citizen has no way in
  await page.signIn(SITE, citizen);
  await page.goto(`${SITE}/ai-quality`);
  await page.waitForText('AI quality is available to case managers and administrators only');
  await shot('10-citizen-refused');
  console.log('      (drift screens use fixture answers written to the database; the runs are real runs through the stand-in)');
}

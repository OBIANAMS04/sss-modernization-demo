// STORY-026 to 029 evidence: the Observability page (service health, request and error rates, latency by route against the 2-second target,
// slowest routes, recent server errors with trace ids, AI calls, tokens and cost per day against the budget, objectives, alerts and their
// history, the runbook), driven through the real UI in headless Chrome, checking each screen and saving a screenshot of it. Needs a FRESH
// database, a backend running with AI_PROVIDER=stub (a deterministic stand-in: no key, no call to any model) and ADMIN_EMAILS listing
// morgan.lee@example.com, and a frontend built against it:
//   createdb -h localhost -U admin sss_demo_m3c
//   cd backend && DATABASE_NAME=sss_demo_m3c PORT=3012 CORS_ORIGIN=http://localhost:4173 AI_PROVIDER=stub ADMIN_EMAILS=morgan.lee@example.com \
//     CASE_MANAGER_EMAILS="manager-local-test@example.com,reviewer-local-test@example.com" node dist/index.js
//   cd frontend && VITE_API_BASE_URL=http://localhost:3012/api npx vite build --outDir <dir> --emptyOutDir
//                && npx vite preview --outDir <dir> --port 4173 --strictPort
//   DATABASE_NAME=sss_demo_m3c E2E_BASE=http://localhost:3012/api node scripts/evidence/story-026-029.mjs
// The server errors are real: serverErrors() (scripts/e2e/lib.mjs) makes GET /notifications fail inside the local database. The alert is opened by the
// objectives check on that real traffic, and closed by correcting the stored counts of the failed minute once it has closed (the one step
// that is not live traffic, said so on this script's output). The AI cost comes from the stand-in's made-up token counts. Screenshots land in
// docs/evidence/story-026-029/ (EVIDENCE_OUT names another folder). Everything is synthetic demo data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { account, adminAccount, call, expect, MANAGER, run, serverErrors, stamp, staffAccount } from '../e2e/lib.mjs';
import { launch } from './browser.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');
const SITE = process.env.EVIDENCE_SITE || 'http://localhost:4173';
const OUT = process.env.EVIDENCE_OUT ? `${process.env.EVIDENCE_OUT.replace(/\/?$/, '/')}` : fileURLToPath(new URL('../../docs/evidence/story-026-029/', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  // Traffic: ordinary use of the app, questions to the assistant (each a model call through the stand-in), and an evaluation run
  for (let i = 0; i < 6; i++) {
    await call('GET', '/exemptions', citizen.token);
    await call('GET', '/cases', citizen.token);
    await call('GET', '/dashboards/citizen', citizen.token);
    await call('GET', '/cases', manager.token);
  }
  for (const question of ['How old must a registrant be to qualify for Type A?', 'What is the income limit for Type B?', 'How do I appeal a denial?']) {
    await call('POST', '/assistant/ask', citizen.token, { question });
  }
  await call('POST', '/ai-quality/evaluations', admin.token);
  for (let i = 0; i < 120; i++) {
    const runs = (await call('GET', '/ai-quality', admin.token)).data.evaluation.runs;
    if (runs.length && runs[0].status !== 'running') break;
    await sleep(500);
  }
  // Server errors: a malformed id reaches PostgreSQL as a uuid and is refused with a 500
  await serverErrors(admin.token, 25);
  const opened = (await call('POST', '/observability/evaluate', admin.token)).data;
  console.log(`      objectives checked: opened ${opened.opened.join(', ') || 'nothing'}`);

  const page = await launch();
  const shot = async (name) => {
    await page.evaluate('window.scrollTo(0, 0); true');
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1280, height: 900, scale: 1 } });
    writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'));
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
    if (!rect) throw new Error(`no section titled ${title}`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: Math.ceil(rect.y + rect.height + 40), deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    // The taller window can reflow the page, so the section is measured again
    const again = await page.evaluate(`(() => {
      const s = [...document.querySelectorAll('h2')].find((h) => h.innerText.trim() === ${JSON.stringify(title)})?.closest('section');
      const r = s.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
    })()`);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { ...again, scale: 1 } });
    writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    console.log(`      saved ${name}.png`);
  };
  const tableCaptions = () => page.evaluate(`[...document.querySelectorAll('caption')].map((c) => c.innerText.trim())`);

  // 1. An administrator opens Observability: the alerts opened by the real failures, then health
  await page.signIn(SITE, admin);
  await page.goto(`${SITE}/observability`);
  await page.waitForText('Service health');
  await sleep(800);
  expect('the tab is named Observability', await page.evaluate('document.title.startsWith("Observability")'), true);
  expect('an alert is open, in words, with a link to its runbook', [await page.hasText('Availability below 99.5%'), await page.hasText('Runbook: what to check first')], [true, true]);
  await shot('01-observability');
  await shotSection('Alerts', '02-alerts-open');
  await shotSection('Service health', '03-service-health');
  expect('health: database, migrations, commit and uptime since the start', [await page.hasText('Reachable'), await page.hasText('25 applied'), await page.hasText('Uptime since the last start'), await page.hasText('Release (commit)')], [true, true, true, true]);
  await shotSection('Objectives', '04-objectives');
  expect('the objectives are in words, not colour alone', [await page.hasText('Breached'), await page.hasText('Within target')], [true, true]);

  // 2. Rates, with each chart's table
  await shotSection('Request and error rates', '05-rates');
  const captions = await tableCaptions();
  expect('every chart has its table (hourly, daily)', [captions.some((c) => c.startsWith('Requests and server errors per hour')), captions.some((c) => c.startsWith('Requests and server errors per day'))], [true, true]);

  // 3. Latency by route against the 2-second target, and the slowest routes
  await shotSection('Latency by route', '06-latency-by-route');
  expect('latency by route is named by templates and states the target', [await page.hasText('GET /api/cases'), await page.hasText('2-second p95 target')], [true, true]);
  await shotSection('Slowest routes', '07-slowest-routes');
  await shotSection('Database', '08-database');

  // 4. Recent server errors with trace ids; one is found by its trace id in the audit trail's entries
  await shotSection('Recent server errors', '09-recent-errors');
  const traceId = await page.evaluate(`[...document.querySelectorAll('td.font-mono')].map((td) => td.innerText.trim()).find((t) => /^[0-9a-f]{32}$/.test(t)) ?? null`);
  expect('a recent server error shows its 32-character trace id', /^[0-9a-f]{32}$/.test(traceId ?? ''), true);

  // 5. AI calls, tokens and cost per day against the budget
  await shotSection('AI calls, tokens and cost per day', '10-ai-usage');
  expect('AI usage: calls, cost and the daily budget', [await page.hasText('Calls today'), await page.hasText('Daily budget'), await page.hasText('Estimated cost today')], [true, true, true]);
  expect('the AI chart has its table with the token columns', (await tableCaptions()).some((c) => c.startsWith('Estimated AI cost per day')) && (await page.hasText('Cache read tokens')), true);

  // 6. The alert links to its runbook entry
  await page.click('Runbook: what to check first', 'a');
  await sleep(500);
  expect('the link goes to the runbook entry', await page.evaluate(`location.hash.startsWith('#runbook-')`), true);
  await shotSection('Runbook', '11-runbook');

  // 7. Recovery: once the minute of failures has closed, its stored counts are corrected (the one step that is not live traffic) and the
  // objectives are checked again: the alerts close and move to the history
  console.log('      waiting for the minute of failures to close...');
  await sleep(61_000 - (Date.now() % 60_000));
  await call('POST', '/observability/evaluate', admin.token); // writes the closed minute and forgets it in memory
  await db.query(`UPDATE route_metrics_minute SET errors_5xx = 0 WHERE errors_5xx > 0`);
  console.log('      (corrected the stored counts of the failed minute; everything before this was live traffic)');
  await page.send('Page.bringToFront');
  await page.click('Check objectives now', 'button');
  await sleep(2500);
  expect('the alerts close and the page says none is open', await page.hasText('No alert is open'), true);
  expect('the history lists the closed alerts', (await tableCaptions()).some((c) => c.startsWith('Alert history')), true);
  // A fresh load of the page for the picture (the page was left scrolled to the runbook)
  await page.goto(`${SITE}/observability`);
  await page.waitForText('Service health');
  await sleep(1000);
  await shotSection('Alerts', '12-alerts-closed-history');

  // 8. Others have no way in
  await page.signIn(SITE, manager);
  await page.goto(`${SITE}/observability`);
  await page.waitForText('Observability is available to administrators only');
  await shot('13-case-manager-refused');
  expect('the API refuses a case manager too', (await call('GET', '/observability', manager.token)).status, 403);
  console.log(`      (the failed request ${traceId} is found by its trace id in the logs: every line carries "trace_id")`);
}

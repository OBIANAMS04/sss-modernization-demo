// STORY-009 evidence: seeds ordinary activity through the API, then captures the Data Freshness page
// in headless Chrome: on target, after an end-to-end check, and after a real slowdown. The slowdown is
// a database row lock held for 31 seconds while a profile save waits on it, the same contention a
// long-running transaction causes in production; nothing is faked.
//
// Runs on the same local stack as story-008.mjs, against a FRESH database (see that file's header):
//   E2E_BASE=http://localhost:3002/api node scripts/evidence/story-009.mjs
// Screenshots land in docs/evidence/story-009/.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { account, call, exemptionId, expect, run, staffAccount } from '../e2e/lib.mjs';
import { launch } from './browser.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');

const SITE = process.env.EVIDENCE_SITE || 'http://localhost:4173';
const OUT = fileURLToPath(new URL('../../docs/evidence/story-009/', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const apply = async (token, type) => (await call('POST', '/cases', token, { exemptionId: await exemptionId(token, type) })).data.id;

run(async () => {
  mkdirSync(OUT, { recursive: true });
  const dana = await staffAccount('dana.whitfield@example.com', 'Dana Whitfield');
  const sam = await staffAccount('sam.ortiz@example.com', 'Sam Ortiz');
  expect('two case managers', [dana.user.role, sam.user.role], ['case_manager', 'case_manager']);
  if ((await call('GET', '/freshness/dashboard', sam.token)).data.overall.count !== 0) {
    throw new Error('Run this against a fresh database: freshness has already been measured here.');
  }

  // Ordinary activity: profile saves, eligibility checks, applications and case decisions
  const casey = await account('casey.morgan@example.com', 'Casey Morgan', '1988-04-12');
  await call('PUT', `/users/${casey.user.id}`, casey.token, { phone: '555-0142', address: '18 Elm Street, Dayton, OH', annualIncome: 15000 });
  const caseyCase = await apply(casey.token, 'Type B');
  await call('POST', `/cases/${caseyCase}/documents`, casey.token, { documentType: 'income_statement', documentUrl: 'https://example.com/casey-morgan-w2.pdf' });
  await call('PUT', `/cases/${caseyCase}/assignment`, dana.token, { assignedTo: dana.user.email });
  await call('POST', `/cases/${caseyCase}/status`, dana.token, { status: 'In Review' });
  await call('POST', `/cases/${caseyCase}/status`, dana.token, { status: 'Approved' });

  const taylor = await account('taylor.brooks@example.com', 'Taylor Brooks', '1949-11-02');
  await call('POST', '/exemptions/check', taylor.token);
  const taylorCase = await apply(taylor.token, 'Type A');
  await call('PUT', `/cases/${taylorCase}/assignment`, sam.token, { assignedTo: sam.user.email });
  await call('POST', `/cases/${taylorCase}/status`, sam.token, { status: 'In Review' });
  await call('POST', `/cases/${taylorCase}/status`, sam.token, { status: 'Denied', reason: 'Proof of age was not provided.' });

  const avery = await account('avery.chen@example.com', 'Avery Chen', '1996-08-19');
  await call('PUT', `/users/${avery.user.id}`, avery.token, { phone: '555-0177', address: '402 Lake Road, Tulsa, OK', hasDocumentedHardship: true });
  await apply(avery.token, 'Type C');

  const morgan = await account('morgan.patel@example.com', 'Morgan Patel', '1952-03-08');
  await call('PUT', `/users/${morgan.user.id}`, morgan.token, { phone: '555-0163', address: '9 Hill Street, Reno, NV' });
  const morganCase = await apply(morgan.token, 'Type A');
  await call('PUT', `/cases/${morganCase}/assignment`, dana.token, { assignedTo: dana.user.email });
  await call('POST', `/cases/${morganCase}/status`, dana.token, { status: 'In Review' });
  await sleep(1500); // measurements are recorded in the background

  const page = await launch();
  const shot = async (name) => {
    await page.screenshot(`${OUT}${name}.png`);
    console.log(`      saved ${name}.png`);
  };
  const db = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    database: process.env.EVIDENCE_DB || 'sss_demo_shots',
    user: process.env.DATABASE_USER || 'admin',
    password: process.env.DATABASE_PASSWORD || 'dev_password',
  });
  try {
    // 1. On target
    await page.signIn(SITE, sam);
    await page.goto(`${SITE}/freshness`);
    await page.waitForText('Within target:');
    const statuses = await page.evaluate(`[...document.querySelectorAll('tbody')][0].innerText`);
    expect('four data types measured and within target; the end-to-end check not run yet', [(statuses.match(/Within target/g) || []).length, statuses.includes('No updates yet')], [4, true]);
    await shot('01-freshness-on-target');

    // 2. End-to-end check from the browser
    await page.click('Check now');
    await page.waitForText('End-to-end check');
    expect('check reports server time and browser round trip', await page.hasText('Round trip from this browser'), true);
    await shot('02-end-to-end-check');

    // 3. A real slowdown: hold Casey's row for 31 s while Casey saves the profile
    await db.connect();
    await db.query('BEGIN');
    await db.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [casey.user.id]);
    const save = call('PUT', `/users/${casey.user.id}`, casey.token, { phone: '555-0143' });
    await sleep(31_000);
    await db.query('COMMIT');
    expect('the blocked profile save completes once the lock is released', (await save).status, 200);
    await sleep(1500);

    await page.goto(`${SITE}/freshness`);
    await page.waitForText('Over the freshness target');
    expect('alert names the data type and its p95', await page.hasText('Profile updates: p95 is 31'), true);
    const slowest = await page.evaluate(`[...document.querySelectorAll('tbody')][1].rows[0].innerText`);
    expect('slowest update is the profile save, and the time went into the write', /Profile updates[\s\S]*Profile saved[\s\S]*3\d(\.\d)? s/.test(slowest), true);
    await shot('03-freshness-alert');

    // The applicant has no access
    await page.signIn(SITE, casey);
    await page.goto(`${SITE}/freshness`);
    await page.waitForText('available to case managers only');
    expect('applicant cannot see data freshness', await page.evaluate(`!document.querySelector('a[href="/freshness"]')`), true);
  } finally {
    await db.end().catch(() => {});
    await page.close();
  }
});

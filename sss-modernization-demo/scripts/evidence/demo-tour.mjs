// Demo-tour screenshots of the citizen and case-management screens, for briefings and decks.
// Runs on the same local stack as story-008.mjs, AFTER it (it reuses that scenario's accounts):
//   E2E_BASE=http://localhost:3002/api node scripts/evidence/demo-tour.mjs
// Screenshots land in ../docs/demo/screens/ (the repository's docs folder).
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { account, call, exemptionId, expect, run } from '../e2e/lib.mjs';
import { launch } from './browser.mjs';

const SITE = process.env.EVIDENCE_SITE || 'http://localhost:4173';
const OUT = fileURLToPath(new URL('../../../docs/demo/screens/', import.meta.url));
const casesOf = async (token) => {
  const data = (await call('GET', '/cases', token)).data;
  return Array.isArray(data) ? data : data.cases;
};

run(async () => {
  mkdirSync(OUT, { recursive: true });
  const jordan = await account('jordan.rivera@example.com', 'Jordan Rivera');
  const taylor = await account('taylor.brooks@example.com', 'Taylor Brooks');
  const sam = await account('sam.ortiz@example.com', 'Sam Ortiz');
  const dana = await account('dana.whitfield@example.com', 'Dana Whitfield');
  const taylorCase = (await casesOf(taylor.token))[0]?.id;
  expect('scenario accounts and cases exist (run story-008.mjs first)', Boolean(taylorCase), true);

  // Two open applications, so the case list shows a working queue (created once)
  const applyOnce = async (email, name, dob, type, profile) => {
    const a = await account(email, name, dob);
    if ((await casesOf(a.token)).length === 0) {
      await call('PUT', `/users/${a.user.id}`, a.token, profile); // saving the profile re-checks eligibility
      const created = await call('POST', '/cases', a.token, { exemptionId: await exemptionId(a.token, type) });
      expect(`${name} applied for ${type}`, created.status, 201);
      return created.data.id;
    }
    return null;
  };
  await applyOnce('avery.chen@example.com', 'Avery Chen', '1996-08-19', 'Type C',
    { phone: '555-0177', address: '402 Lake Road, Tulsa, OK', hasDocumentedHardship: true });
  const morganCase = await applyOnce('morgan.patel@example.com', 'Morgan Patel', '1952-03-08', 'Type A',
    { phone: '555-0163', address: '9 Hill Street, Reno, NV' });
  if (morganCase) {
    await call('PUT', `/cases/${morganCase}/assignment`, dana.token, { assignedTo: dana.user.email });
    await call('POST', `/cases/${morganCase}/status`, dana.token, { status: 'In Review' });
  }

  const page = await launch();
  const shot = async (name) => {
    await page.screenshot(`${OUT}${name}.png`);
    console.log(`      saved ${name}.png`);
  };
  try {
    await page.goto(`${SITE}/register`);
    await page.waitForText('Do not enter a real SSN');
    await shot('tour-01-register');

    await page.signIn(SITE, jordan);
    await page.goto(`${SITE}/dashboard`);
    await page.waitForText('Notifications');
    await page.waitForText('reopened');
    await shot('tour-02-citizen-dashboard');

    await page.goto(`${SITE}/profile`);
    await page.waitForText('Type A');
    await shot('tour-03-profile-eligibility');

    await page.signIn(SITE, taylor);
    await page.goto(`${SITE}/cases/${taylorCase}`);
    await page.waitForText('Proof of age was not provided.');
    expect('denied applicant can appeal', await page.hasText('Appeal this decision'), true);
    await shot('tour-04-denied-with-reason');

    await page.signIn(SITE, sam);
    await page.goto(`${SITE}/cases`);
    await page.waitForText('Morgan Patel');
    await shot('tour-05-case-management');
  } finally {
    await page.close();
  }
});

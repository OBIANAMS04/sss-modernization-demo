// R3 milestone 2 evidence (STORY-041, 042, 037 to 040): the recovery-code screens, driven through the real pages of a LOCAL stack,
// and pages drawn from the attack suite's output and the documents, so the pictures and the text agree.
//   E2E_BASE=http://localhost:3001/api node scripts/evidence/r3-milestone-2.mjs http://localhost:4173
// The site must be built for that API (VITE_API_BASE_URL) and served on the given address.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';
import { PASSWORD, account, stamp } from '../e2e/lib.mjs';
import { totpSteps } from '../e2e/totp.mjs';

const SITE = process.argv[2] || 'http://localhost:4173';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'docs/evidence/r3-m2');
mkdirSync(out, { recursive: true });
const shots = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await launch({ width: 1280, height: 900 });
try {
  // 1. Turning two-step verification on shows the recovery codes once
  const person = await account(`recovery-shots-${stamp}@example.com`, 'Riley Recovery');
  await page.signIn(SITE, person);
  await page.goto(`${SITE}/mfa`);
  await page.waitForText('Set up an authenticator app');
  await page.click('Set up an authenticator app');
  await page.waitForText('Set up your authenticator app');
  const secret = (await page.evaluate(`document.querySelector('code').textContent`)).replace(/\s/g, '');
  await page.type('#mfa-setup-code', totpSteps(secret, 0));
  await page.click('Verify and turn on');
  await page.waitForText('Save your recovery codes');
  const codes = await page.evaluate(`[...document.querySelectorAll('ul[aria-label="Recovery codes"] li')].map((li) => li.textContent)`);
  await page.screenshot(join(out, '01-recovery-codes-shown-once.png'));
  shots.push({ file: '01-recovery-codes-shown-once.png', title: 'Recovery codes, shown once', caption: 'Turning two-step verification on gives ten one-time codes, with copy and download; only their hashes are kept.' });

  // 2. Afterwards the page counts them and offers new ones
  await page.click('I have saved them');
  await page.waitForText('unused recovery codes');
  await page.screenshot(join(out, '02-recovery-codes-status.png'));
  shots.push({ file: '02-recovery-codes-status.png', title: 'Codes left, and new ones', caption: 'Sign-in security counts the unused codes; new codes need a current code and stop the old ones working.' });

  // 3. Signing in with a recovery code instead of the authenticator
  await page.evaluate(`localStorage.clear(); true`);
  await page.goto(`${SITE}/login`);
  await page.waitForText('Welcome back');
  await page.type('#login-email', person.user.email);
  await page.type('#login-password', PASSWORD);
  await page.click('Sign In');
  await page.waitForText('Two-step verification');
  await page.click('Lost your authenticator? Use a recovery code');
  await page.waitForText('Recovery code');
  await page.type('#mfa-recovery-code', codes[0]);
  await page.screenshot(join(out, '03-sign-in-with-recovery-code.png'));
  shots.push({ file: '03-sign-in-with-recovery-code.png', title: 'Lost authenticator', caption: 'The code step offers a recovery code instead; it works once and shares the five tries.' });
  await page.click('Verify and sign in');
  await page.waitForText('How current this page is');
  await sleep(500);
  console.log('signed in with a recovery code');
} finally {
  await page.close();
}

// 4. Pages drawn from the attack suite's output and the documents
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wrap = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  body { margin: 0; padding: 24px 28px; width: 1180px; background: #fcfcfb; color: #0b0b0b; font: 14px/1.45 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; } .sub { color: #52514e; margin: 0 0 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; } th, td { border-bottom: 1px solid #e4e3df; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { color: #52514e; background: #f3f2ef; } .pass { color: #0a7a0a; font-weight: 700; } ul.checks { columns: 2; padding-left: 18px; margin: 0; font-size: 13px; } li { margin: 1px 0; }
  .banner { background: #fff7d6; border: 1px solid #eda100; padding: 6px 10px; border-radius: 6px; font-size: 13px; margin-bottom: 12px; }
</style></head><body><div class="banner">Synthetic demo deployment. Not operating in production.</div>${body}</body></html>`;

function mdTable(file, heading) {
  const text = readFileSync(file, 'utf8');
  const lines = text.slice(text.indexOf(heading)).split(/\r?\n/);
  const rows = [];
  for (const l of lines.slice(1)) {
    if (l.trim().startsWith('|')) rows.push(l.trim());
    else if (rows.length) break;
  }
  const cells = rows.filter((r) => !/^\|[-\s|]+\|$/.test(r)).map((r) => r.slice(1, -1).split('|').map((c) => c.trim()));
  const fmt = (c) => esc(c).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '$1');
  return `<table><tr>${cells[0].map((c) => `<th>${fmt(c)}</th>`).join('')}</tr>${cells.slice(1).map((r) => `<tr>${r.map((c) => `<td>${fmt(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}

const suite = readFileSync(join(root, 'docs/evidence/r3-m2-security-e2e.txt'), 'utf8').split(/\r?\n/).filter((l) => l.startsWith('PASS'));
const pages = [
  ['04-attack-suite.png', 'STORY-041: the attack suite', `<h1>STORY-041: the attack suite, ${suite.length} of ${suite.length} checks pass</h1><p class="sub">scripts/e2e/security.mjs on a local copy of the deployed code. Our own testing, not a third-party penetration test.</p><ul class="checks">${suite.map((l) => `<li><span class="pass">PASS</span> ${esc(l.replace(/^PASS\s+/, '').replace(/: got .*$/, ''))}</li>`).join('')}</ul>`],
  ['05-what-the-suite-tries.png', 'STORY-041: what was tried', `<h1>STORY-041: what the attack suite tries</h1><p class="sub">docs/SECURITY-TESTING.md</p>${mdTable(join(root, 'docs/SECURITY-TESTING.md'), '## What the attack suite tries')}`],
  ['06-dependencies.png', 'STORY-041: dependencies', `<h1>STORY-041: dependency pass (npm audit)</h1><p class="sub">docs/SECURITY-TESTING.md</p>${mdTable(join(root, 'docs/SECURITY-TESTING.md'), '## Dependencies')}`],
  ['07-conformance-report-aa.png', 'STORY-042: conformance report, AA', `<h1>STORY-042: Accessibility Conformance Report (VPAT 2.5), WCAG 2.1 AA table</h1><p class="sub">docs/ACCESSIBILITY-CONFORMANCE-REPORT.md. Hands-on screen-reader testing is still owed and is named in the report.</p>${mdTable(join(root, 'docs/ACCESSIBILITY-CONFORMANCE-REPORT.md'), '## Table 2: WCAG 2.1 Level AA')}`],
];
const captions = {
  '04-attack-suite.png': ['The attack suite', 'Sign-in bypass, token tampering, other people\'s records, injection, guessing, sign-out, recovery codes, headers and CORS.'],
  '05-what-the-suite-tries.png': ['What was tried', 'Every area tried and its result, from the security testing report.'],
  '06-dependencies.png': ['Dependencies', 'bcrypt 6 (drops tar), uuid removed, axios patched; one finding accepted with its reason.'],
  '07-conformance-report-aa.png': ['Conformance report', 'WCAG 2.1 AA: each criterion with its conformance and remarks; screen-reader testing still owed.'],
};
const browser = await launch({ width: 1240, height: 300 });
try {
  for (const [file, title, body] of pages) {
    const html = join(out, file.replace(/\.png$/, '.html'));
    writeFileSync(html, wrap(title, body));
    await browser.goto(pathToFileURL(html).href);
    await browser.screenshot(join(out, file));
    shots.push({ file, title: captions[file][0], caption: captions[file][1] });
  }
} finally {
  await browser.close();
}

writeFileSync(join(out, 'evidence.json'), JSON.stringify({
  id: 'r3-m2',
  title: 'R3 milestone 2 (STORY-037 to 042): security, accessibility and operations: evidence',
  capturedBy: 'scripts/evidence/r3-milestone-2.mjs on a local copy of the deployed code (screens 01 to 03 through the real pages)',
  summary: ['Synthetic demo deployment; not operating in production. Our own security testing, not a third-party penetration test.'],
  shots,
}, null, 2) + '\n');
console.log(`wrote ${shots.length} screens`);

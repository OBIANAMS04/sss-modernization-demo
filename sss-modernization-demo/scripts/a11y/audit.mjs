// STORY-011: Section 508 / WCAG 2.1 AA checks on every page of the app, signed out, as an applicant and as a
// case manager, in real Chrome. For each page:
//   - axe-core with the WCAG 2.0 and 2.1 A and AA rules (contrast, names and labels, structure, ARIA); its
//     best-practice rules (landmarks, heading order) are reported alongside but do not fail the run
//   - keyboard: Tab reaches every visible control without getting stuck, and each stop shows a focus indicator
//   - a descriptive page title, one h1 and one main landmark; signed in, a skip link is the first Tab stop
//   - reflow: no sideways scrolling at 320 CSS pixels (WCAG 1.4.10); wide tables scroll inside their own box
// and for the forms, after a failed submit: the message is announced (role="alert") or each invalid field
// is marked aria-invalid and described by its message, with focus on the first one.
// Writes results.json and report.html (plus screenshots) to the output folder; exits 1 on any failure.
//
// Local stack (creates synthetic accounts and one case; set up as in scripts/evidence/story-008.mjs):
//   E2E_BASE=http://localhost:3002/api node scripts/a11y/audit.mjs http://localhost:4173 docs/evidence/story-011
// Demo deployment, signed out and as the synthetic live citizen (creates no records):
//   node scripts/a11y/audit.mjs --live docs/evidence/story-011
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../evidence/browser.mjs';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_VERSION = require('axe-core/package.json').version;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const live = process.argv[2] === '--live';
const SITE = live ? process.env.SITE_URL || 'https://sss-demo-frontend.onrender.com' : process.argv[2] || 'http://localhost:4173';
const OUT = resolve(process.argv[3] || '.');
const PREFIX = live ? 'live-' : '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Sessions and pages: local creates its own synthetic data; live only signs in the existing synthetic citizen. */
async function setup() {
  if (live) {
    const API = process.env.API_URL || 'https://sss-demo-backend.onrender.com';
    const credsFile = process.env.LIVE_CITIZEN_FILE || join(homedir(), '.claude', 'sss-verify', 'live-citizen.json');
    if (!existsSync(credsFile)) throw new Error(`No live citizen credentials at ${credsFile}; run scripts/verify-live-citizen.mjs once first`);
    const creds = JSON.parse(readFileSync(credsFile, 'utf8'));
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`live sign-in: ${res.status}`);
    const citizen = await res.json();
    return [
      { role: 'Signed out', path: '/login' },
      { role: 'Signed out', path: '/register' },
      { role: 'Applicant', path: '/dashboard', session: citizen },
      { role: 'Applicant', path: '/profile', session: citizen },
    ];
  }
  const { account, call, exemptionId } = await import('../e2e/lib.mjs');
  const applicant = await account(`a11y-applicant-${Date.now()}@example.com`, 'Avery Lane', '1950-03-14');
  await call('PUT', `/users/${applicant.user.id}`, applicant.token, { phone: '555-0111', address: '12 Elm Street, Dayton, OH' });
  const caseId = (await call('POST', '/cases', applicant.token, { exemptionId: await exemptionId(applicant.token, 'Type A') })).data.id;
  const dana = await account('dana.whitfield@example.com', 'Dana Whitfield');
  const sam = await account('sam.ortiz@example.com', 'Sam Ortiz');
  await call('PUT', `/cases/${caseId}/assignment`, dana.token, { assignedTo: dana.user.email });
  await call('POST', `/cases/${caseId}/status`, dana.token, { status: 'In Review' });
  await call('POST', `/cases/${caseId}/status`, dana.token, { status: 'Approved' }); // no proof of age on file: a review opens for Sam
  return [
    { role: 'Signed out', path: '/login' },
    { role: 'Signed out', path: '/register' },
    { role: 'Applicant', path: '/dashboard', session: applicant },
    { role: 'Applicant', path: '/profile', session: applicant },
    { role: 'Applicant', path: `/cases/${caseId}`, label: '/cases/:id', session: applicant, reflowShot: true },
    ...['/dashboard', '/cases', `/cases/${caseId}`, '/compliance', '/compliance/audit', '/freshness', '/audit'].map((path) => ({
      role: 'Case manager',
      path,
      label: path.startsWith('/cases/') ? '/cases/:id' : path,
      session: sam,
    })),
  ];
}

const page = await launch();
const results = [];
const failures = [];
let apiTree = [];

async function open(path, session) {
  if (session) await page.signIn(SITE, session);
  else {
    await page.goto(`${SITE}/login`);
    await page.evaluate('localStorage.clear(); true');
  }
  await page.goto(`${SITE}${path}`);
  const end = Date.now() + (live ? 90_000 : 20_000);
  while (Date.now() < end) {
    const ready = await page.evaluate(`!!document.querySelector('h1') && !/Loading/.test(document.body.innerText)`);
    if (ready) break;
    await sleep(250);
  }
  await sleep(500);
  // Transitions would make a focus ring read as "not there yet"; they change timing only
  await page.evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.append(s); return true; })()`);
}

async function axe(tags) {
  if (!(await page.evaluate('typeof window.axe'))?.startsWith('object')) await page.evaluate(AXE);
  return page.evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(tags)} }, resultTypes: ['violations'] })
    .then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, url: v.helpUrl,
      wcag: v.tags.filter((t) => /^wcag\\d/.test(t)), nodes: v.nodes.map((n) => ({ target: n.target.join(' '), summary: n.failureSummary })) })))`);
}

async function structure() {
  return page.evaluate(`({ title: document.title, h1: document.querySelectorAll('h1').length,
    main: document.querySelectorAll('main, [role="main"]').length })`);
}

/** Tabs through the page from the top; every visible control must be reached and show a visible change when focused. */
async function keyboard(shotFile) {
  const count = await page.evaluate(`(() => {
    const style = (el) => { const c = getComputedStyle(el); return [c.outlineStyle, c.outlineWidth, c.outlineColor, c.boxShadow, c.borderColor, c.backgroundColor, c.color, c.textDecorationLine].join('|'); };
    const shown = (el) => { const r = el.getBoundingClientRect(), c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden'; };
    const els = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]')]
      .filter((el) => !el.disabled && el.getAttribute('tabindex') !== '-1' && shown(el));
    els.forEach((el, i) => { el.dataset.a11y = i; el.dataset.a11yRest = style(el); });
    window.__a11yAll = els.map((el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.name || el.tagName).trim().slice(0, 40));
    return els.length;
  })()`);
  const stops = [];
  let first = null;
  let repeats = 0;
  for (let i = 0; i < count + 6; i++) {
    await page.press('Tab');
    const s = await page.evaluate(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el.dataset.a11y === undefined) return el && el !== document.body ? { idx: null, label: el.tagName } : null;
      const c = getComputedStyle(el);
      const now = [c.outlineStyle, c.outlineWidth, c.outlineColor, c.boxShadow, c.borderColor, c.backgroundColor, c.color, c.textDecorationLine].join('|');
      const outline = c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0;
      return { idx: Number(el.dataset.a11y), label: (el.getAttribute('aria-label') || el.innerText || el.value || el.name || el.tagName).trim().slice(0, 40), indicator: outline || now !== el.dataset.a11yRest };
    })()`);
    if (i === 0 && shotFile) await page.screenshot(shotFile);
    if (!s) continue; // focus passed through the browser itself
    if (s.idx !== null && s.idx === first) break; // back at the start: a full cycle
    if (first === null && s.idx !== null) first = s.idx;
    if (stops.length && stops[stops.length - 1].idx === s.idx) {
      if (++repeats > 5) break; // focus is not moving: a keyboard trap (a date field takes 3 presses)
    } else repeats = 0;
    stops.push(s);
  }
  const all = await page.evaluate('window.__a11yAll');
  const reached = new Set(stops.map((s) => s.idx));
  return {
    controls: count,
    reached: reached.size - (reached.has(null) ? 1 : 0),
    missed: all.filter((_, i) => !reached.has(i)),
    noIndicator: stops.filter((s) => s.idx !== null && !s.indicator).map((s) => s.label),
    firstStop: stops[0]?.label ?? null,
    trapped: repeats > 5,
  };
}

async function reflow(shotFile) {
  const at = (width, height) => page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await at(320, 900);
  await sleep(400);
  const r = await page.evaluate('({ scroll: document.documentElement.scrollWidth, width: window.innerWidth })');
  if (shotFile) {
    const { cssContentSize } = await page.send('Page.getLayoutMetrics');
    await at(320, Math.ceil(cssContentSize.height));
    await sleep(300);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shotFile, Buffer.from(data, 'base64'));
  }
  await at(1280, 900);
  await sleep(200);
  return { ok: r.scroll <= r.width + 1, scrollWidth: r.scroll };
}

const formState = `(() => {
  const invalid = [...document.querySelectorAll('[aria-invalid="true"]')];
  const described = invalid.filter((el) => (el.getAttribute('aria-describedby') || '').split(' ').some((id) => document.getElementById(id)?.innerText.trim()));
  return { invalid: invalid.length, described: described.length,
    alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => a.innerText.trim()).filter(Boolean),
    focusOnInvalid: document.activeElement?.getAttribute('aria-invalid') === 'true' };
})()`;

/** What assistive technology is told about each form control, read from Chrome's accessibility tree. */
async function accessibilityTree() {
  await page.send('Accessibility.enable');
  const { nodes } = await page.send('Accessibility.getFullAXTree');
  const prop = (n, name) => n.properties?.find((p) => p.name === name)?.value?.value;
  return nodes
    .filter((n) => !n.ignored && ['textbox', 'combobox', 'checkbox', 'button', 'alert'].includes(n.role?.value))
    .map((n) => ({ role: n.role.value, name: n.name?.value || '', description: n.description?.value || '', required: !!prop(n, 'required'), invalid: prop(n, 'invalid') === 'true' || prop(n, 'invalid') === true }));
}

try {
  mkdirSync(OUT, { recursive: true });
  const pages = await setup();
  let skipShot = !live; // one screenshot of the skip link, on the applicant's dashboard

  for (const p of pages) {
    await open(p.path, p.session);
    const wcag = await axe(WCAG);
    const advisory = await axe(['best-practice']);
    const s = await structure();
    const shotSkip = skipShot && p.role === 'Applicant' && p.path === '/dashboard' ? join(OUT, '02-skip-link.png') : null;
    if (shotSkip) skipShot = false;
    await open(p.path, p.session); // fresh load, so Tab starts from the top
    const k = await keyboard(shotSkip);
    const r = await reflow(p.reflowShot ? join(OUT, '04-reflow-320.png') : null);
    const checks = {
      'WCAG A/AA rules': wcag.length === 0,
      'Every control reached by Tab': k.missed.length === 0 && !k.trapped,
      'Focus always visible': k.noIndicator.length === 0,
      'Descriptive title': /SSS/.test(s.title) && s.title !== 'frontend',
      'One h1 and one main': s.h1 === 1 && s.main === 1,
      'Skip link first': !p.session || /skip to main content/i.test(k.firstStop || ''),
      'Reflow at 320 px': r.ok,
    };
    const row = { role: p.role, page: p.label || p.path, title: s.title, wcag, advisory, keyboard: k, reflow: r, checks, pass: Object.values(checks).every(Boolean) };
    results.push(row);
    console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${p.role.padEnd(12)} ${row.page.padEnd(18)} axe ${wcag.length} (+${advisory.length} advisory), Tab ${k.reached}/${k.controls}, ${Object.entries(checks).filter(([, ok]) => !ok).map(([n]) => n).join('; ') || 'all checks'}`);
    if (!row.pass) failures.push(`${p.role} ${row.page}`);
  }

  // Failed submits: the sign-in error (local: wrong password; live: empty form, so nothing is sent) and registration
  const forms = [];
  await open('/login');
  if (live) await page.click('Sign In');
  else {
    await page.type('input[name="email"]', 'avery.lane@example.com');
    await page.type('input[name="password"]', 'Not-The-Passw0rd!');
    await page.click('Sign In');
  }
  await sleep(1500);
  forms.push({ form: live ? 'Sign in, empty' : 'Sign in, wrong password', ...(await page.evaluate(formState)), axe: (await axe(WCAG)).length });
  await open('/register');
  await page.click('Create Account', 'button');
  await sleep(800);
  forms.push({ form: 'Registration, empty', ...(await page.evaluate(formState)), axe: (await axe(WCAG)).length });
  apiTree = await accessibilityTree();
  await page.screenshot(join(OUT, `${live ? 'live-a11y' : '03'}-form-errors.png`));
  for (const f of forms) {
    const ok = f.axe === 0 && (f.alerts.length > 0 || (f.invalid > 0 && f.described === f.invalid && f.focusOnInvalid));
    f.pass = ok;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${f.form.padEnd(31)} alert: ${f.alerts.length ? 'yes' : 'no'}, invalid fields ${f.invalid}, described ${f.described}, focus on first: ${f.focusOnInvalid}, axe ${f.axe}`);
    if (!ok) failures.push(f.form);
  }

  const summary = { site: SITE, at: new Date().toISOString(), axe: AXE_VERSION, rules: WCAG, pages: results.length, passed: results.filter((r) => r.pass).length, forms };
  writeFileSync(join(OUT, `${PREFIX}a11y-results.json`), JSON.stringify({ summary, results, accessibilityTree: apiTree }, null, 2) + '\n');
  const report = join(OUT, `${PREFIX}a11y-report.html`);
  writeFileSync(report, renderReport(summary, results, forms, apiTree));
  await page.goto(pathToFileURL(report).href);
  await page.screenshot(join(OUT, `${live ? 'live' : '01'}-a11y-report.png`));
} finally {
  await page.close();
}

console.log(failures.length ? `\n${failures.length} FAILURE(S): ${failures.join(', ')}` : '\nALL PASSED');
process.exit(failures.length ? 1 : 0);

function renderReport(summary, rows, forms, tree) {
  const cell = (ok) => `<td class="${ok ? 'ok' : 'bad'}">${ok ? 'Pass' : 'Fail'}</td>`;
  const names = Object.keys(rows[0].checks);
  const issues = rows.flatMap((r) => r.wcag.map((v) => `<li><b>${esc(r.role)} ${esc(r.page)}</b>: ${esc(v.help)} (${esc(v.id)}, ${esc(v.wcag.join(', '))}) at ${esc(v.nodes.map((n) => n.target).join('; '))}</li>`));
  const advisories = [...new Set(rows.flatMap((r) => r.advisory.map((v) => `${v.id}: ${v.help}`)))];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Accessibility audit · SSS Modernization Demo</title><style>
body{font-family:Segoe UI,Arial,sans-serif;color:#15202f;margin:32px;background:#fff}h1{font-size:28px;margin:0 0 4px}p{margin:4px 0 14px;color:#45526a}
table{border-collapse:collapse;width:100%;font-size:14px;margin:12px 0 20px}th,td{border:1px solid #cdd6e2;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#e9eef5}.ok{background:#e7f6ec;color:#14532d;font-weight:600}.bad{background:#fde8e8;color:#7f1d1d;font-weight:700}h2{font-size:18px;margin:18px 0 6px}
.num{text-align:right}code{font-size:13px}</style></head><body>
<h1>Accessibility audit: ${summary.passed} of ${summary.pages} pages pass WCAG 2.1 AA checks</h1>
<p>${esc(summary.site)} · ${esc(summary.at.slice(0, 16).replace('T', ' '))} UTC · axe-core ${esc(summary.axe)} (rules tagged ${summary.rules.join(', ')}) in Chrome, plus keyboard, title, structure and 320 px reflow checks. Synthetic data.</p>
<table><tr><th>Signed in as</th><th>Page</th><th class="num">axe A/AA issues</th><th class="num">Tab stops</th>${names.map((n) => `<th>${esc(n)}</th>`).join('')}</tr>
${rows.map((r) => `<tr><td>${esc(r.role)}</td><td><code>${esc(r.page)}</code></td><td class="num">${r.wcag.length}</td><td class="num">${r.keyboard.reached} of ${r.keyboard.controls}</td>${names.map((n) => cell(r.checks[n])).join('')}</tr>`).join('\n')}
</table>
<h2>Failed submits</h2>
<table><tr><th>Form</th><th>Announced alert</th><th class="num">Invalid fields</th><th class="num">Described by their message</th><th>Focus on first invalid field</th><th class="num">axe issues</th>${'<th>Result</th>'}</tr>
${forms.map((f) => `<tr><td>${esc(f.form)}</td><td>${esc(f.alerts.join(' · ') || 'none')}</td><td class="num">${f.invalid}</td><td class="num">${f.described}</td><td>${f.focusOnInvalid ? 'yes' : 'no'}</td><td class="num">${f.axe}</td>${cell(f.pass)}</tr>`).join('\n')}
</table>
<h2>What a screen reader is told about the registration form after an empty submit</h2>
<table><tr><th>Role</th><th>Accessible name</th><th>Description</th><th>Required</th><th>Invalid</th></tr>
${tree.map((n) => `<tr><td>${esc(n.role)}</td><td>${esc(n.name)}</td><td>${esc(n.description)}</td><td>${n.required ? 'yes' : ''}</td><td>${n.invalid ? 'yes' : ''}</td></tr>`).join('\n')}
</table>
${issues.length ? `<h2>WCAG issues to fix</h2><ul>${issues.join('')}</ul>` : ''}
<h2>Best-practice advisories (not WCAG failures)</h2><p>${advisories.length ? esc(advisories.join(' · ')) : 'None.'}</p>
</body></html>`;
}

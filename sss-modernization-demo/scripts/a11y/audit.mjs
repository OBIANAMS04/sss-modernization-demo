// STORY-011: Section 508 / WCAG 2.1 AA checks on every page of the app, signed out, as an applicant, a
// case manager, an administrator and a leadership user, in real Chrome. For each page:
//   - axe-core with the WCAG 2.0 and 2.1 A and AA rules (contrast, names and labels, structure, ARIA); its
//     best-practice rules (landmarks, heading order) are reported alongside but do not fail the run
//   - keyboard: Tab reaches every visible control without getting stuck, and each stop shows a focus indicator
//   - a descriptive page title, one h1 and one main landmark; signed in, a skip link is the first Tab stop
//   - reflow: no sideways scrolling at 320 CSS pixels (WCAG 1.4.10); wide tables scroll inside their own box
// STORY-019 and 023: the policy assistant page (an applicant and a case manager, with an answer shown, a cited passage open and the
// report form open) and the review queue; the override rate sits on the admin and leadership dashboards already listed.
// and for the forms, after a failed submit: the message is announced (role="alert") or each invalid field
// is marked aria-invalid and described by its message, with focus on the first one. Locally it also checks the
// warning before a session ends (WCAG 2.2.1): shown in time, accessible, extendable, and a clear sign-out if ignored.
// Writes results.json and report.html (plus screenshots) to the output folder; exits 1 on any failure.
//
// Local stack (creates synthetic accounts and one case; set up as in scripts/evidence/story-008.mjs):
//   E2E_BASE=http://localhost:3002/api node scripts/a11y/audit.mjs http://localhost:4173 docs/evidence/story-011
// Demo deployment, signed out and as the synthetic live citizen (creates no records):
//   node scripts/a11y/audit.mjs --live docs/evidence/story-011
import { createHmac } from 'node:crypto';
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
      { role: 'Applicant', path: '/mfa', session: citizen },
    ];
  }
  const { account, adminAccount, call, exemptionId, leadershipAccount, PASSWORD, staffAccount } = await import('../e2e/lib.mjs');
  const applicant = await account(`a11y-applicant-${Date.now()}@example.com`, 'Avery Lane', '1950-03-14');
  await call('PUT', `/users/${applicant.user.id}`, applicant.token, { phone: '555-0111', address: '12 Elm Street, Dayton, OH' });
  const caseId = (await call('POST', '/cases', applicant.token, { exemptionId: await exemptionId(applicant.token, 'Type A') })).data.id;
  const dana = await staffAccount('dana.whitfield@example.com', 'Dana Whitfield');
  const sam = await staffAccount('sam.ortiz@example.com', 'Sam Ortiz');
  // STORY-013 to 015: an administrator (listed in ADMIN_EMAILS, so a case manager becomes one on being given the role) and a leadership user
  const morgan = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
  const riley = await leadershipAccount('riley.chen@example.com', 'Riley Chen');
  // STORY-019 and 023: a question answered with its citations, and one withheld for a case manager (it waits in the queue Sam sees)
  await call('POST', '/assistant/ask', applicant.token, { question: 'What is the income limit for the Type B exemption?' });
  await call('POST', '/assistant/ask', applicant.token, { question: 'Am I eligible for the senior exemption?' });
  await call('PUT', `/cases/${caseId}/assignment`, dana.token, { assignedTo: dana.user.email });
  await call('POST', `/cases/${caseId}/status`, dana.token, { status: 'In Review' });
  await call('POST', `/cases/${caseId}/status`, dana.token, { status: 'Approved' }); // no proof of age on file: a review opens for Sam
  // STORY-003: the sign-in code step belongs to someone with two-step verification on; a pending token (good for five minutes) is what the password step leaves
  const { totpAt } = await import('../e2e/totp.mjs');
  const secured = await account(`a11y-mfa-${Date.now()}@example.com`, 'Casey Park', '1950-03-14');
  const { secret } = (await call('POST', '/mfa/setup', secured.token)).data;
  await call('POST', '/mfa/verify', secured.token, { totpCode: totpAt(secret) });
  const pendingToken = async () => (await call('POST', '/auth/login', null, { email: secured.user.email, password: PASSWORD })).data.pendingToken;
  return [
    { role: 'Signed out', path: '/login' },
    { role: 'Signed out', path: '/register' },
    { role: 'Applicant', path: '/dashboard', session: applicant },
    { role: 'Applicant', path: '/profile', session: applicant },
    { role: 'Applicant', path: '/mfa', session: applicant },
    { role: 'Applicant', path: '/mfa', label: '/mfa (setup started)', session: applicant, after: startMfaSetup },
    { role: 'Signed out', path: '/mfa/verify', before: async () => `sessionStorage.setItem('mfa_pending_token', ${JSON.stringify(await pendingToken())}); true` },
    { role: 'Applicant', path: `/cases/${caseId}`, label: '/cases/:id', session: applicant, reflowShot: true },
    { role: 'Applicant', path: '/assistant', session: applicant },
    { role: 'Applicant', path: '/assistant', label: '/assistant (answered)', session: applicant, after: askQuestion, reflowShot: '04-reflow-320-assistant.png' },
    ...['/dashboard', '/cases', `/cases/${caseId}`, '/compliance', '/compliance/audit', '/freshness', '/audit', '/assistant', '/assistant/reviews', '/staff'].map((path) => ({
      role: 'Case manager',
      path,
      label: path.startsWith('/cases/') ? '/cases/:id' : path,
      session: sam,
    })),
    ...['/dashboard', '/my-work', '/leadership', '/admin', '/admin/policies'].map((path) => ({ role: 'Admin', path, session: morgan })),
    { role: 'Leadership', path: '/dashboard', session: riley },
  ];
}

/** An HS256 token like the backend's, for the session checks (local stack with the development secret only). */
function mintToken(user, lifetimeSeconds, authTime) {
  const now = Math.floor(Date.now() / 1000);
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user.id, email: user.email, auth_time: authTime, iat: now, exp: now + lifetimeSeconds })}`;
  return `${body}.${createHmac('sha256', process.env.JWT_SECRET || 'dev_secret_key').update(body).digest('base64url')}`;
}

async function until(expression, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(expression).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

const page = await launch();
const results = [];
const failures = [];
let apiTree = [];

async function open(path, session, before) {
  if (session) await page.signIn(SITE, session);
  else {
    await page.goto(`${SITE}/login`);
    await page.evaluate('localStorage.clear(); true');
  }
  if (before) await page.evaluate(await before()); // state a page needs before it loads, such as a pending sign-in
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

/** STORY-019: /assistant once a question is answered: the answer, the first source's passage open, and the report form open. */
async function askQuestion() {
  await page.type('textarea', 'How do I appeal a denial?');
  await page.click('Ask', 'button');
  await until(`[...document.querySelectorAll('h2')].some((h) => h.innerText.trim() === 'Answer')`, 15_000);
  await page.evaluate(`document.querySelector('section[aria-labelledby] ol button')?.click(); true`);
  await sleep(500);
  await page.click('Report a problem', 'button');
  await sleep(300);
}

/** STORY-003: /mfa once a setup is started, with the QR code and key showing. */
async function startMfaSetup() {
  await page.click('Set up an authenticator app');
  await until(`!!document.querySelector('img[alt^="QR code"]')`, 10_000);
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
  // A page that puts focus in a field as it loads (the sign-in code step) would start the walk mid-page and show that field focused at rest
  await page.evaluate(`(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); return true; })()`);
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
  // Besides sideways scrolling, any text wider than its own box overlaps or is cut off (a long email in a narrow
  // column, say), unless the box sits inside one that scrolls on purpose, as the wide tables do.
  const r = await page.evaluate(`(() => {
    const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true; } return false; };
    const overflowing = [...document.querySelectorAll('body *')]
      .filter((el) => el.children.length === 0 && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)
        && getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && !scrolls(el))
      .map((el) => el.innerText.trim().slice(0, 40));
    return { scroll: document.documentElement.scrollWidth, width: window.innerWidth, overflowing };
  })()`);
  if (shotFile) {
    const { cssContentSize } = await page.send('Page.getLayoutMetrics');
    await at(320, Math.ceil(cssContentSize.height));
    await sleep(300);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shotFile, Buffer.from(data, 'base64'));
  }
  await at(1280, 900);
  await sleep(200);
  return { ok: r.scroll <= r.width + 1 && r.overflowing.length === 0, scrollWidth: r.scroll, overflowing: r.overflowing };
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
    await open(p.path, p.session, p.before);
    await p.after?.();
    const wcag = await axe(WCAG);
    const advisory = await axe(['best-practice']);
    const s = await structure();
    const shotSkip = skipShot && p.role === 'Applicant' && p.path === '/dashboard' ? join(OUT, '02-skip-link.png') : null;
    if (shotSkip) skipShot = false;
    await open(p.path, p.session, p.before); // fresh load, so Tab starts from the top
    await p.after?.();
    const k = await keyboard(shotSkip);
    const r = await reflow(p.reflowShot ? join(OUT, typeof p.reflowShot === 'string' ? p.reflowShot : '04-reflow-320.png') : null);
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
  // STORY-003: the code step of sign-in, submitted empty (the code is checked in the browser first, so nothing is sent)
  const codeStep = pages.find((p) => p.path === '/mfa/verify');
  if (codeStep) {
    await open(codeStep.path, null, codeStep.before);
    await page.click('Verify and sign in');
    await sleep(800);
    forms.push({ form: 'Sign-in code, empty', ...(await page.evaluate(formState)), axe: (await axe(WCAG)).length });
  }
  // STORY-019: the question, submitted too short (the browser checks it first, so nothing is sent)
  const asking = pages.find((p) => p.role === 'Applicant' && p.path === '/assistant');
  if (asking) {
    await open(asking.path, asking.session);
    await page.type('textarea', 'Hi');
    await page.click('Ask', 'button');
    await sleep(500);
    forms.push({ form: 'Question, too short', ...(await page.evaluate(formState)), axe: (await axe(WCAG)).length });
  }
  // STORY-023: a review sent with nothing chosen and no note
  const reviewing = pages.find((p) => p.role === 'Case manager' && p.path === '/assistant/reviews');
  if (reviewing) {
    await open(reviewing.path, reviewing.session);
    await page.click('Send review', 'button');
    await sleep(500);
    forms.push({ form: 'Review, empty', ...(await page.evaluate(formState)), axe: (await axe(WCAG)).length });
  }
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

  // WCAG 2.2.1 Timing Adjustable: before a session ends the app warns, and the user can extend it. Local only: it
  // needs short-lived tokens, signed here with the evidence backend's development secret.
  let session = null;
  let signOut = null;
  if (!live) {
    const { user } = pages.find((p) => p.role === 'Applicant').session;
    const signedInAt = Math.floor(Date.now() / 1000) - 600;
    await page.signIn(SITE, { token: mintToken(user, 125, signedInAt), user }); // the warning opens 120 s before the end
    await page.goto(`${SITE}/dashboard`);
    const shown = await until(`!!document.querySelector('[role="alertdialog"]')`, 20_000);
    const inside = `!!document.activeElement?.closest('[role="alertdialog"]')`;
    session = { shown, axe: shown ? (await axe(WCAG)).length : null };
    if (shown) {
      Object.assign(session, await page.evaluate(`(() => { const d = document.querySelector('[role="alertdialog"]');
        const named = (attr) => (d.getAttribute(attr) || '').split(' ').some((id) => document.getElementById(id)?.innerText.trim());
        return { modal: d.getAttribute('aria-modal') === 'true', labelled: named('aria-labelledby'), described: named('aria-describedby'),
          focusOnStay: /stay signed in/i.test(document.activeElement?.innerText || '') }; })()`));
      let trapped = true;
      for (let i = 0; i < 3; i++) {
        await page.press('Tab');
        trapped = trapped && (await page.evaluate(inside));
      }
      session.focusTrapped = trapped;
      await page.screenshot(join(OUT, '05-session-warning.png'));
      const before = await page.evaluate("localStorage.getItem('auth_token')");
      await page.press('Escape'); // same as Stay signed in
      session.extended = await until(`!document.querySelector('[role="alertdialog"]') && localStorage.getItem('auth_token') !== ${JSON.stringify(before)}`, 10_000);
      const renewed = await page.evaluate("JSON.parse(atob(localStorage.getItem('auth_token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))");
      session.authTimeKept = renewed.auth_time === signedInAt;
      session.newLifetime = renewed.exp - Math.floor(Date.now() / 1000);
    }
    // Doing nothing: at the end of the session the user is signed out and told why
    await page.signIn(SITE, { token: mintToken(user, 5, signedInAt), user });
    await page.goto(`${SITE}/dashboard`);
    session.signedOutWithMessage = await until(`location.pathname === '/login' && document.body.innerText.includes('Your session ended')`, 20_000);
    session.pass = Boolean(shown && session.axe === 0 && session.modal && session.labelled && session.described && session.focusOnStay &&
      session.focusTrapped && session.extended && session.authTimeKept && session.newLifetime > 3000 && session.signedOutWithMessage);
    console.log(`${session.pass ? 'PASS' : 'FAIL'}  Session warning (WCAG 2.2.1)       ${JSON.stringify(session)}`);
    if (!session.pass) failures.push('Session warning');

    // Found in our own STORY-010 work: the Logout button's request left without its token, so every sign-out from
    // the UI was logged as a refused request. Sign out with the button and read the log.
    await page.signIn(SITE, pages.find((p) => p.role === 'Applicant').session);
    await page.goto(`${SITE}/dashboard`);
    await until("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Logout')", 20_000);
    await page.click('Logout');
    await until("location.pathname === '/login'", 10_000);
    await sleep(1000);
    const { call } = await import('../e2e/lib.mjs');
    const staff = pages.find((p) => p.role === 'Case manager').session;
    const logs = (await call('GET', `/audit?user=${encodeURIComponent(user.email)}&limit=500`, staff.token)).data.logs;
    signOut = {
      recorded: logs.some((l) => l.action === 'USER_LOGOUT'),
      refused: logs.some((l) => l.action === 'ACCESS_DENIED' && l.details?.path === '/api/auth/logout'),
    };
    signOut.pass = signOut.recorded && !signOut.refused;
    console.log(`${signOut.pass ? 'PASS' : 'FAIL'}  Sign-out from the UI is logged     ${JSON.stringify(signOut)}`);
    if (!signOut.pass) failures.push('UI sign-out');
  }

  const summary = { site: SITE, at: new Date().toISOString(), axe: AXE_VERSION, rules: WCAG, pages: results.length, passed: results.filter((r) => r.pass).length, forms, session, signOut };
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

function sessionTable(s, cell) {
  const yes = (ok) => (ok ? 'yes' : 'no');
  return `<h2>Session about to end (WCAG 2.2.1 Timing Adjustable)</h2>
<table><tr><th>Warning shown 2 minutes before</th><th class="num">axe issues</th><th>Modal, named and described</th><th>Focus on Stay signed in, kept inside</th><th>Escape extends: new 1-hour token, same sign-in time</th><th>No action: signed out, told why</th><th>Result</th></tr>
<tr><td>${yes(s.shown)}</td><td class="num">${s.axe ?? ''}</td><td>${yes(s.modal && s.labelled && s.described)}</td><td>${yes(s.focusOnStay && s.focusTrapped)}</td><td>${yes(s.extended && s.authTimeKept && s.newLifetime > 3000)}</td><td>${yes(s.signedOutWithMessage)}</td>${cell(s.pass)}</tr></table>`;
}

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
${summary.session ? sessionTable(summary.session, cell) : ''}
${summary.signOut ? `<h2>Found in our own earlier work: sign-out from the UI</h2><p>Logout button, then the audit log: sign-out recorded: ${summary.signOut.recorded ? 'yes' : 'no'}; logged as a refused request: ${summary.signOut.refused ? 'yes' : 'no'}.</p>` : ''}
<h2>What a screen reader is told about the registration form after an empty submit</h2>
<table><tr><th>Role</th><th>Accessible name</th><th>Description</th><th>Required</th><th>Invalid</th></tr>
${tree.map((n) => `<tr><td>${esc(n.role)}</td><td>${esc(n.name)}</td><td>${esc(n.description)}</td><td>${n.required ? 'yes' : ''}</td><td>${n.invalid ? 'yes' : ''}</td></tr>`).join('\n')}
</table>
${issues.length ? `<h2>WCAG issues to fix</h2><ul>${issues.join('')}</ul>` : ''}
<h2>Best-practice advisories (not WCAG failures)</h2><p>${advisories.length ? esc(advisories.join(' · ')) : 'None.'}</p>
</body></html>`;
}

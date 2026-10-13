// Shared helpers for the end-to-end API checks in this folder.
//
// They create synthetic users through the API, so they run against a LOCAL backend only:
//   cd backend && CASE_MANAGER_EMAILS="manager-local-test@example.com,reviewer-local-test@example.com" npm start
//   node scripts/e2e/access.mjs && node scripts/e2e/workflow.mjs && node scripts/e2e/compliance.mjs
// Set E2E_BASE to point elsewhere, and E2E_ALLOW_REMOTE=1 to allow a non-local host on purpose.
// The list only bootstraps staff: on a fresh database the first case manager of a run must be a listed address that
// registers first (MANAGER, below); staffAccount() then grants the others the role through Staff Access.

export const BASE = process.env.E2E_BASE || 'http://localhost:3001/api';
const host = new URL(BASE).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host) && process.env.E2E_ALLOW_REMOTE !== '1') {
  console.error(`Refusing to create test data on ${host}. Set E2E_ALLOW_REMOTE=1 if you really mean it.`);
  process.exit(2);
}

export const PASSWORD = 'Str0ng!Passw0rd';
export const MANAGER = 'manager-local-test@example.com';
export const REVIEWER = 'reviewer-local-test@example.com';
export const stamp = Date.now();
let failures = 0;

export async function call(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data, headers: res.headers };
}

export function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
}

/** Logs in, or registers a synthetic account (born 1950, so senior-eligible) on first use. */
export async function account(email, name, dob = '1950-06-01') {
  const login = await call('POST', '/auth/login', null, { email, password: PASSWORD });
  if (login.status === 200) return login.data;
  const r = await call('POST', '/auth/register', null, { email, password: PASSWORD, fullName: name, ssn: '900-00-0010', dob });
  if (r.status !== 201) throw new Error(`register ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

const STAFF_ROLES = ['case_manager', 'admin'];
let firstStaff = null; // the first case manager session of this run; it grants the role to the others

/**
 * Like account(), for a case manager. Registering no longer grants the role once anyone has staff access (Staff
 * Access), so the run's first case manager is the listed address that registers first on a fresh database, and each
 * later one is granted the role through the API by that first session, with a reason that lands in the audit log.
 */
export async function staffAccount(email, name) {
  const session = await account(email, name);
  if (STAFF_ROLES.includes(session.user.role)) {
    firstStaff ??= session;
    return session;
  }
  if (!firstStaff) {
    throw new Error(
      `${email} is not a case manager, and no case manager has signed in yet in this run to grant the role. ` +
        'On a fresh database the first case manager must be an address listed in CASE_MANAGER_EMAILS that registers first ' +
        '(the list only bootstraps a database with no staff). Create that account before this one.'
    );
  }
  const granted = await call('POST', '/staff/grant', firstStaff.token, { email, reason: 'Test setup: case manager for this run' });
  if (granted.status !== 200) throw new Error(`grant case-manager access to ${email}: ${granted.status} ${JSON.stringify(granted.data)}`);
  session.user.role = 'case_manager';
  return session;
}

export const exemptionId = async (token, type) =>
  (await call('GET', '/exemptions', token)).data.exemptions.find((e) => e.exemptionType === type).id;

export function finish() {
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

export function run(main) {
  main().then(finish, (e) => {
    console.error('ERROR', e.stack);
    process.exit(1);
  });
}

// STORY-016 access policies: Open Policy Agent decides every request, from rules an administrator can change in the app
// without a deploy. Checks the default behaviour is unchanged, that a change applies at once (no restart), that refusals
// are audited with the rule that refused them, and that the stored versions are write-once. Always puts the defaults
// back at the end, since the other suites share the database (local backend only; see lib.mjs; needs ADMIN_EMAILS to
// list morgan.lee@example.com, and DATABASE_NAME when the database is not sss_demo).
import { createRequire } from 'node:module';
import { account, adminAccount, call, exemptionId, expect, MANAGER, run, stamp, staffAccount } from './lib.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');

const DEFAULTS_REASON = 'End of the policy checks: back to the defaults';

run(async () => {
  const db = new Client({ host: 'localhost', database: process.env.DATABASE_NAME || 'sss_demo', user: 'admin', password: 'dev_password' });
  await db.connect();
  const admin = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
  try {
    await checks(db, admin);
  } finally {
    // Every rule on and no restriction, whatever happened above
    const view = (await call('GET', '/policies', admin.token)).data;
    const rules = Object.fromEntries(view.rules.map((r) => [r.id, r.defaultEnabled]));
    const routes = Object.fromEntries(view.routes.filter((r) => r.roles.length !== r.baselineRoles.length).map((r) => [r.key, r.baselineRoles]));
    const restored = await call('PUT', '/policies', admin.token, { rules, routes, reason: DEFAULTS_REASON });
    if (![200, 400].includes(restored.status)) console.error('could not restore the policy defaults', restored.status, restored.data);
    await db.end();
  }
});

async function checks(db, admin) {
  const a = await staffAccount(MANAGER, 'Manager Test');
  const b = await staffAccount(`policy-b-${stamp}@example.com`, `Policy B ${stamp}`);
  const citizen = await account(`policy-citizen-${stamp}@example.com`, `Policy Citizen ${stamp}`);
  const apply = async (person, type) => (await call('POST', '/cases', person.token, { exemptionId: await exemptionId(person.token, type) })).data.id;
  const assign = (manager, id) => call('PUT', `/cases/${id}/assignment`, manager.token, { assignedTo: manager.user.email });
  const open = (person, id) => call('GET', `/cases/${id}`, person.token).then((r) => r.status);

  await call('PUT', `/users/${citizen.user.id}`, citizen.token, { phone: '555-0108', address: '27 Oak Avenue, Columbus, OH', annualIncome: 18500 });
  const ofA = await apply(citizen, 'Type A');
  const ofB = await apply(citizen, 'Type B');
  const other = await account(`policy-queue-${stamp}@example.com`, `Policy Queue ${stamp}`);
  await call('PUT', `/users/${other.user.id}`, other.token, { phone: '555-0109', address: '9 Elm Street, Columbus, OH', annualIncome: 18500 });
  const queued = await apply(other, 'Type A');
  await assign(a, ofA);
  await assign(b, ofB);

  // Who may read the policy
  const view = await call('GET', '/policies', admin.token);
  expect('an administrator reads the policy: OPA 1.21.0, compiled to WebAssembly', [view.status, view.data.engine?.name, view.data.engine?.version, view.data.engine?.format], [200, 'Open Policy Agent', '1.21.0', 'WebAssembly']);
  expect('the story example is a rule: case managers can view cases assigned to them', view.data.rules.some((r) => r.id === 'case-manager-assigned' && r.enabled), true);
  expect('a case manager and a citizen are refused it (403); nobody signed in, 401', [(await call('GET', '/policies', a.token)).status, (await call('GET', '/policies', citizen.token)).status, (await call('GET', '/policies')).status], [403, 403, 401]);
  const start = view.data.current.version;

  // By default nothing changes: B opens a case assigned to A (team visibility)
  expect('by default a case manager opens a case assigned to another (200)', await open(b, ofA), 200);

  // Changes the policy refuses (400)
  const put = (body) => call('PUT', '/policies', admin.token, body);
  expect('a change without a reason', (await put({ rules: { 'case-manager-team': false } })).status, 400);
  expect('an unknown rule', (await put({ rules: { 'no-such-rule': false }, reason: 'test' })).status, 400);
  expect('an unknown route', (await put({ routes: { 'GET /api/nowhere': ['admin'] }, reason: 'test' })).status, 400);
  expect('a role the code does not allow (a citizen on the audit log)', (await put({ routes: { 'GET /api/audit': ['citizen', 'case_manager', 'admin'] }, reason: 'test' })).status, 400);
  expect('a locked route (sign-in)', (await put({ routes: { 'POST /api/auth/login': ['admin'] }, reason: 'test' })).status, 400);
  expect('locking the administrator out of the policy', (await put({ routes: { 'PUT /api/policies': ['case_manager'] }, reason: 'test' })).status, 400);
  expect('a change that changes nothing', (await put({ rules: { 'case-manager-team': true }, reason: 'test' })).status, 400);

  // Team visibility off: at once, with no restart
  const off = await put({ rules: { 'case-manager-team': false }, reason: 'Pilot: case managers work only their own cases and the queue' });
  expect('turning team visibility off saves a new version', [off.status, off.data.current?.version], [200, start + 1]);
  const refused = await call('GET', `/cases/${ofA}`, b.token);
  expect('B is now refused the case assigned to A (403, by policy)', [refused.status, refused.data.error?.code], [403, 'POLICY_DENIED']);
  expect('B still opens a case assigned to B, and the unassigned queue', [await open(b, ofB), await open(b, queued)], [200, 200]);
  expect('A opens A\'s case, the applicant their own, the administrator any', [await open(a, ofA), await open(citizen, ofA), await open(admin, ofB)], [200, 200, 200]);

  // Both the refusal and the change are in the audit log
  const log = async (query) => (await call('GET', `/audit?${new URLSearchParams({ limit: 50, ...query })}`, admin.token)).data.logs ?? [];
  const denial = (await log({ action: 'ACCESS_DENIED', user: b.user.email })).find((e) => JSON.stringify(e.details ?? '').includes('POLICY_DENIED') || JSON.stringify(e.details ?? '').includes('no-matching-rule'));
  expect('the refusal is audited with the rule and the policy version', [Boolean(denial), JSON.stringify(denial?.details ?? '').includes(String(start + 1))], [true, true]);
  const change = (await log({ action: 'POLICY_CHANGE' })).find((e) => JSON.stringify(e.details ?? '').includes('Pilot: case managers work only'));
  expect('the change is audited with who, what and why', [Boolean(change), change?.actor_email ?? change?.actorEmail ?? change?.user_email, JSON.stringify(change?.details ?? '').includes('case-manager-team')], [true, 'morgan.lee@example.com', true]);

  // A route narrowed to administrators
  const narrowed = await put({ routes: { 'GET /api/cases/export': ['admin'] }, reason: 'Exports paused for case managers during a records check' });
  expect('narrowing the export to administrators is saved', narrowed.status, 200);
  const exportByA = await call('GET', '/cases/export', a.token);
  expect('a case manager is refused the export (403, by policy); the administrator is not', [exportByA.status, exportByA.data.error?.code, (await call('GET', '/cases/export', admin.token)).status], [403, 'POLICY_DENIED', 200]);

  // Back to the defaults
  const back = await put({ rules: { 'case-manager-team': true }, routes: { 'GET /api/cases/export': ['case_manager', 'admin'] }, reason: 'Pilot over: back to team visibility and exports' });
  expect('restoring the defaults is saved', back.status, 200);
  expect('B opens A\'s case again, and A exports again', [await open(b, ofA), (await call('GET', '/cases/export', a.token)).status], [200, 200]);

  const history = (await call('GET', '/policies', admin.token)).data.history;
  expect('the history lists the versions newest first, with who and why', [history[0]?.version, history[0]?.changedBy, history[0]?.reason, history[2]?.reason], [start + 3, 'morgan.lee@example.com', 'Pilot over: back to team visibility and exports', 'Pilot: case managers work only their own cases and the queue']);

  // Write-once in the database
  const refusedSql = async (sql) => db.query(sql).then(() => 'allowed', () => 'refused');
  expect('the stored versions cannot be edited or deleted', [await refusedSql('UPDATE access_policy_versions SET reason = $$x$$'), await refusedSql('DELETE FROM access_policy_versions')], ['refused', 'refused']);
}

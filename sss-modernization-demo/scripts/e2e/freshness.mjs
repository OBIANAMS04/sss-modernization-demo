// STORY-009 data freshness: tracked writes are timed until readable, staff dashboard, end-to-end check
// (local backend only; see lib.mjs).
import { account, call, exemptionId, expect, MANAGER, run, stamp } from './lib.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dashboard = async (token) => (await call('GET', '/freshness/dashboard?hours=1', token)).data;
const countOf = (d, type) => d.types.find((t) => t.type === type).count;

run(async () => {
  const m = await account(MANAGER, 'Manager Test');
  await sleep(1500); // let measurements from earlier activity finish recording
  const before = await dashboard(m.token);
  expect('dashboard lists the five data types', before.types.map((t) => t.type), ['profile', 'eligibility', 'application', 'case_status', 'probe']);
  expect('target is 30 s for 95% of updates', [before.targetMs, before.sloPercent], [30000, 95]);

  const a = await account(`freshness-applicant-${stamp}@example.com`, 'Freshness Applicant');
  await call('PUT', `/users/${a.user.id}`, a.token, { phone: '555-0199', address: '9 Fresh Lane, Boise, ID', annualIncome: 12000 });
  await call('PUT', `/users/${a.user.id}`, a.token, {}); // changes nothing, so it is not timed (its re-check is)
  await call('POST', '/exemptions/check', a.token);
  const caseId = (await call('POST', '/cases', a.token, { exemptionId: await exemptionId(a.token, 'Type B') })).data.id;
  await call('PUT', `/cases/${caseId}/assignment`, m.token, { assignedTo: m.user.email });
  await call('PUT', `/cases/${caseId}/assignment`, m.token, { assignedTo: m.user.email.toUpperCase() }); // same owner: not timed
  await call('POST', `/cases/${caseId}/status`, m.token, { status: 'In Review' });
  await sleep(1500); // measurements are recorded in the background

  const after = await dashboard(m.token);
  const added = (type) => countOf(after, type) - countOf(before, type);
  expect('profile saves timed, the empty save skipped', added('profile'), 1);
  expect('eligibility checks timed (two re-checks after profile saves, one manual)', added('eligibility'), 3);
  expect('the application timed', added('application'), 1);
  expect('assignment and status change timed, the no-op re-assignment skipped', added('case_status'), 2);
  expect(
    'every data type touched shows its latest change readable within 30 s',
    after.types.filter((t) => t.type !== 'probe').every((t) => t.lastMs !== null && t.lastMs < 30000),
    true
  );
  expect('no freshness alert on a healthy local stack', after.alert, null);

  const probe = await call('POST', '/freshness/probe', m.token);
  expect('end-to-end check: a new row is readable on a separate read', [probe.status, probe.data.type, probe.data.visible, probe.data.totalMs < 30000], [200, 'probe', true, true]);
  expect('end-to-end check splits write and visibility time', probe.data.writeMs + probe.data.visibleMs - probe.data.totalMs <= 1, true);
  await sleep(300);
  const withProbe = await dashboard(m.token);
  expect('the check is counted on its own row and left out of the overall figures', [countOf(withProbe, 'probe') - countOf(after, 'probe'), withProbe.overall.count - after.overall.count], [1, 0]);
  expect('slowest updates show where the time went', Object.keys(withProbe.slowest[0]).sort(), ['at', 'label', 'operation', 'totalMs', 'type', 'visible', 'visibleMs', 'writeMs']);
  expect('the window is capped at 30 days', (await call('GET', '/freshness/dashboard?hours=99999', m.token)).data.windowHours, 720);

  expect('applicant cannot read freshness', (await call('GET', '/freshness/dashboard', a.token)).status, 403);
  expect('applicant cannot run the check', (await call('POST', '/freshness/probe', a.token)).status, 403);
  expect('anonymous cannot read freshness', (await call('GET', '/freshness/dashboard')).status, 401);
});

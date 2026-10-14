// STORY-013/014/015 role dashboards: who may read each one, and that its numbers move with the work. Cases are created,
// assigned, reviewed, decided and appealed through the API, then aged with direct SQL for the overdue and stuck rules
// (local backend only; see lib.mjs). Needs ADMIN_EMAILS to list morgan.lee@example.com, and DATABASE_NAME when the
// database is not sss_demo. The case managers are new for each run, so what they show is exact; the figures that cover
// every case are compared with how they stood before the run.
import { createRequire } from 'node:module';
import { account, adminAccount, call, exemptionId, expect, leadershipAccount, MANAGER, run, stamp, staffAccount } from './lib.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;

const dashboard = async (who, kind) => (await call('GET', `/dashboards/${kind}`, who.token)).data;
const setStatus = (who, caseId, status, reason) => call('POST', `/cases/${caseId}/status`, who.token, { status, reason });
const assign = (who, caseId, to) => call('PUT', `/cases/${caseId}/assignment`, who.token, { assignedTo: to.user.email });
const names = new Map(); // case id -> c1 to c6, so the output reads
const ids = (list) => list.map((c) => names.get(c.id));
const sorted = (list) => [...list].sort();
const row = (team, key, value) => team.find((member) => member[key] === value);
const statusCount = (admin, status) => admin.cases.byStatus.find((s) => s.status === status).count;
const typeCount = (admin, type) => admin.cases.byExemptionType.find((t) => t.exemptionType === type).count;
const stage = (leadership, name) => leadership.bottlenecks.stages.find((s) => s.stage === name);
const thisWeek = (leadership) => leadership.trends.weeks.at(-1);
const ascending = (list) => list.every((value, i) => i === 0 || new Date(list[i - 1]) <= new Date(value));
const rate = (part, whole) => (whole ? Math.round((part / whole) * 10000) / 100 : null);

run(async () => {
  // People: a listed case manager, two new ones (so their dashboards start empty), an administrator, a leadership user
  const m = await staffAccount(MANAGER, 'Manager Test');
  const alder = await staffAccount(`dash-alder-${stamp}@example.com`, `Dash Alder ${stamp}`);
  const bishop = await staffAccount(`dash-bishop-${stamp}@example.com`, `Dash Bishop ${stamp}`);
  const admin = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
  const lead = await leadershipAccount(`dash-leadership-${stamp}@example.com`, `Dash Leadership ${stamp}`);
  const citizen = await account(`dash-citizen-${stamp}@example.com`, `Dash Citizen ${stamp}`);
  expect('the four roles', [m.user.role, admin.user.role, lead.user.role, citizen.user.role], ['case_manager', 'admin', 'leadership', 'citizen']);

  // 1. Who may read what (a leadership user is not staff: it reads aggregates and does no case work)
  const refusalsBefore = (await dashboard(admin, 'admin')).health.auditRefusalsLast24h;
  const matrix = [
    ['anonymous caller', { token: null }, [401, 401, 401]],
    ['citizen', citizen, [403, 403, 403]],
    ['case manager', m, [200, 403, 403]],
    ['leadership', lead, [403, 403, 200]],
    ['admin', admin, [200, 200, 200]],
  ];
  for (const [who, session, expected] of matrix) {
    const statuses = [];
    for (const kind of ['case-manager', 'admin', 'leadership']) statuses.push((await call('GET', `/dashboards/${kind}`, session.token)).status);
    expect(`${who}: case-manager, admin and leadership dashboards`, statuses, expected);
  }
  expect('leadership still has its own citizen dashboard', (await call('GET', '/dashboards/citizen', lead.token)).status, 200);
  expect('leadership is refused the case routes', [
    (await call('GET', '/cases/stats', lead.token)).status,
    (await call('GET', '/cases?scope=all', lead.token)).status,
    (await call('GET', '/staff', lead.token)).status,
    (await call('GET', '/audit', lead.token)).status,
  ], [403, 403, 403, 403]);
  // STORY-016: the access policy refuses first, and says who can use the route (requireRole's own message is the second layer)
  expect('the refusal says which role is needed', (await call('GET', '/dashboards/admin', m.token)).data.error?.message, 'Access denied: Only administrators can use this route');

  // 2. How things stand before this run's cases
  const before = {
    admin: await dashboard(admin, 'admin'),
    lead: await dashboard(lead, 'leadership'),
    alder: await dashboard(alder, 'case-manager'),
  };
  expect('a new case manager starts with an empty dashboard', [before.alder.myOpenCases.total, before.alder.waitingOnMe.toStart.total, before.alder.waitingOnMe.toDecide.total, before.alder.recentDecisions.length], [0, 0, 0, 0]);
  expect('the overdue limit is 5 days', before.alder.overdueDays, 5);

  // 3. Six applications, all Type A (born 1950): c1 approved, c2 denied then appealed, c3 left unassigned, c4 left to start,
  //    c5 left in review, c6 approved by the other case manager without evidence (which opens a compliance review)
  const applicants = [];
  const cases = [];
  for (let i = 1; i <= 6; i++) {
    const a = await account(`dash-applicant-${i}-${stamp}@example.com`, `Dash Applicant ${i} ${stamp}`);
    await call('POST', '/exemptions/check', a.token);
    cases.push((await call('POST', '/cases', a.token, { exemptionId: await exemptionId(a.token, 'Type A') })).data.id);
    applicants.push(a);
  }
  const [c1, c2, c3, c4, c5, c6] = cases;
  cases.forEach((id, i) => names.set(id, `c${i + 1}`));
  const created = {
    admin: await dashboard(admin, 'admin'),
    lead: await dashboard(lead, 'leadership'),
    alder: await dashboard(alder, 'case-manager'),
  };
  expect('admin: six more cases, all Submitted', [created.admin.cases.total - before.admin.cases.total, statusCount(created.admin, 'Submitted') - statusCount(before.admin, 'Submitted'), created.admin.cases.open - before.admin.cases.open], [6, 6, 6]);
  expect('admin: all six are Type A', typeCount(created.admin, 'Type A') - typeCount(before.admin, 'Type A'), 6);
  expect('leadership: six more applications, six more open, none decided', [created.lead.kpis.totalApplications - before.lead.kpis.totalApplications, created.lead.kpis.openCases - before.lead.kpis.openCases, created.lead.kpis.decided - before.lead.kpis.decided], [6, 6, 0]);
  expect('leadership: they count in this week', thisWeek(created.lead).applications - thisWeek(before.lead).applications, 6);
  expect('the unassigned queue grew by six, and the oldest come first', [created.alder.unassigned.total - before.alder.unassigned.total, created.alder.unassigned.oldest.length, ascending(created.alder.unassigned.oldest.map((c) => c.submittedAt))], [6, 5, true]);

  // 4. Assigned to Alder, then reviewed: c1, c2, c5 by Alder; c6 by Bishop, who has no assignment
  for (const id of [c1, c2, c4, c5]) await assign(alder, id, alder);
  for (const id of [c1, c2, c5]) await setStatus(alder, id, 'In Review');
  await setStatus(bishop, c6, 'In Review');
  const reviewing = {
    admin: await dashboard(admin, 'admin'),
    lead: await dashboard(lead, 'leadership'),
    alder: await dashboard(alder, 'case-manager'),
  };
  expect('Alder: four open cases, c4 to start, c1 c2 c5 to decide', [sorted(ids(reviewing.alder.myOpenCases.cases)), reviewing.alder.myOpenCases.total, ids(reviewing.alder.waitingOnMe.toStart.cases), sorted(ids(reviewing.alder.waitingOnMe.toDecide.cases))], [['c1', 'c2', 'c4', 'c5'], 4, ['c4'], ['c1', 'c2', 'c5']]);
  expect('two of the six are still unassigned (c3 and c6)', reviewing.alder.unassigned.total - before.alder.unassigned.total, 2);
  expect('admin: 2 Submitted, 4 In Review of the six', [statusCount(reviewing.admin, 'Submitted') - statusCount(before.admin, 'Submitted'), statusCount(reviewing.admin, 'In Review') - statusCount(before.admin, 'In Review')], [2, 4]);
  expect('admin: Alder has four open cases, Bishop none', [row(reviewing.admin.team, 'email', alder.user.email)?.openAssigned, row(reviewing.admin.team, 'email', bishop.user.email)?.openAssigned], [4, 0]);
  expect('leadership: four cases left Submitted for In Review', stage(reviewing.lead, 'submittedToReview').measured - stage(before.lead, 'submittedToReview').measured, 4);

  // 5. Decisions: Alder approves c1 (with proof of age) and denies c2; the applicant appeals; Bishop approves c6 unassigned
  await call('POST', `/cases/${c1}/documents`, applicants[0].token, { documentType: 'proof_of_age', documentUrl: 'https://example.com/birth.pdf' });
  expect('Alder approves c1', (await setStatus(alder, c1, 'Approved')).data.status, 'Approved');
  expect('Alder denies c2 with a reason', (await setStatus(alder, c2, 'Denied', 'Proof of age not provided.')).data.status, 'Denied');
  expect('the applicant appeals c2', (await setStatus(applicants[1], c2, 'Appealed')).data.status, 'Appealed');
  expect('Bishop approves c6, which is not assigned to anyone and has no proof of age', (await setStatus(bishop, c6, 'Approved')).data.status, 'Approved');
  await sleep(500);

  const decided = {
    admin: await dashboard(admin, 'admin'),
    lead: await dashboard(lead, 'leadership'),
    alder: await dashboard(alder, 'case-manager'),
    bishop: await dashboard(bishop, 'case-manager'),
  };
  expect('Alder: c2 (appealed) and c4 and c5 are open; c4 to start, c2 and c5 to decide', [sorted(ids(decided.alder.myOpenCases.cases)), ids(decided.alder.waitingOnMe.toStart.cases), sorted(ids(decided.alder.waitingOnMe.toDecide.cases))], [['c2', 'c4', 'c5'], ['c4'], ['c2', 'c5']]);
  expect('Alder: recent decisions, newest first', decided.alder.recentDecisions.map((d) => [names.get(d.caseId), d.decision, d.exemptionType, d.applicantName]), [['c2', 'Denied', 'Type A', `Dash Applicant 2 ${stamp}`], ['c1', 'Approved', 'Type A', `Dash Applicant 1 ${stamp}`]]);
  expect('Bishop: no open cases; one decision', [decided.bishop.myOpenCases.total, decided.bishop.recentDecisions.map((d) => [names.get(d.caseId), d.decision])], [0, [['c6', 'Approved']]]);
  expect('Alder may resolve the review of Bishop\'s decision on c6', decided.alder.waitingOnMe.reviews.reviews.some((r) => r.caseId === c6 && r.decidedBy === bishop.user.email && r.failedControls.includes('CTRL-05')), true);
  expect('Bishop may not: it is his own decision', decided.bishop.waitingOnMe.reviews.reviews.some((r) => r.caseId === c6), false);
  expect('admin: decisions in the last 30 days and the statuses moved', [decided.admin.cases.decidedLast30Days - before.admin.cases.decidedLast30Days, statusCount(decided.admin, 'Approved') - statusCount(before.admin, 'Approved'), statusCount(decided.admin, 'Appealed') - statusCount(before.admin, 'Appealed'), statusCount(decided.admin, 'Denied') - statusCount(before.admin, 'Denied')], [3, 2, 1, 0]);
  expect('admin: open cases are c2 c3 c4 c5 of the six', decided.admin.cases.open - before.admin.cases.open, 4);

  const teamAlder = row(decided.admin.team, 'email', alder.user.email);
  const teamBishop = row(decided.admin.team, 'email', bishop.user.email);
  expect('admin team: Alder has 3 open, 2 decisions, both compliant', [teamAlder?.name, teamAlder?.role, teamAlder?.openAssigned, teamAlder?.decidedLast30Days, teamAlder?.compliancePassRate], [`Dash Alder ${stamp}`, 'case_manager', 3, 2, 100]);
  expect('admin team: Bishop has 1 decision, which failed controls', [teamBishop?.openAssigned, teamBishop?.decidedLast30Days, teamBishop?.compliancePassRate], [0, 1, 0]);
  const idle = row(before.admin.team, 'email', alder.user.email);
  expect('admin team: before any decisions, a case manager has nothing to rate', [idle?.decidedLast30Days, idle?.medianDaysToDecision, idle?.compliancePassRate], [0, null, null]);
  expect('admin team: case managers and admins only, not leadership', [decided.admin.team.every((t) => ['case_manager', 'admin'].includes(t.role)), decided.admin.team.some((t) => t.email === lead.user.email)], [true, false]);

  expect('leadership: two approved, none denied now (c2 is appealed), two decided', [decided.lead.kpis.approved - before.lead.kpis.approved, decided.lead.kpis.decided - before.lead.kpis.decided, decided.lead.kpis.openCases - before.lead.kpis.openCases], [2, 2, 4]);
  expect('leadership: one case was denied and appealed', [decided.lead.kpis.denied - before.lead.kpis.denied, decided.lead.kpis.appealed - before.lead.kpis.appealed], [1, 1]);
  expect('leadership: the rates follow from the counts', [decided.lead.kpis.approvalRate, decided.lead.kpis.appealRate], [rate(decided.lead.kpis.approved, decided.lead.kpis.decided), rate(decided.lead.kpis.appealed, decided.lead.kpis.denied)]);
  expect('leadership: an average processing time exists once cases are decided', typeof decided.lead.kpis.averageProcessingDays === 'number' && decided.lead.kpis.averageProcessingDays >= 0, true);
  expect('leadership: three decisions this week; three cases left review for a decision', [thisWeek(decided.lead).decisions - thisWeek(before.lead).decisions, stage(decided.lead, 'reviewToDecision').measured - stage(before.lead, 'reviewToDecision').measured], [3, 3]);
  expect('leadership: nothing has left Appealed yet', stage(decided.lead, 'appealedToDecision').measured - stage(before.lead, 'appealedToDecision').measured, 0);
  expect('leadership: twelve weeks, oldest first, ending with this one', [decided.lead.trends.weeks.length, ascending(decided.lead.trends.weeks.map((w) => w.weekStart)), new Set(decided.lead.trends.weeks.map((w) => new Date(`${w.weekStart}T00:00:00Z`).getUTCDay())).size], [12, true, 1]);
  const teamOf = (name) => decided.lead.team.find((t) => t.name === name);
  expect('leadership team: Alder 2 decisions, half approved; Bishop 1, all approved', [teamOf(`Dash Alder ${stamp}`)?.decisions, teamOf(`Dash Alder ${stamp}`)?.approvalRate, teamOf(`Dash Bishop ${stamp}`)?.decisions, teamOf(`Dash Bishop ${stamp}`)?.approvalRate], [2, 50, 1, 100]);

  // 6. Aging: direct SQL moves a case back in time, since nothing in the API can. c5 and c3 are overdue (6 and 7 days),
  //    c4 is at exactly 5 days and is not, c2 was just updated
  const db = new Client({ host: 'localhost', database: process.env.DATABASE_NAME || 'sss_demo', user: 'admin', password: 'dev_password' });
  await db.connect();
  const setBack = (caseId, days) => db.query(`UPDATE cases SET updated_at = NOW() - make_interval(days => $2::int) WHERE id = $1`, [caseId, days]);
  // The whole timeline moves, so the stage durations stay what they were while the case has been waiting longer
  const age = async (caseId, days) => {
    await db.query(`UPDATE case_events SET created_at = created_at - make_interval(days => $2::int) WHERE case_id = $1`, [caseId, days]);
    await db.query(`UPDATE cases SET created_at = created_at - make_interval(days => $2::int), submitted_at = submitted_at - make_interval(days => $2::int) WHERE id = $1`, [caseId, days]);
    await setBack(caseId, days);
  };
  try {
    const processing = decided.lead.kpis.averageProcessingDays;
    await age(c5, 6);
    await age(c3, 7);
    await setBack(c4, 5);
    // c1 had been waiting 100 days when it was approved
    await db.query(`UPDATE cases SET submitted_at = submitted_at - INTERVAL '100 days' WHERE id = $1`, [c1]);

    const aged = {
      alder: await dashboard(alder, 'case-manager'),
      bishop: await dashboard(bishop, 'case-manager'),
      admin: await dashboard(admin, 'admin'),
      lead: await dashboard(lead, 'leadership'),
    };
    const byId = (list, id) => list.find((c) => c.id === id);
    expect('Alder: overdue are c5 (6 days) and c3 (7 days, unassigned), most overdue first', aged.alder.overdue.cases.filter((c) => [c3, c5].includes(c.id)).map((c) => [names.get(c.id), c.daysSinceUpdate, c.overdue, c.assignedTo]), [['c3', 7, true, null], ['c5', 6, true, alder.user.email]]);
    expect('Alder: a case at exactly 5 days is not overdue, nor is one just updated', [byId(aged.alder.myOpenCases.cases, c4)?.daysSinceUpdate, byId(aged.alder.myOpenCases.cases, c4)?.overdue, aged.alder.overdue.cases.some((c) => c.id === c4 || c.id === c2)], [5, false, false]);
    expect('Alder: two more overdue than before', aged.alder.overdue.total - before.alder.overdue.total, 2);
    expect('Alder: his own list shows the oldest first, with the days since each update', aged.alder.myOpenCases.cases.map((c) => [names.get(c.id), c.daysSinceUpdate]).slice(0, 2), [['c5', 6], ['c4', 5]]);
    expect('Bishop sees the unassigned overdue case but not Alder\'s', [aged.bishop.overdue.cases.some((c) => c.id === c3), aged.bishop.overdue.cases.some((c) => c.id === c5)], [true, false]);
    expect('the unassigned queue is still oldest first', ascending(aged.alder.unassigned.oldest.map((c) => c.submittedAt)), true);

    expect('leadership: c5 stuck in review and c3 stuck waiting to start, more than 5 days', [stage(aged.lead, 'submittedToReview').stuck - stage(decided.lead, 'submittedToReview').stuck, stage(aged.lead, 'reviewToDecision').stuck - stage(decided.lead, 'reviewToDecision').stuck, stage(aged.lead, 'appealedToDecision').stuck - stage(decided.lead, 'appealedToDecision').stuck], [1, 1, 0]);
    expect('leadership: the limit for stuck is 5 days', aged.lead.bottlenecks.stuckDays, 5);
    expect('leadership: waiting 100 days before an approval raises the average processing time', aged.lead.kpis.averageProcessingDays > processing, true);
    const alderAged = row(aged.admin.team, 'email', alder.user.email);
    expect('admin team: Alder\'s median is the middle of 100 days and none', alderAged?.medianDaysToDecision, 50);
    expect('leadership team: and so is his average', aged.lead.team.find((t) => t.name === `Dash Alder ${stamp}`)?.averageDays, 50);
  } finally {
    await db.end();
  }

  // 7. A review is resolved by someone other than the decider; it leaves the list and the admin's count of open reviews
  const reviewsBefore = (await dashboard(alder, 'case-manager')).waitingOnMe.reviews.total;
  const openBefore = (await dashboard(admin, 'admin')).health.compliance.openReviews;
  const reviewId = (await dashboard(alder, 'case-manager')).waitingOnMe.reviews.reviews.find((r) => r.caseId === c6).id;
  const resolved = await call('POST', `/compliance/reviews/${reviewId}/resolve`, alder.token, { action: 'accept', note: 'Dashboards suite: exception accepted.' });
  expect('Alder resolves it', resolved.status, 200);
  await sleep(800); // refusals are written in the background
  const after = { alder: await dashboard(alder, 'case-manager'), admin: await dashboard(admin, 'admin'), lead: await dashboard(lead, 'leadership') };
  expect('it leaves the list of reviews Alder may resolve, and the count of open reviews', [reviewsBefore - after.alder.waitingOnMe.reviews.total, openBefore - after.admin.health.compliance.openReviews], [1, 1]);

  // 8. System health, as the admin sees it
  const health = after.admin.health;
  expect('health: database ok, migrations applied up to the leadership role', [health.database, health.migrations.applied >= 17, health.migrations.latest >= '017_leadership_role.sql', typeof health.commit], ['ok', true, true, 'string']);
  expect('health: freshness is read against its 30 s target', [health.freshness.targetMs, health.freshness.sloPercent, health.freshness.status === (health.freshness.p95Ms === null ? 'none' : health.freshness.p95Ms > 30000 ? 'over' : 'ok')], [30000, 95, true]);
  expect('health: compliance rate is read against its 99% target', [health.compliance.target, health.compliance.status === (health.compliance.rate === null ? 'none' : health.compliance.rate < 99 ? 'below' : 'ok')], [99, true]);
  expect('health: the refusals this run caused are counted', health.auditRefusalsLast24h > refusalsBefore, true);
  expect('health: staff by role', [health.staffByRole.case_manager >= 3, health.staffByRole.leadership >= 1, health.staffByRole.admin >= 1], [true, true, true]);

  // 9. Leadership sees aggregates only: no applicant or staff email, no applicant name, no record id
  const shown = JSON.stringify(after.lead);
  const personal = [...applicants.flatMap((a) => [a.user.email, a.user.fullName]), citizen.user.email, citizen.user.fullName, alder.user.email, bishop.user.email, m.user.email];
  expect('leadership output holds no applicant or staff email, no applicant name and no record id', [personal.filter((value) => shown.includes(value)), /@/.test(shown), UUID.test(shown)], [[], false, false]);
  expect('only the names of case managers appear, beside their decisions', [shown.includes(`Dash Alder ${stamp}`), shown.includes(`Dash Bishop ${stamp}`)], [true, true]);

  // 10. Reads and refusals are audited
  await sleep(800);
  const trail = async (query) => (await call('GET', `/audit?${new URLSearchParams({ limit: 100, ...query })}`, admin.token)).data.logs;
  expect('a read of the leadership dashboard is audited with the route', (await trail({ user: lead.user.email, action: 'DATA_READ' })).some((l) => l.details?.route === 'GET /api/dashboards/leadership'), true);
  expect('a refusal is audited with what was tried', (await trail({ user: citizen.user.email, action: 'ACCESS_DENIED' })).some((l) => l.details?.path === '/api/dashboards/admin' && l.details?.status === 403), true);
});

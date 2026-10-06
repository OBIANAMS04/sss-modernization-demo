// STORY-008 decision compliance: controls, reviews, dashboard, audit log (local backend only; see lib.mjs).
import { account, call, exemptionId, expect, MANAGER, REVIEWER, run, stamp } from './lib.mjs';

const lastDecision = async (token, caseId) => (await call('GET', `/compliance/cases/${caseId}`, token)).data.decisions[0];
const failedOf = (d) => d.controls.filter((c) => !c.passed).map((c) => c.controlId);
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

run(async () => {
  const a = await account(`compliance-applicant-${stamp}@example.com`, 'Compliance Applicant');
  const m = await account(MANAGER, 'Manager Test');
  const r = await account(REVIEWER, 'Reviewer Test');
  expect('two case managers', [m.user.role, r.user.role], ['case_manager', 'case_manager']);

  // Qualifies for Type A (born 1950) and Type B (income below threshold)
  await call('PUT', `/users/${a.user.id}`, a.token, { phone: '555-0100', address: '1 Test Way', annualIncome: 15000 });
  const caseB = (await call('POST', '/cases', a.token, { exemptionId: await exemptionId(a.token, 'Type B') })).data.id;
  const caseA = (await call('POST', '/cases', a.token, { exemptionId: await exemptionId(a.token, 'Type A') })).data.id;

  // 1. Compliant approval: assigned, reviewed, income statement on file
  await call('POST', `/cases/${caseB}/documents`, a.token, { documentType: 'income_statement', documentUrl: 'https://example.com/w2.pdf' });
  await call('PUT', `/cases/${caseB}/assignment`, m.token, { assignedTo: m.user.email });
  await call('POST', `/cases/${caseB}/status`, m.token, { status: 'In Review' });
  expect('approve case B', (await call('POST', `/cases/${caseB}/status`, m.token, { status: 'Approved' })).data.status, 'Approved');
  let d = await lastDecision(m.token, caseB);
  expect('case B: 7 controls evaluated, all passed', [d.controls.length, d.compliant, failedOf(d)], [7, true, []]);
  expect('case B: no review opened', (await call('GET', `/compliance/cases/${caseB}`, m.token)).data.reviews.length, 0);

  // 2. Non-compliant approval: unassigned and no proof of age
  await call('POST', `/cases/${caseA}/status`, m.token, { status: 'In Review' });
  await call('POST', `/cases/${caseA}/status`, m.token, { status: 'Approved' });
  d = await lastDecision(m.token, caseA);
  expect('case A: fails accountable reviewer + evidence', failedOf(d), ['CTRL-05', 'CTRL-07']);
  let comp = (await call('GET', `/compliance/cases/${caseA}`, m.token)).data;
  expect('case A: review opened automatically', [comp.reviews.length, comp.reviews[0].status, comp.reviews[0].failedControls], [1, 'Open', ['CTRL-05', 'CTRL-07']]);
  const reviewId = comp.reviews[0].id;

  const dash = (await call('GET', '/compliance/dashboard?days=30', m.token)).data;
  expect('dashboard counts decisions', dash.totalDecisions >= 2, true);
  expect('dashboard alert below 99%', [dash.complianceRate < 99, typeof dash.alert], [true, 'string']);
  expect('dashboard reports failed CTRL-07', dash.controls.find((c) => c.id === 'CTRL-07').failures >= 1, true);
  expect('dashboard counts open reviews', dash.openReviews >= 1, true);

  const q = (await call('GET', `/compliance/decisions?user=compliance-applicant-${stamp}&decision=Approved&controlId=CTRL-07&result=fail`, m.token)).data;
  expect('audit log filter: user + decision + control + result', q.checks.map((c) => c.caseId), [caseA]);
  const byDate = (await call('GET', `/compliance/decisions?from=${day(-1)}&to=${day(1)}&user=compliance-applicant-${stamp}`, m.token)).data;
  expect('audit log filter: date range', byDate.total, 14);
  expect('bad date rejected', (await call('GET', '/compliance/decisions?from=yesterday', m.token)).status, 400);

  expect('applicant cannot read the dashboard', (await call('GET', '/compliance/dashboard', a.token)).status, 403);
  expect('applicant cannot resolve reviews', (await call('POST', `/compliance/reviews/${reviewId}/resolve`, a.token, { action: 'accept', note: 'x' })).status, 403);
  expect('decider cannot resolve own decision', (await call('POST', `/compliance/reviews/${reviewId}/resolve`, m.token, { action: 'accept', note: 'mine' })).status, 403);
  expect('note is required', (await call('POST', `/compliance/reviews/${reviewId}/resolve`, r.token, { action: 'reopen', note: ' ' })).status, 400);

  // 3. Another case manager reopens; the case is decided again, compliantly
  const resolved = await call('POST', `/compliance/reviews/${reviewId}/resolve`, r.token, { action: 'reopen', note: 'Approved without proof of age; reopening.' });
  expect('reviewer reopens', [resolved.status, resolved.data.status, resolved.data.resolution], [200, 'Resolved', 'Case reopened']);
  const reopened = (await call('GET', `/cases/${caseA}`, a.token)).data;
  expect('case A back In Review; applicant sees why', [reopened.status, reopened.timeline.at(-1).detail], ['In Review', 'Reopened after a compliance review']);
  expect('applicant notified of reopening', (await call('GET', '/notifications', a.token)).data.notifications[0].message.includes('reopened'), true);
  await call('POST', `/cases/${caseA}/documents`, a.token, { documentType: 'proof_of_age', documentUrl: 'https://example.com/birth.pdf' });
  await call('PUT', `/cases/${caseA}/assignment`, r.token, { assignedTo: r.user.email });
  await call('POST', `/cases/${caseA}/status`, r.token, { status: 'Approved' });
  d = await lastDecision(r.token, caseA);
  expect('case A re-decided compliantly', [d.decidedBy, d.compliant], [r.user.email, true]);
  comp = (await call('GET', `/compliance/cases/${caseA}`, r.token)).data;
  expect('case A keeps both decisions, newest first', comp.decisions.map((x) => x.compliant), [true, false]);

  // 4. Compliant denial; then an appeal approval with an accepted exception
  const b = await account(`compliance-applicant-b-${stamp}@example.com`, 'Second Applicant');
  await call('POST', '/exemptions/check', b.token);
  const caseC = (await call('POST', '/cases', b.token, { exemptionId: await exemptionId(b.token, 'Type A') })).data.id;
  await call('PUT', `/cases/${caseC}/assignment`, m.token, { assignedTo: m.user.email });
  await call('POST', `/cases/${caseC}/status`, m.token, { status: 'In Review' });
  await call('POST', `/cases/${caseC}/status`, m.token, { status: 'Denied', reason: 'Proof of age not provided.' });
  d = await lastDecision(m.token, caseC);
  expect('denial with reason is compliant', [d.decision, d.compliant, d.controls.length], ['Denied', true, 6]);

  await call('POST', `/cases/${caseC}/status`, b.token, { status: 'Appealed' });
  await call('POST', `/cases/${caseC}/status`, r.token, { status: 'In Review' });
  await call('POST', `/cases/${caseC}/status`, r.token, { status: 'Approved' }); // still assigned to m; no document
  comp = (await call('GET', `/compliance/cases/${caseC}`, r.token)).data;
  const open = comp.reviews.find((x) => x.status === 'Open');
  expect('non-assignee approval without evidence opens a review', open.failedControls, ['CTRL-05', 'CTRL-07']);
  const accepted = await call('POST', `/compliance/reviews/${open.id}/resolve`, m.token, { action: 'accept', note: 'Birth certificate verified in person at the local board.' });
  expect('another manager accepts the exception', [accepted.status, accepted.data.resolution, accepted.data.resolvedBy], [200, 'Exception accepted', m.user.email]);
  expect('resolved review cannot be resolved twice', (await call('POST', `/compliance/reviews/${open.id}/resolve`, m.token, { action: 'accept', note: 'again' })).status, 409);
  expect('case stays Approved after an accepted exception', (await call('GET', `/cases/${caseC}`, b.token)).data.status, 'Approved');

  const audit = (await call('GET', '/audit?action=COMPLIANCE_CHECK&limit=100', m.token)).data.logs.filter((l) => [caseA, caseB, caseC].includes(l.resourceId));
  expect('every decision has a COMPLIANCE_CHECK audit entry', audit.length, 5);
  expect('non-compliant decisions are audited as failures', audit.filter((l) => l.status === 'failure').length, 2);
  const overrides = (await call('GET', '/audit?action=OVERRIDE&limit=50', m.token)).data.logs.filter((l) => l.resourceId === caseC);
  expect('accepted exception audited as OVERRIDE', overrides.length, 1);
});

// STORY-007 case workflow: apply, review, deny with reason, appeal, approve (local backend only; see lib.mjs).
import { account, call, exemptionId, expect, MANAGER, run, stamp } from './lib.mjs';

run(async () => {
  const a = await account(`applicant-${stamp}@example.com`, '=HYPERLINK("http://evil")');
  const m = await account(MANAGER, 'Manager Test');

  await call('POST', '/exemptions/check', a.token);
  const typeA = await exemptionId(a.token, 'Type A');
  const typeB = await exemptionId(a.token, 'Type B');

  const applied = await call('POST', '/cases', a.token, { exemptionId: typeA });
  expect('apply for eligible Type A', [applied.status, applied.data.status], [201, 'Submitted']);
  const caseId = applied.data.id;
  expect('apply twice: 409', (await call('POST', '/cases', a.token, { exemptionId: typeA })).status, 409);
  expect('apply for Not Eligible Type B: 400', (await call('POST', '/cases', a.token, { exemptionId: typeB })).status, 400);
  expect('applicant cannot approve own case', (await call('POST', `/cases/${caseId}/status`, a.token, { status: 'Approved' })).status, 400);
  expect('submission notification', (await call('GET', '/notifications', a.token)).data.notifications[0]?.message.includes('submitted'), true);

  const filtered = await call('GET', `/cases?scope=all&status=Submitted&exemptionType=Type%20A&applicant=applicant-${stamp}`, m.token);
  expect('staff filter by status + type + applicant', filtered.data.cases.map((c) => c.id), [caseId]);

  expect('assign to a citizen: 400', (await call('PUT', `/cases/${caseId}/assignment`, m.token, { assignedTo: a.user.email })).status, 400);
  const assigned = await call('PUT', `/cases/${caseId}/assignment`, m.token, { assignedTo: m.user.email });
  expect('assign to case manager', [assigned.status, assigned.data.assignedTo], [200, m.user.email]);

  expect('staff cannot skip to Approved', (await call('POST', `/cases/${caseId}/status`, m.token, { status: 'Approved' })).status, 400);
  expect('staff: In Review', (await call('POST', `/cases/${caseId}/status`, m.token, { status: 'In Review' })).data.status, 'In Review');
  expect('deny without reason: 400', (await call('POST', `/cases/${caseId}/status`, m.token, { status: 'Denied' })).status, 400);
  expect('deny with reason', (await call('POST', `/cases/${caseId}/status`, m.token, { status: 'Denied', reason: 'Proof of age not provided.' })).data.status, 'Denied');

  expect('staff adds internal note', (await call('POST', `/cases/${caseId}/notes`, m.token, { content: 'Called applicant; awaiting ID.' })).status, 201);
  expect('applicant cannot read notes', (await call('GET', `/cases/${caseId}/notes`, a.token)).status, 403);

  let detail = (await call('GET', `/cases/${caseId}`, a.token)).data;
  expect('applicant sees appeal action only', detail.actions.transitions, ['Appealed']);
  expect('applicant timeline hides internal events', detail.timeline.map((e) => e.eventType), ['created', 'status_change', 'status_change']);
  expect('denial reason visible to applicant', detail.timeline.at(-1).detail, 'Proof of age not provided.');

  expect('javascript: link rejected', (await call('POST', `/cases/${caseId}/documents`, a.token, { documentType: 'proof_of_age', documentUrl: 'javascript:alert(1)' })).status, 400);
  expect('applicant attaches document', (await call('POST', `/cases/${caseId}/documents`, a.token, { documentType: 'proof_of_age', documentUrl: 'https://example.com/birth.pdf' })).status, 201);
  expect('applicant appeals', (await call('POST', `/cases/${caseId}/status`, a.token, { status: 'Appealed' })).data.status, 'Appealed');
  await call('POST', `/cases/${caseId}/status`, m.token, { status: 'In Review' });
  const approved = await call('POST', `/cases/${caseId}/status`, m.token, { status: 'Approved' });
  expect('staff approves after appeal', [approved.data.status, !!approved.data.approvedAt], ['Approved', true]);
  expect('Approved is final', (await call('POST', `/cases/${caseId}/status`, m.token, { status: 'Denied', reason: 'x' })).status, 400);

  const csv = await call('GET', `/cases/export?applicant=applicant-${stamp}`, m.token);
  const lines = csv.data.trim().split('\r\n');
  expect('CSV export has the case', lines.length === 2 && lines[1].includes(caseId), true);
  expect('CSV neutralises a formula in a name', lines[1].includes(`"'=HYPERLINK(""http://evil"")"`), true);
  expect('CSV has no SSN data', /ssn|900-00/i.test(csv.data), false);
  expect('citizen cannot export', (await call('GET', '/cases/export', a.token)).status, 403);
});

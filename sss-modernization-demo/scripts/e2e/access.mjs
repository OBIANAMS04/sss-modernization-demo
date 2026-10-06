// Who can reach what: citizen, other citizen, anonymous and case manager (local backend only; see lib.mjs).
import { account, call, exemptionId, expect, MANAGER, run, stamp } from './lib.mjs';

run(async () => {
  const a = await account(`citizen-a-${stamp}@example.com`, 'Citizen A');
  const b = await account(`citizen-b-${stamp}@example.com`, 'Citizen B');
  const m = await account(MANAGER, 'Manager Test');
  expect('citizen role on register', a.user.role, 'citizen');
  expect('listed email gets case_manager role', m.user.role, 'case_manager');

  await call('POST', '/exemptions/check', a.token);
  await call('POST', '/exemptions/check', b.token);
  const created = await call('POST', '/cases', a.token, { exemptionId: await exemptionId(a.token, 'Type A') });
  expect('citizen opens case for own exemption', created.status, 201);
  const caseId = created.data.id;
  const otherExemption = await exemptionId(b.token, 'Type A');
  expect("citizen cannot open a case for another user's exemption", (await call('POST', '/cases', a.token, { exemptionId: otherExemption })).status, 403);

  const uuid = '00000000-0000-4000-8000-000000000000';
  expect('other citizen: GET /cases/:id', (await call('GET', `/cases/${caseId}`, b.token)).status, 403);
  expect('other citizen: GET /cases/:id/documents', (await call('GET', `/cases/${caseId}/documents`, b.token)).status, 403);
  expect('other citizen: POST /cases/:id/documents', (await call('POST', `/cases/${caseId}/documents`, b.token, { documentType: 'other', documentUrl: 'https://x.example' })).status, 403);
  expect('citizen: GET /cases/:id/notes', (await call('GET', `/cases/${caseId}/notes`, a.token)).status, 403);
  expect('citizen: PUT /cases/:id (approve)', (await call('PUT', `/cases/${caseId}`, a.token, { status: 'Approved' })).status, 403);
  expect('citizen: GET /cases?scope=all', (await call('GET', '/cases?scope=all', b.token)).status, 403);
  const own = await call('GET', '/cases?status=Submitted', b.token);
  expect('citizen: GET /cases?status=... returns only own cases', own.data.cases.every((c) => c.userId === b.user.id), true);
  expect('citizen: GET /cases/stats', (await call('GET', '/cases/stats', b.token)).status, 403);
  expect('citizen: GET /audit', (await call('GET', '/audit', b.token)).status, 403);
  expect('citizen: GET /audit/user/<other>', (await call('GET', `/audit/user/${a.user.id}`, b.token)).status, 403);
  expect('citizen: GET /audit/user/<self>', (await call('GET', `/audit/user/${b.user.id}`, b.token)).status, 200);
  expect('citizen: GET /compliance/matrix (reference)', (await call('GET', '/compliance/matrix', b.token)).status, 200);
  expect('citizen: GET /compliance/dashboard', (await call('GET', '/compliance/dashboard', b.token)).status, 403);
  expect('citizen: GET /compliance/decisions', (await call('GET', '/compliance/decisions', b.token)).status, 403);
  expect('citizen: POST /compliance/reviews/:id/resolve', (await call('POST', `/compliance/reviews/${uuid}/resolve`, b.token, { action: 'accept', note: 'x' })).status, 403);
  expect('citizen: POST /latency/cleanup', (await call('POST', '/latency/cleanup', b.token, {})).status, 403);
  expect('citizen: GET /exemptions/stats', (await call('GET', '/exemptions/stats', b.token)).status, 403);
  expect('citizen: GET /data/pipeline-status?userId=<other>', (await call('GET', `/data/pipeline-status?userId=${a.user.id}`, b.token)).status, 403);
  expect('anonymous: GET /data/pipeline-status?userId=<other>', (await call('GET', `/data/pipeline-status?userId=${a.user.id}`, null)).status, 403);
  expect('anonymous: GET /cases', (await call('GET', '/cases', null)).status, 401);
  expect('invalid token: GET /cases (401, not 500)', (await call('GET', '/cases', 'not-a-token')).status, 401);

  expect('owner: GET /cases/:id', (await call('GET', `/cases/${caseId}`, a.token)).status, 200);
  expect('malformed id: 404 not 500', (await call('GET', '/cases/not-a-uuid', a.token)).status, 404);

  const all = await call('GET', '/cases?scope=all&limit=200', m.token);
  expect('staff: GET /cases?scope=all includes the case', all.data.cases.some((c) => c.id === caseId), true);
  expect('staff: GET /cases/stats', (await call('GET', '/cases/stats', m.token)).status, 200);
  expect('staff: GET /audit', (await call('GET', '/audit', m.token)).status, 200);
  expect('staff: GET /compliance/dashboard', (await call('GET', '/compliance/dashboard', m.token)).status, 200);
});

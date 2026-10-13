// Staff Access: an existing case manager gives and removes the case-manager role in the app; registering never
// does once staff exist; every change is audited with who made it and why, and the person is told
// (local backend only; see lib.mjs).
import { account, call, expect, MANAGER, PASSWORD, run, stamp, staffAccount } from './lib.mjs';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

run(async () => {
  const m = await staffAccount(MANAGER, 'Manager Test');
  const citizen = await account(`staff-citizen-${stamp}@example.com`, 'Staff Citizen');
  const person = await account(`staff-person-${stamp}@example.com`, 'Staff Person');
  const email = person.user.email;
  const grantReason = `Joins the review team (staff suite ${stamp})`;
  const revokeReason = `Leaves the review team (staff suite ${stamp})`;

  // The list no longer makes anyone a case manager once staff exist, even a listed address in another case
  const lookalike = MANAGER.replace(/^./, (c) => c.toUpperCase());
  const registered = await call('POST', '/auth/register', null, { email: lookalike, password: PASSWORD, fullName: 'Lookalike Test', ssn: '900-00-0010', dob: '1950-06-01' });
  const lookalikeRole = registered.status === 201 ? registered.data.user.role : (await call('POST', '/auth/login', null, { email: lookalike, password: PASSWORD })).data.user?.role;
  expect('a listed address that registers once staff exist is a citizen', lookalikeRole, 'citizen');

  expect('a citizen is refused GET /staff', (await call('GET', '/staff', citizen.token)).status, 403);
  expect('a citizen is refused POST /staff/grant', (await call('POST', '/staff/grant', citizen.token, { email, reason: 'Trying' })).status, 403);
  expect('a citizen is refused POST /staff/:id/revoke', (await call('POST', `/staff/${m.user.id}/revoke`, citizen.token, { reason: 'Trying' })).status, 403);
  expect('anonymous caller is refused', (await call('GET', '/staff', null)).status, 401);

  const list = await call('GET', '/staff', m.token);
  const mine = list.data.staff?.find((s) => s.email === MANAGER);
  expect('a manager lists staff, including themselves', [list.status, mine?.id, mine?.role], [200, m.user.id, 'case_manager']);
  expect('the list holds staff only, with who and since when', list.data.staff.every((s) => ['case_manager', 'admin'].includes(s.role) && s.fullName && s.createdAt), true);
  expect('the citizen is not listed', list.data.staff.some((s) => s.id === citizen.user.id || s.id === person.user.id), false);

  expect('grant without a reason is refused', (await call('POST', '/staff/grant', m.token, { email })).status, 400);
  expect('grant with a blank reason is refused', (await call('POST', '/staff/grant', m.token, { email, reason: '   ' })).status, 400);
  expect('grant with a reason over 500 characters is refused', (await call('POST', '/staff/grant', m.token, { email, reason: 'x'.repeat(501) })).status, 400);
  expect('grant without an email is refused', (await call('POST', '/staff/grant', m.token, { reason: 'No address' })).status, 400);
  const unknown = await call('POST', '/staff/grant', m.token, { email: `nobody-${stamp}@example.com`, reason: 'Never registered' });
  expect('an unknown email is 404 and says to register first', [unknown.status, unknown.data.error?.message], [404, 'No account uses that email. They need to register first.']);
  expect('an address that is already staff is 409', (await call('POST', '/staff/grant', m.token, { email: MANAGER, reason: 'Already one' })).status, 409);
  expect('the refused grants changed nothing', (await call('GET', '/cases/stats', person.token)).status, 403);

  const granted = await call('POST', '/staff/grant', m.token, { email: email.toUpperCase(), reason: `  ${grantReason}  ` });
  expect('granting a registered citizen works, whatever the case of the address', [granted.status, granted.data.user], [200, { id: person.user.id, email, fullName: 'Staff Person', role: 'case_manager' }]);
  expect('the new case manager can use a staff route straight away', (await call('GET', '/cases/stats', person.token)).status, 200);
  expect('and now appears in the list', (await call('GET', '/staff', m.token)).data.staff.some((s) => s.id === person.user.id), true);
  expect('granting again is 409', (await call('POST', '/staff/grant', m.token, { email, reason: 'Again' })).status, 409);

  expect('removing yourself is refused', (await call('POST', `/staff/${m.user.id}/revoke`, m.token, { reason: 'Stepping back' })).status, 403);
  expect('removing without a reason is refused', (await call('POST', `/staff/${person.user.id}/revoke`, m.token, {})).status, 400);
  expect('removing an unknown account is 404', (await call('POST', `/staff/${UNKNOWN_ID}/revoke`, m.token, { reason: 'Gone' })).status, 404);
  expect('a malformed id is 404, not 500', (await call('POST', '/staff/not-an-id/revoke', m.token, { reason: 'Gone' })).status, 404);
  expect('removing someone who is not a case manager is 409', (await call('POST', `/staff/${citizen.user.id}/revoke`, m.token, { reason: 'Never was' })).status, 409);
  expect('the refused removals changed nothing', (await call('GET', '/cases/stats', person.token)).status, 200);

  const removed = await call('POST', `/staff/${person.user.id}/revoke`, m.token, { reason: revokeReason });
  expect('removing the new case manager works', [removed.status, removed.data.user?.role], [200, 'citizen']);
  expect('they are refused staff routes again straight away', (await call('GET', '/cases/stats', person.token)).status, 403);
  expect('and are gone from the list', (await call('GET', '/staff', m.token)).data.staff.some((s) => s.id === person.user.id), false);

  const trail = (await call('GET', `/audit?${new URLSearchParams({ user: email, resource: 'users', limit: 100 })}`, m.token)).data.logs;
  const grant = trail.find((l) => l.action === 'PERMISSION_GRANT');
  const revoke = trail.find((l) => l.action === 'PERMISSION_REVOKE');
  // Stored JSON does not keep key order, so the details are compared field by field
  const fields = (log) => [log?.status, log?.actor, log?.actorEmail, log?.resourceId, log?.details?.email, log?.details?.role, log?.details?.reason, log?.details?.via];
  expect(
    'the grant is audited: who gave it, to whom, and why',
    fields(grant),
    ['success', m.user.id, MANAGER, person.user.id, email, 'case_manager', grantReason, 'Staff Access']
  );
  expect(
    'the removal is audited: who removed it, from whom, and why',
    fields(revoke),
    ['success', m.user.id, MANAGER, person.user.id, email, 'citizen', revokeReason, 'Staff Access']
  );
  expect('each change is audited once', [trail.filter((l) => l.action === 'PERMISSION_GRANT').length, trail.filter((l) => l.action === 'PERMISSION_REVOKE').length], [1, 1]);

  const inbox = (await call('GET', '/notifications?limit=50', person.token)).data.notifications;
  expect('the person was told when access was given, and by whom', inbox.some((n) => n.message === `You now have case-manager access, granted by ${MANAGER}. Sign in again to see the staff pages.`), true);
  expect('and when it was removed, and by whom', inbox.some((n) => n.message === `Your case-manager access was removed by ${MANAGER}.`), true);
  expect('neither notification links to a case', inbox.filter((n) => /case-manager access/.test(n.message)).every((n) => n.caseId === null), true);
});

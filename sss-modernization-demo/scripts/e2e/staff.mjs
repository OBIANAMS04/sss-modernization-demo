// Staff Access: an existing case manager gives and removes the case-manager role in the app; registering never
// does once staff exist; every change is audited with who made it and why, and the person is told. An administrator
// also gives and removes leadership and administrator access, a case manager is refused those, and the last
// administrator cannot be removed (local backend only; see lib.mjs; needs ADMIN_EMAILS to list morgan.lee@example.com,
// and DATABASE_NAME when the database is not sss_demo).
import { createRequire } from 'node:module';
import { account, adminAccount, call, expect, MANAGER, PASSWORD, run, stamp, staffAccount } from './lib.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');
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
  expect('the list holds staff only, with who and since when', list.data.staff.every((s) => ['case_manager', 'leadership', 'admin'].includes(s.role) && s.fullName && s.createdAt), true);
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

  // Roles beyond case manager
  const admin = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
  const director = await account(`staff-director-${stamp}@example.com`, 'Staff Director');
  const upgraded = await account(`staff-upgrade-${stamp}@example.com`, 'Staff Upgrade');
  const give = (who, to, role, reason = 'Test of role selection') => call('POST', '/staff/grant', who.token, { email: to.user.email, role, reason });
  const take = (who, to, reason = 'Test of role selection') => call('POST', `/staff/${to.user.id}/revoke`, who.token, { reason });
  const roleNow = async (who) => (await account(who.user.email, who.user.fullName)).user.role;
  const audited = async (to, action) => (await call('GET', `/audit?${new URLSearchParams({ user: to.user.email, resource: 'users', action, limit: 100 })}`, admin.token)).data.logs;

  // A case manager gives case-manager access only
  for (const [role, name] of [['leadership', 'leadership'], ['admin', 'administrator']]) {
    const refused = await give(m, director, role);
    expect(`a case manager is refused ${role} access`, [refused.status, refused.data.error?.message], [403, `Only an administrator can give ${name} access.`]);
  }
  expect('the refused grants changed nothing', await roleNow(director), 'citizen');
  expect('an unknown role is refused, and so is citizen', [(await give(admin, director, 'superuser')).status, (await give(admin, director, 'citizen')).status], [400, 400]);

  // An administrator gives leadership access
  const given = await give(admin, director, 'leadership', `Director of operations (staff suite ${stamp})`);
  expect('an admin gives leadership access', [given.status, given.data.user], [200, { id: director.user.id, email: director.user.email, fullName: 'Staff Director', role: 'leadership' }]);
  expect('they sign in as leadership', await roleNow(director), 'leadership');
  expect('leadership reads the leadership dashboard', (await call('GET', '/dashboards/leadership', director.token)).status, 200);
  expect('leadership is not staff: the case routes, the case manager dashboard and Staff Access refuse it', [
    (await call('GET', '/cases/stats', director.token)).status,
    (await call('GET', '/cases?scope=all', director.token)).status,
    (await call('GET', '/dashboards/case-manager', director.token)).status,
    (await call('GET', '/staff', director.token)).status,
    (await call('POST', '/staff/grant', director.token, { email: person.user.email, reason: 'Trying' })).status,
  ], [403, 403, 403, 403, 403]);
  expect('the list shows every staff role, leadership included', (await call('GET', '/staff', m.token)).data.staff.find((s) => s.id === director.user.id)?.role, 'leadership');
  const [leadershipGrant] = await audited(director, 'PERMISSION_GRANT');
  expect(
    'the grant is audited with the role, who gave it and why',
    [leadershipGrant?.status, leadershipGrant?.actorEmail, leadershipGrant?.details?.role, leadershipGrant?.details?.reason, leadershipGrant?.details?.via],
    ['success', 'morgan.lee@example.com', 'leadership', `Director of operations (staff suite ${stamp})`, 'Staff Access']
  );
  expect(
    'the person is told what they now have, and who gave it',
    (await call('GET', '/notifications?limit=50', director.token)).data.notifications.some((n) => n.message === 'You now have leadership access, granted by morgan.lee@example.com. Sign in again to see the leadership dashboard.'),
    true
  );

  // A person has one role: another is given by removing the first (an upgrade to admin is the exception)
  expect('leadership cannot be given to a case manager, nor case-manager access to leadership', [(await give(admin, m, 'leadership')).status, (await give(admin, director, 'case_manager')).status, (await give(m, director, 'case_manager')).status], [409, 409, 409]);
  expect('nor leadership twice', (await give(admin, director, 'leadership')).status, 409);
  expect('a case manager cannot remove leadership or an administrator', [
    (await take(m, director)).data.error?.message,
    (await take(m, admin)).data.error?.message,
  ], ['Leadership access can only be changed by an administrator.', 'Administrator access can only be changed by an administrator.']);
  expect('so they still have it', [await roleNow(director), (await call('GET', '/dashboards/admin', admin.token)).status], ['leadership', 200]);

  // An administrator removes it, and it ends at once
  const removedLeadership = await take(admin, director, `Leaves the program office (staff suite ${stamp})`);
  expect('an admin removes leadership access', [removedLeadership.status, removedLeadership.data.user?.role], [200, 'citizen']);
  expect('and the leadership dashboard is refused straight away', (await call('GET', '/dashboards/leadership', director.token)).status, 403);
  const [leadershipRevoke] = await audited(director, 'PERMISSION_REVOKE');
  expect('the removal is audited with what they had', [leadershipRevoke?.details?.role, leadershipRevoke?.details?.previousRole, leadershipRevoke?.actorEmail], ['citizen', 'leadership', 'morgan.lee@example.com']);

  // A case manager becomes an administrator by upgrade, and keeps working cases
  expect('a case manager gives case-manager access, then an admin upgrades it', [(await give(m, upgraded, 'case_manager')).status, (await give(admin, upgraded, 'admin', `Second administrator (staff suite ${stamp})`)).data.user?.role], [200, 'admin']);
  expect('the new administrator reads the admin dashboard and still works cases', [(await call('GET', '/dashboards/admin', upgraded.token)).status, (await call('GET', '/cases/stats', upgraded.token)).status], [200, 200]);
  const upgrades = await audited(upgraded, 'PERMISSION_GRANT');
  expect('the upgrade is audited with what they were', upgrades.find((l) => l.details?.role === 'admin')?.details?.previousRole, 'case_manager');
  expect('nobody removes their own access, an administrator included', (await take(upgraded, upgraded)).status, 403);

  // Never the last administrator. Two administrators removing each other at the same moment both pass the role check, so
  // the removal that runs second is the one the database must refuse. Every other administrator is set aside for each round,
  // and put back after it.
  const db = new Client({ host: 'localhost', database: process.env.DATABASE_NAME || 'sss_demo', user: 'admin', password: 'dev_password' });
  await db.connect();
  let refusedByGuard = 0;
  try {
    for (let round = 1; round <= 3; round++) {
      const pair = [await account(`staff-race-${round}a-${stamp}@example.com`, `Race ${round}A`), await account(`staff-race-${round}b-${stamp}@example.com`, `Race ${round}B`)];
      for (const racer of pair) await give(admin, racer, 'admin', `Race ${round} (staff suite ${stamp})`);
      const aside = (await db.query(`UPDATE users SET role = 'case_manager' WHERE role = 'admin' AND id <> ALL($1::uuid[]) RETURNING id`, [pair.map((r) => r.user.id)])).rows.map((r) => r.id);
      try {
        const results = await Promise.all([take(pair[0], pair[1], `Race ${round}`), take(pair[1], pair[0], `Race ${round}`)]);
        const left = (await db.query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`)).rows[0].n;
        refusedByGuard += results.filter((r) => r.status === 409).length;
        expect(
          `round ${round}: of two administrators removing each other, one removal works, the other is refused, and one administrator is left`,
          [results.map((r) => r.status).filter((status) => status === 200).length, results.every((r) => [200, 403, 409].includes(r.status)), results.filter((r) => r.status === 409).every((r) => r.data.error?.message === 'At least one administrator must keep access.'), left],
          [1, true, true, 1]
        );
      } finally {
        if (aside.length) await db.query(`UPDATE users SET role = 'admin' WHERE id = ANY($1::uuid[])`, [aside]);
      }
    }
    console.log(`      (the guard itself refused ${refusedByGuard} of 3 second removals; the others were refused at the role check, one request later)`);
    expect('the administrators set aside are back', (await call('GET', '/staff', admin.token)).data.staff?.find((s) => s.email === 'morgan.lee@example.com')?.role, 'admin');
  } finally {
    await db.end();
  }
});

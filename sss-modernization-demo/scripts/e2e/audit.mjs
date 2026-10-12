// STORY-010 security audit log: sign-ins, refusals, data access and exports are recorded with who and
// from where, without personal data, and the database refuses to change them (local backend only; see lib.mjs).
import { createRequire } from 'node:module';
import { account, call, expect, MANAGER, PASSWORD, run, stamp } from './lib.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

run(async () => {
  const m = await account(MANAGER, 'Manager Test');
  const email = `audit-applicant-${stamp}@example.com`;
  const a = await account(email, 'Audit Applicant'); // registers with the synthetic SSN 900-00-0010
  const find = async (query) => (await call('GET', `/audit?${new URLSearchParams(query)}`, m.token)).data;

  expect('wrong password is refused', (await call('POST', '/auth/login', null, { email, password: 'Wrong-Passw0rd!' })).status, 400);
  const login = await call('POST', '/auth/login', null, { email, password: PASSWORD });
  expect('sign-in succeeds', login.status, 200);
  const token = login.data.token;
  expect('citizen is refused a staff route', (await call('GET', '/cases/stats', token)).status, 403);
  expect('anonymous caller is refused', (await call('GET', '/cases', null)).status, 401);
  expect('applicant reads their own profile', (await call('GET', `/users/${a.user.id}`, token)).status, 200);
  expect('staff export the case list', (await call('GET', '/cases/export', m.token)).status, 200);
  expect('sign-out is accepted', (await call('POST', '/auth/logout', token)).status, 204);
  await sleep(800); // most entries are written in the background

  const mine = await find({ user: email, limit: 200 });
  const events = mine.logs.map((l) => `${l.action}:${l.status}`);
  expect('registration recorded', events.includes('USER_REGISTRATION:success'), true);
  expect('successful sign-in recorded', events.includes('USER_LOGIN:success'), true);
  expect('sign-out recorded', events.includes('USER_LOGOUT:success'), true);
  expect(
    'refusal recorded against the user, with what was tried',
    mine.logs.some((l) => l.action === 'ACCESS_DENIED' && l.details.path === '/api/cases/stats' && l.details.status === 403),
    true
  );
  expect(
    'read of the profile recorded with its record id and route',
    mine.logs.some((l) => l.action === 'DATA_READ' && l.resourceId === a.user.id && l.details.route === 'GET /api/users/:id'),
    true
  );

  const failed = (await find({ action: 'USER_LOGIN', status: 'failure', limit: 100 })).logs.find((l) => l.details?.email === email);
  expect('failed sign-in recorded with the address tried, and no signed-in user', [Boolean(failed), failed?.actorEmail ?? null], [true, null]);
  expect('searching by the user also finds their failed sign-ins', mine.logs.some((l) => l.id === failed?.id), true);
  expect('export recorded as an export', (await find({ action: 'DATA_EXPORT', user: MANAGER, limit: 1 })).logs[0]?.details?.route, 'GET /api/cases/export');
  expect(
    'anonymous refusal recorded',
    (await find({ action: 'ACCESS_DENIED', limit: 100 })).logs.some((l) => !l.actorEmail && l.details?.path === '/api/cases' && l.details?.status === 401),
    true
  );
  expect('entries record the caller address and browser', [Boolean(mine.logs[0].ipAddress), Boolean(mine.logs[0].userAgent)], [true, true]);

  const trail = JSON.stringify([...mine.logs, failed]);
  expect('no SSN anywhere in the trail', /900-?00-?0010/.test(trail), false);
  expect('no password anywhere in the trail', trail.includes(PASSWORD) || trail.includes('Wrong-Passw0rd!'), false);

  expect('date range filter', (await find({ user: email, startDate: day(-1), endDate: day(1) })).total, mine.total);
  expect('area filter', (await find({ user: email, resource: 'auth' })).logs.every((l) => l.resource === 'auth'), true);
  expect('bad date rejected', (await call('GET', '/audit?startDate=yesterday', m.token)).status, 400);
  await sleep(300);
  expect('reading the audit log is itself audited', (await find({ action: 'DATA_READ', user: MANAGER, resource: 'audit', limit: 1 })).total > 0, true);
  expect('each server start is recorded as a deployment', (await find({ action: 'DEPLOYMENT', limit: 1 })).total > 0, true);
  const config = (await find({ action: 'CONFIG_CHANGE', limit: 100 })).logs;
  expect(
    'configuration is recorded at startup, naming changed secrets without values or fingerprints',
    [config.length > 0, config.every((l) => l.resource === 'system' && Array.isArray(l.details.changed ?? l.details.settings)), /sha256:/.test(JSON.stringify(config))],
    [true, true, false]
  );

  const stats = (await call('GET', '/audit/stats', m.token)).data;
  expect('write-once and retention are read from the database', [stats.immutable, stats.retention], [true, '7 years']);
  const db = new Client({ host: 'localhost', database: process.env.DATABASE_NAME || 'sss_demo', user: 'admin', password: 'dev_password' });
  await db.connect();
  try {
    for (const [label, sql] of [
      ['edit', `UPDATE audit_logs SET status = 'success' WHERE id = (SELECT MAX(id) FROM audit_logs)`],
      ['delete', 'DELETE FROM audit_logs WHERE id = (SELECT MAX(id) FROM audit_logs)'],
      ['truncate', 'TRUNCATE audit_logs'],
    ]) {
      const error = await db.query(sql).then(() => null, (e) => e.message);
      expect(`the database refuses to ${label} audit entries`, /append-only/.test(error ?? ''), true);
    }
    const kept = (await db.query(`SELECT retain_until = timestamp + INTERVAL '7 years' AS ok FROM audit_logs ORDER BY id DESC LIMIT 1`)).rows[0].ok;
    expect('each entry carries a retain-until date 7 years on', kept, true);
  } finally {
    await db.end();
  }
});

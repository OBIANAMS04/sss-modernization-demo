// STORY-034 failover: the API survives its database going away and recovers by itself (LOCAL only; it starts its own backend).
// It runs the compiled backend (npm run build first) on port 3099 against a database that does not exist yet, then:
//   1. starts with no database: the API listens, /health says database "down" and still reports the commit, data routes answer 503
//   2. the database appears: the API runs its migrations by itself and serves, with no restart (same process id)
//   3. the database stops accepting connections (and the open ones are cut): health "down", data routes 503, same process
//   4. the database accepts connections again: the API serves again, the earlier sign-in still works, same process
// The database it creates and drops is its own (sss_failover_<stamp>); it never touches another one.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, run, stamp } from './lib.mjs';

const BACKEND = resolve(fileURLToPath(new URL('../../backend', import.meta.url)));
const { Client } = createRequire(resolve(BACKEND, 'package.json'))('pg');
const PORT = 3099;
const ROOT = `http://localhost:${PORT}`;
const API = `${ROOT}/api`;
const DB = `sss_failover_${stamp}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = async (sql) => {
  const c = new Client({ host: 'localhost', database: 'postgres', user: 'admin', password: process.env.PGPASSWORD || 'dev_password' });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
};
const get = async (url, token) => {
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, retryAfter: res.headers.get('retry-after'), body: await res.json().catch(() => null) };
};
const until = async (label, test, ms = 60000) => {
  const end = Date.now() + ms;
  for (;;) {
    const r = await test().catch(() => null);
    if (r) return r;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${label}`);
    await sleep(500);
  }
};

run(async () => {
  let child;
  let exitCode = null;
  try {
    child = spawn(process.execPath, ['dist/index.js'], {
      cwd: BACKEND,
      env: { ...process.env, DATABASE_NAME: DB, PORT: String(PORT), AI_PROVIDER: 'stub', CORS_ORIGIN: 'http://localhost:4173', ADMIN_EMAILS: 'morgan.lee@example.com', CASE_MANAGER_EMAILS: 'manager-local-test@example.com' },
      stdio: 'ignore',
    });
    child.on('exit', (code) => (exitCode = code));

    // 1. No database at all
    // The first moments report "starting" (503); once the first connection attempt fails it reports "down"
    const down = await until('the API to answer /health with no database', async () => { const b = (await get(`${ROOT}/health`)).body; return b?.database === 'down' ? b : null; });
    expect('starts and listens with the database away: /health database', down.database, 'down');
    expect('/health status is degraded', down.status, 'degraded');
    expect('/health still reports the commit', typeof down.commit === 'string' && down.commit.length > 0, true);
    const refused = await get(`${API}/exemptions`);
    expect('data route answers 503', refused.status, 503);
    expect('503 has a clear error code', refused.body?.error?.code, 'SERVICE_UNAVAILABLE');
    expect('503 message says the database cannot be reached and nothing was saved', /cannot reach its database/.test(refused.body?.error?.message) && /Nothing you sent was saved/.test(refused.body?.error?.message), true);
    expect('503 carries Retry-After', refused.retryAfter, '5');
    expect('sign-in is also 503, not a crash', (await get(`${API}/auth/login`)).status, 503);
    expect('still running after 3 s without a database', (await sleep(3000), exitCode), null);

    // 2. The database appears
    await admin(`CREATE DATABASE ${DB}`);
    const up = await until('the API to recover on its own', async () => {
      const h = (await get(`${ROOT}/health`)).body;
      return h?.database === 'ok' && h.startup === 'complete' ? h : null;
    }, 90000);
    expect('recovered by itself: database ok', up.database, 'ok');
    expect('recovered by itself: migrations applied', up.migrations.applied >= 25, true);
    expect('no restart: process still running', exitCode, null);
    expect('data route answers again (401 without a token, not 503)', (await get(`${API}/exemptions`)).status, 401);
    const email = `failover-${stamp}@example.com`;
    const registered = await fetch(`${API}/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Str0ng!Passw0rd', fullName: 'Failover Test', ssn: '900-00-0010', dob: '1950-06-01' }),
    });
    const session = await registered.json();
    expect('registers an account after recovery', registered.status, 201);
    expect('signed-in read works', (await get(`${API}/exemptions`, session.token)).status, 200);

    // 3. The database stops accepting connections and the open ones are cut
    await admin(`ALTER DATABASE ${DB} ALLOW_CONNECTIONS false`);
    await admin(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}'`);
    const during = await until('the API to notice the outage', async () => {
      const h = await get(`${ROOT}/health`);
      return h.body?.database === 'down' ? h : null;
    }, 30000);
    expect('outage: /health database', during.body.database, 'down');
    expect('outage: /health still reports the commit', typeof during.body.commit === 'string', true);
    const midOutage = await get(`${API}/exemptions`, session.token);
    expect('outage: data route answers 503 with a signed-in token', [midOutage.status, midOutage.body?.error?.code], [503, 'SERVICE_UNAVAILABLE']);
    expect('outage: no crash', (await sleep(6000), exitCode), null);

    // 4. The database is back
    await admin(`ALTER DATABASE ${DB} ALLOW_CONNECTIONS true`);
    const back = await until('the API to recover after the outage', async () => ((await get(`${ROOT}/health`)).body?.database === 'ok' ? true : null), 40000);
    expect('after the outage: database ok again', back, true);
    expect('after the outage: the earlier sign-in still works', (await get(`${API}/exemptions`, session.token)).status, 200);
    expect('after the outage: never restarted', exitCode, null);
  } finally {
    child?.kill();
    await sleep(500);
    await admin(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch((e) => console.error('cleanup:', e.message));
  }
});

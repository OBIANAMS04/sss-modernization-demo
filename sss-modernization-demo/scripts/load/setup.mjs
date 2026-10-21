// Creates the synthetic @example.com accounts a load run needs, through the API (never the database), and the cases staff work on.
// Local runs only get the staff, assistant and seeded-case pools; the live run (setupLive) registers ONE citizen and nothing else.
import { createRequire } from 'node:module';

const LIMIT = 4; // registrations in flight at once during setup; bcrypt work, so more only queues

async function pmap(items, fn, limit = LIMIT) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

/** @param {{base:string, runId:string, managers:number, citizens:number, assistants:number, seedCases:number}} o */
export async function setupLocal(o) {
  process.env.E2E_BASE = o.base;
  const lib = await import('../e2e/lib.mjs');
  const say = (m) => console.log(`[setup] ${m}`);
  const t0 = Date.now();

  say(`${o.managers} case managers, 1 administrator, 1 leadership user`);
  const managers = [];
  managers.push(await lib.staffAccount(lib.MANAGER, 'Load Manager'));
  for (let i = 1; i < o.managers; i++) managers.push(await lib.staffAccount(`load-mgr-${o.runId}-${i}@example.com`, `Load Manager ${i}`));
  const admin = await lib.adminAccount('morgan.lee@example.com', 'Morgan Lee');
  const leadership = await lib.leadershipAccount(`load-lead-${o.runId}@example.com`, `Load Leadership ${o.runId}`);

  say(`${o.citizens} citizens (the first ${o.seedCases} also apply, so staff have cases to open)`);
  const citizens = await pmap(Array.from({ length: o.citizens }), (_, i) => lib.account(`load-cit-${o.runId}-${i}@example.com`, `Load Citizen ${i}`));
  const seedCases = (
    await pmap(citizens.slice(0, o.seedCases), async (c) => {
      await lib.call('POST', '/exemptions/check', c.token);
      const exemptionId = await lib.exemptionId(c.token, 'Type A');
      const applied = await lib.call('POST', '/cases', c.token, { exemptionId });
      return applied.status === 201 ? applied.data.id : null;
    })
  ).filter(Boolean);

  say(`${o.assistants} assistant users`);
  const assistant = await pmap(Array.from({ length: o.assistants }), (_, i) => lib.account(`load-ai-${o.runId}-${i}@example.com`, `Load Assistant ${i}`));

  say(`done in ${Math.round((Date.now() - t0) / 1000)} s`);
  const pick = (s) => ({ token: s.token, id: s.user.id, email: s.user.email });
  return {
    managers: managers.map(pick),
    admin: pick(admin),
    leadership: pick(leadership),
    citizens: citizens.map(pick),
    assistant: assistant.map(pick),
    seedCases,
  };
}

/** The live run registers one citizen. Staff accounts and writes beyond that are never created on the live demo. */
export async function setupLive({ base, runId }) {
  process.env.E2E_BASE = base;
  const lib = await import('../e2e/lib.mjs'); // refuses a non-local host unless E2E_ALLOW_REMOTE=1
  const email = `load-live-${runId}@example.com`;
  const session = await lib.account(email, 'Load Live Citizen');
  return { token: session.token, userId: session.user.id, email };
}

/** Local only: gives the assistant users their hourly allowance back between steps (the e2e suite does the same to its own rows). */
export async function resetAssistantRows(dbName, userIds) {
  const { Client } = createRequire(new URL('../../backend/package.json', import.meta.url))('pg');
  const db = new Client({ host: 'localhost', database: dbName, user: 'admin', password: process.env.PGPASSWORD || 'dev_password' });
  await db.connect();
  try {
    await db.query('DELETE FROM assistant_interactions WHERE user_id = ANY($1::uuid[])', [userIds]);
  } finally {
    await db.end();
  }
}

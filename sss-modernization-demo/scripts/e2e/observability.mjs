// STORY-026 to 029 (backend): trace ids on every response and audit entry, per-route per-minute metrics, a forced server error with its trace
// id, AI usage and cost, an objective breach that opens an alert (once) and closes it on recovery, and the access rules (local backend only;
// see lib.mjs). The backend must run with AI_PROVIDER=stub (no key, no call to any model), ADMIN_EMAILS listing morgan.lee@example.com, and the
// same DATABASE_NAME as this script when its database is not sss_demo:
//   cd backend && AI_PROVIDER=stub ADMIN_EMAILS=morgan.lee@example.com \
//     CASE_MANAGER_EMAILS="manager-local-test@example.com,reviewer-local-test@example.com" npm start
//   DATABASE_NAME=<the backend's database> node scripts/e2e/observability.mjs
//
// The server error is made with GET /audit?actor=not-a-uuid, which today answers 500 (a malformed id reaches PostgreSQL as a uuid, which refuses
// it). If that route is ever fixed to answer 400, this suite says so and needs another route that fails.
// The objective breaches are made with synthetic rows in route_metrics_minute (a route that does not exist, 30 minutes back) and a fixture
// assistant answer, all removed at the end, so they do not depend on how much real traffic the backend has had.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { account, adminAccount, BASE, call, expect, leadershipAccount, MANAGER, run, stamp, staffAccount } from './lib.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FIXTURE = `e2e-observability-${stamp}`;
const SYNTHETIC_FAILING = 'GET /e2e-synthetic/failing';
const SYNTHETIC_SLOW = 'GET /e2e-synthetic/slow';
const STARTED = new Date(Date.now() - 1000);

const TRACE = /^[0-9a-f]{32}$/;
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

run(async () => {
  const db = new Client({ host: 'localhost', database: process.env.DATABASE_NAME || 'sss_demo', user: 'admin', password: 'dev_password' });
  await db.connect();
  const users = [];
  try {
    await checks(db, users);
  } finally {
    await db.query('DELETE FROM route_metrics_minute WHERE route = ANY($1::text[])', [[SYNTHETIC_FAILING, SYNTHETIC_SLOW]]);
    await db.query('DELETE FROM assistant_interactions WHERE question_redacted = $1', [FIXTURE]);
    if (users.length) await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await db.end();
  }
});

/** The headers of a response, checked and returned: { trace, traceparent }. */
function ids(response) {
  return { trace: response.headers.get('x-request-id'), traceparent: response.headers.get('traceparent') };
}

async function checks(db, users) {
  const manager = await staffAccount(MANAGER, 'Manager Test');
  const admin = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
  const leadership = await leadershipAccount(`leader-obs-${stamp}@example.com`, 'Leader Obs');
  const citizen = await account(`citizen-obs-${stamp}@example.com`, 'Citizen Obs');
  users.push(leadership.user.id, citizen.user.id);
  // A run starts clean: an hour's limit on runs, and alerts from an earlier pass would hide the opening of new ones
  await db.query('DELETE FROM assistant_eval_runs');
  await db.query(`UPDATE assistant_quality_alerts SET cleared_at = NOW() WHERE kind = 'slo' AND cleared_at IS NULL`);

  const view = async () => (await call('GET', '/observability', admin.token)).data;
  const evaluate = async () => (await call('POST', '/observability/evaluate', admin.token)).data;
  let since = STARTED;
  const sloAudit = async (phase) =>
    (await call('GET', `/audit?${new URLSearchParams({ limit: 100, action: 'SLO_ALERT' })}`, admin.token)).data.logs.filter(
      (l) => new Date(l.timestamp) >= since && l.details?.phase === phase
    );

  // ---- 026: every response carries its trace id

  const health = await call('GET', '/../health', null);
  const refusal = await call('GET', '/cases', null);
  const withId = await call('GET', '/exemptions', citizen.token);
  for (const [label, r] of [['health', health], ['a 401 refusal', refusal], ['a normal answer', withId]]) {
    const { trace, traceparent } = ids(r);
    expect(`${label}: X-Request-Id is a 32-character trace id`, TRACE.test(trace ?? ''), true);
    expect(`${label}: traceparent is a W3C trace context with the same trace id`, TRACEPARENT.test(traceparent ?? '') && traceparent.split('-')[1] === trace, true);
  }
  expect('two requests have different trace ids', ids(health).trace !== ids(withId).trace, true);

  // A trace that arrives with the request is continued, so a caller (or a gateway) can follow its request through
  const incoming = '4bf92f3577b34da6a3ce929d0e0e4736';
  const continued = await fetch(`${BASE}/exemptions`, { headers: { Authorization: `Bearer ${citizen.token}`, traceparent: `00-${incoming}-00f067aa0ba902b7-01` } });
  expect('an incoming traceparent is continued: the response carries the same trace id', continued.headers.get('x-request-id'), incoming);

  // An audit entry records the trace id of the request that caused it
  const evaluated = await call('POST', '/observability/evaluate', admin.token);
  const traceOfEvaluate = ids(evaluated).trace;
  await sleep(500); // the audit entry is written without holding up the response
  const entries = (await call('GET', `/audit?${new URLSearchParams({ limit: 100, action: 'ADMIN_ACTION' })}`, admin.token)).data.logs;
  expect('an audit entry records the trace id of its request', entries.some((l) => l.traceId === traceOfEvaluate && l.details?.action === 'evaluate-objectives'), true);

  // ---- 027: the rollup appears after traffic, by route template

  const caseIds = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of caseIds) await call('GET', `/cases/${id}`, manager.token);
  for (let i = 0; i < 5; i++) await call('GET', '/exemptions', citizen.token);
  await evaluate(); // writes the minute in progress
  const rows = (await db.query(
    `SELECT route, SUM(requests)::int AS requests, SUM(errors_4xx)::int AS e4, SUM(errors_5xx)::int AS e5, MAX(p50_ms) AS p50, MAX(p95_ms) AS p95, MAX(p99_ms) AS p99
     FROM route_metrics_minute WHERE minute >= NOW() - INTERVAL '5 minutes' GROUP BY route`
  )).rows;
  const byRoute = Object.fromEntries(rows.map((r) => [r.route, r]));
  expect('three reads of different cases are one route template with 3 requests', byRoute['GET /api/cases/:id']?.requests >= 3, true);
  expect('the 404s of a missing case are counted as 4xx, apart from 5xx', byRoute['GET /api/cases/:id']?.e4 >= 3 && byRoute['GET /api/cases/:id']?.e5 === 0, true);
  expect('the rollup has p50, p95 and p99 durations', ['p50', 'p95', 'p99'].every((k) => typeof byRoute['GET /api/exemptions']?.[k] === 'number'), true);
  const labels = (await db.query(`SELECT COUNT(*)::int AS n FROM route_metrics_minute WHERE route ~* '[0-9a-f]{8}-[0-9a-f]{4}' OR route LIKE '%@%' OR route LIKE '%?%'`)).rows[0].n;
  expect('no route label holds a record id, an email address or a query string', labels, 0);

  const page = await view();
  expect('the page lists latency by route, including the template', page.latency.routes.some((r) => r.route === 'GET /api/cases/:id' && r.requests >= 3 && r.p95Ms !== null), true);
  expect('the page has request and error rates over 24 hours and 7 days', [page.traffic.last24h.requests > 0, page.traffic.last7d.requests >= page.traffic.last24h.requests, page.traffic.hourly.length, page.traffic.daily.length], [true, true, 24, 7]);
  expect('the page has the 2-second p95 target', page.latency.targetMs, 2000);
  expect('the page has health: database, migrations, commit and uptime since the start', [page.health.database.ok, page.health.migrations.applied >= 25, typeof page.health.commit, page.health.uptimeSeconds >= 0, typeof page.health.startedAt], [true, true, 'string', true, 'string']);
  expect('database query time and pool use are recorded', page.database.last24h.queries > 0 && page.database.last24h.poolInUseMax > 0, true);

  // ---- 026 and 027: a forced server error shows with its trace id

  const failed = await call('GET', '/audit?actor=not-a-uuid', admin.token);
  expect('a malformed id is a server error today (the route used to force one)', failed.status, 500);
  const failedTrace = ids(failed).trace;
  let seen;
  for (let i = 0; i < 20 && !seen; i++) {
    await sleep(250);
    seen = (await view()).recentErrors.find((e) => e.traceId === failedTrace);
  }
  expect('the server error shows in recent errors with its trace id and route template', seen && [seen.route, seen.status], ['GET /api/audit', 500]);
  expect('the error record holds the class and code of the error, never its message', seen && [typeof seen.errorName, seen.errorCode], ['string', '22P02']);
  const errorsLeak = (await db.query(`SELECT COUNT(*)::int AS n FROM server_errors WHERE route ~* '[0-9a-f]{8}-[0-9a-f]{4}' OR route LIKE '%@%' OR route LIKE '%not-a-uuid%'`)).rows[0].n;
  expect('no server error record holds the value that was sent', errorsLeak, 0);

  // ---- 027: AI usage on every call, and on a run

  const asked = await call('POST', '/assistant/ask', citizen.token, { question: 'How old must a registrant be to qualify for Type A?' });
  expect('the assistant answers through the stand-in', asked.status, 200);
  const interaction = (await db.query('SELECT ai_calls, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd::float AS cost FROM assistant_interactions WHERE trace_id = $1', [asked.data.traceId])).rows[0];
  expect('the exchange keeps its call, token counts and cost', [interaction.ai_calls, interaction.input_tokens > 0, interaction.output_tokens > 0, interaction.cost > 0], [1, true, true, true]);
  const started = await call('POST', '/ai-quality/evaluations', admin.token);
  expect('an administrator starts an evaluation run', started.status, 202);
  let runRow;
  for (let i = 0; i < 120; i++) {
    runRow = (await db.query('SELECT status, ai_calls, input_tokens, output_tokens, cost_usd::float AS cost FROM assistant_eval_runs WHERE id = $1', [started.data.run.id])).rows[0];
    if (runRow && runRow.status !== 'running') break;
    await sleep(500);
  }
  expect('the run adds up the calls, tokens and cost of every question it asked', [runRow.status, runRow.ai_calls > 1, runRow.input_tokens > 0, runRow.cost > 0], ['completed', true, true, true]);
  const today = (await view()).ai;
  expect('the page has AI calls, tokens and cost per day against the budget', [today.days.length, today.today.calls > 1, today.today.costUsd > 0, today.budgetUsd], [7, true, true, 2]);

  // ---- 029: a breach opens an alert once, notifies the administrators, and closes on recovery

  // The forced server error above is real traffic too, so an alert for it may already be open (a failure among a few dozen requests is over 0.5%);
  // only the alerts the synthetic rows add are expected to open and close
  await evaluate();
  const alreadyOpen = new Set((await view()).alerts.open.filter((a) => a.kind === 'slo').map((a) => a.key));
  const before = (await call('GET', '/notifications', admin.token)).data.unread;
  since = new Date(Date.now() - 200); // only what the synthetic rows cause
  const day = "date_trunc('minute', NOW() - INTERVAL '30 minutes')";
  const hist = (bucket) => `ARRAY(SELECT CASE WHEN i = ${bucket} THEN 200000 ELSE 0 END FROM generate_series(1, 18) AS i)`;
  // 200,000 requests, 20% server errors, all fast: availability and the route's error rate breach, latency does not
  await db.query(`INSERT INTO route_metrics_minute (minute, route, requests, errors_4xx, errors_5xx, total_ms, hist) VALUES (${day}, $1, 200000, 0, 40000, 4000000, ${hist(5)})`, [SYNTHETIC_FAILING]);
  // 200,000 requests all between 2 and 3 seconds: the p95 is over the target
  await db.query(`INSERT INTO route_metrics_minute (minute, route, requests, errors_4xx, errors_5xx, total_ms, hist) VALUES (${day} - INTERVAL '1 minute', $1, 200000, 0, 0, 500000000, ${hist(15)})`, [SYNTHETIC_SLOW]);
  const first = await evaluate();
  const breached = Object.fromEntries(first.results.filter((r) => r.status === 'breach').map((r) => [`${r.id}:${r.window}`, r]));
  const SIX = ['availability:1h', 'availability:24h', 'error-rate:1h', 'error-rate:24h', 'latency:1h', 'latency:24h'];
  expect('availability, latency and the route error rate are breached over both windows', SIX.filter((k) => k in breached), SIX);
  const fresh = SIX.filter((k) => !alreadyOpen.has(k));
  expect('the breach names the route and the figures, no record or person', breached['error-rate:1h'].message.includes(SYNTHETIC_FAILING) && /20%/.test(breached['error-rate:1h'].message), true);
  expect('each breach opens an alert', first.opened.filter((k) => SIX.includes(k)).sort(), fresh);
  const open = (await view()).alerts.open.filter((a) => a.kind === 'slo' && SIX.includes(a.key));
  expect('the open alerts are on the page with their runbook entries', open.map((a) => [a.key, a.runbook]).sort(), SIX.map((k) => [k, k.split(':')[0]]));
  expect('each opened alert is an audit event', (await sloAudit('opened')).map((l) => l.details.key).filter((k) => SIX.includes(k) && !alreadyOpen.has(k)).sort(), fresh);
  const after = (await call('GET', '/notifications', admin.token)).data;
  expect('every administrator is notified, once per alert', after.unread - before, fresh.length);
  expect('the notification says what is wrong and where to look', after.notifications[0].message.startsWith('Service alert: ') && after.notifications[0].message.endsWith('Open Observability to see it.'), true);
  const second = await evaluate();
  expect('a lasting breach does not alert again (deduplicated)', [second.opened, (await call('GET', '/notifications', admin.token)).data.unread - before], [[], fresh.length]);

  await db.query('DELETE FROM route_metrics_minute WHERE route = ANY($1::text[])', [[SYNTHETIC_FAILING, SYNTHETIC_SLOW]]);
  const recovered = await evaluate();
  expect('the alerts close when the objectives recover', [recovered.cleared.filter((k) => SIX.includes(k)).sort(), recovered.results.filter((r) => r.status === 'breach' && !alreadyOpen.has(`${r.id}:${r.window}`)).length], [fresh, 0]);
  const history = (await view()).alerts;
  expect('the closed alerts are in the history, none of them open', [history.open.filter((a) => a.kind === 'slo' && fresh.includes(a.key)).length, fresh.every((k) => history.history.some((a) => a.key === k)), history.history.every((a) => a.clearedAt)], [0, true, true]);
  expect('each close is an audit event', (await sloAudit('cleared')).map((l) => l.details.key).filter((k) => SIX.includes(k)).sort(), fresh);

  // AI spend: a fixture answer that cost $50 breaches the daily budget, and removing it recovers
  await db.query(
    `INSERT INTO assistant_interactions (user_id, trace_id, question_redacted, mode, status, ai_calls, input_tokens, output_tokens, cost_usd) VALUES ($1, $2, $3, 'ai', 'shown', 1, 1, 1, 50)`,
    [manager.user.id, randomUUID(), FIXTURE]
  );
  const spend = await evaluate();
  expect('AI spend over the daily budget is breached', spend.opened.filter((k) => k.startsWith('ai-spend')).sort(), ['ai-spend:1h', 'ai-spend:24h']);
  await db.query('DELETE FROM assistant_interactions WHERE question_redacted = $1', [FIXTURE]);
  expect('and recovers when the spend is gone', (await evaluate()).cleared.filter((k) => k.startsWith('ai-spend')).sort(), ['ai-spend:1h', 'ai-spend:24h']);

  // ---- Access: administrators only
  const refused = async (label, who, status) => {
    const token = who?.token ?? null;
    const get = await call('GET', '/observability', token);
    const post = await call('POST', '/observability/evaluate', token);
    expect(`${label} is refused the page and the evaluation`, [get.status, post.status], [status, status]);
  };
  await refused('no sign-in', null, 401);
  await refused('a citizen', citizen, 403);
  await refused('a case manager', manager, 403);
  await refused('a leadership user', leadership, 403);
  expect('an administrator is allowed', (await call('GET', '/observability', admin.token)).status, 200);
  const denied = (await call('GET', `/audit?${new URLSearchParams({ limit: 100, action: 'ACCESS_DENIED' })}`, admin.token)).data.logs.filter(
    (l) => new Date(l.timestamp) >= STARTED && l.details?.path === '/api/observability'
  );
  expect('the refusals are audited security events with their trace ids', denied.length >= 4 && denied.every((l) => TRACE.test(l.traceId ?? '')), true);
}

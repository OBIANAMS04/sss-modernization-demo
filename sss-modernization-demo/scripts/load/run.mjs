// STORY-030 load harness (autocannon 8.0.0, pinned in package.json). Journeys: registrant, case-manager, assistant (stub only),
// dashboards, or all four at once (mixed). Profiles: ramp (steps of rising concurrency), hold, spike.
//
//   cd scripts/load && npm ci
//   LOCAL (the harness starts the compiled backend itself, with a sampler for CPU / event-loop delay / DB pool):
//     node run.mjs --spawn-db sss_load_a --port 3002 --profile ramp --steps 5,10,20,40,80,160 --step-seconds 20 --label before
//   LIVE (light, read-mostly, one synthetic account, no AI; needs E2E_ALLOW_REMOTE=1):
//     E2E_ALLOW_REMOTE=1 node run.mjs --live --base https://sss-demo-backend.onrender.com/api --connections 25 --duration 60 --label live
//
// Results go to ../../docs/evidence/r3-load/<label>.json; node report.mjs <label> ... writes a Markdown and HTML report.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import autocannon from 'autocannon';
import { SCENARIOS, liveReadMostly } from './journeys.mjs';
import { setupLocal, setupLive, resetAssistantRows } from './setup.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, '../../backend');
const OUT_DIR = resolve(here, '../../docs/evidence/r3-load');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, [])
);
if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('\n').slice(0, 12).join('\n'));
  process.exit(0);
}
const num = (k, d) => (args[k] === undefined ? d : Number(args[k]));
const live = !!args.live;
const profile = args.profile || (live ? 'hold' : 'ramp');
const scenarioName = args.scenario || (live ? 'live' : 'mixed');
const label = args.label || `${profile}-${scenarioName}`;
const port = num('port', 3002);
const base = args.base || `http://localhost:${port}/api`;
const stepSeconds = num('step-seconds', 20);
const steps = String(args.steps || '5,10,20,40,80,160').split(',').map(Number);
const runId = Date.now().toString(36);
const apiPrefix = new URL(base).pathname.replace(/\/$/, '');
const origin = new URL(base).origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pct(sorted, p) {
  if (!sorted.length) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 10) / 10;
}

/** One autocannon run of one journey; resolves with per-route samples. */
function runJourney(name, requests, connections, seconds, sink) {
  const reqs = requests.map((r) => {
    const original = r.setupRequest;
    return { ...r, setupRequest: (req, ctx) => { const out = original(req, ctx); if (out) out.path = apiPrefix + out.path; return out; } };
  });
  return new Promise((resolveRun, reject) => {
    const instance = autocannon(
      { url: origin + apiPrefix, connections, duration: seconds, timeout: 30, pipelining: 1, requests: reqs, forever: false },
      (err, result) => (err ? reject(err) : resolveRun(result))
    );
    instance.on('response', (client, status, bytes, ms) => {
      const current = client.requestIterator?.currentRequest;
      const route = current?.label || `${name} (unlabelled)`;
      const bucket = (sink.routes[route] ??= { ms: [], status: {}, ok: new Set(current?.ok || []), limited: new Set(current?.limited || []) });
      bucket.ms.push(ms);
      bucket.status[status] = (bucket.status[status] || 0) + 1;
    });
  });
}

function summarise(sink, seconds, connectionErrors) {
  const routes = {};
  let all = [];
  let requests = 0, errors = 0, limited = 0;
  for (const [route, b] of Object.entries(sink.routes)) {
    const sorted = b.ms.slice().sort((x, y) => x - y);
    let e = 0, l = 0;
    for (const [s, n] of Object.entries(b.status)) {
      if (b.limited.has(Number(s))) l += n;
      else if (!b.ok.has(Number(s))) e += n;
    }
    routes[route] = { count: sorted.length, rps: Math.round((sorted.length / seconds) * 10) / 10, p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99), max: sorted.at(-1), errors: e, rateLimited: l, statuses: b.status };
    all = all.concat(sorted);
    requests += sorted.length; errors += e; limited += l;
  }
  all.sort((x, y) => x - y);
  errors += connectionErrors;
  return {
    requests, rps: Math.round((requests / seconds) * 10) / 10, errors, connectionErrors, rateLimited: limited,
    errorRate: requests ? Math.round((errors / (requests + connectionErrors)) * 10000) / 100 : 0,
    p50: pct(all, 50), p95: pct(all, 95), p99: pct(all, 99), routes,
  };
}

function serverStats(file, fromT, toT) {
  if (!file || !existsSync(file)) return null;
  const rows = readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.t >= fromT && r.t <= toT);
  if (!rows.length) return null;
  const avg = (k) => Math.round((rows.reduce((s, r) => s + r[k], 0) / rows.length) * 10) / 10;
  const max = (k) => Math.max(...rows.map((r) => r[k]));
  const pools = rows.map((r) => r.pool).filter(Boolean);
  return {
    samples: rows.length, cpuAvgPct: avg('cpuPct'), cpuMaxPct: max('cpuPct'), loopMeanMsAvg: avg('loopMeanMs'), loopP99MsMax: max('loopP99Ms'), loopMaxMs: max('loopMaxMs'), rssMaxMb: max('rssMb'),
    poolMax: pools[0]?.max ?? null, poolTotalMax: pools.length ? Math.max(...pools.map((p) => p.total)) : null, poolWaitingMax: pools.length ? Math.max(...pools.map((p) => p.waiting)) : null,
  };
}

/** Runs the chosen journeys for `seconds` at `connections` total, split by weight (mixed) or on one journey. */
async function phase(connections, seconds, shared, samplerFile, tag) {
  if (!live && args['spawn-db']) await resetAssistantRows(args['spawn-db'], shared.pools.assistant.map((a) => a.id));
  const sink = { routes: {} };
  const names = live ? ['live'] : scenarioName === 'mixed' ? Object.keys(SCENARIOS) : [scenarioName];
  const weights = names.map((n) => (live ? 1 : SCENARIOS[n].weight));
  const total = weights.reduce((a, b) => a + b, 0);
  const split = names.map((n, i) => Math.max(1, Math.round((connections * weights[i]) / total)));
  const startedAt = Date.now();
  const results = await Promise.all(
    names.map((n, i) => runJourney(n, live ? liveReadMostly(shared) : SCENARIOS[n].build(shared, runId + tag), split[i], seconds, sink))
  );
  const endedAt = Date.now();
  const connectionErrors = results.reduce((s, r) => s + r.errors + r.timeouts, 0);
  return {
    tag, connections: split.reduce((a, b) => a + b, 0), split: Object.fromEntries(names.map((n, i) => [n, split[i]])), seconds,
    ...summarise(sink, seconds, connectionErrors), server: serverStats(samplerFile, startedAt, endedAt),
  };
}

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(1000);
  }
  throw new Error(`${url} did not answer within ${ms / 1000} s`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let child = null;
  const samplerFile = !live && args['spawn-db'] ? resolve(OUT_DIR, `${label}.samples.jsonl`) : null;
  if (!live && args['spawn-db']) {
    if (samplerFile && existsSync(samplerFile)) rmSync(samplerFile);
    const env = {
      ...process.env, DATABASE_NAME: args['spawn-db'], PORT: String(port), CORS_ORIGIN: 'http://localhost:4173', AI_PROVIDER: 'stub', AI_DAILY_LIMIT: '100000000',
      ADMIN_EMAILS: 'morgan.lee@example.com', CASE_MANAGER_EMAILS: 'manager-local-test@example.com,reviewer-local-test@example.com',
      SAMPLER_OUT: samplerFile, SAMPLER_BACKEND_DIR: BACKEND, ...(args['pool-max'] ? { DATABASE_POOL_MAX: String(args['pool-max']) } : {}),
    };
    child = spawn(process.execPath, ['-r', resolve(here, 'sampler.cjs'), 'dist/index.js'], { cwd: BACKEND, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    await waitFor(`${origin}/health`, 90000);
    console.log(`[run] backend started, pid ${child.pid}`);
  }
  const health = await waitFor(`${origin}/health`, live ? 120000 : 10000);
  console.log(`[run] ${origin} commit ${health.commit} database ${health.database}`);

  const meta = {
    label, profile, scenario: scenarioName, target: live ? origin : 'local', startedAt: new Date().toISOString(), commit: health.commit, autocannon: '8.0.0', node: process.version,
    machine: { cpus: os.cpus().length, model: os.cpus()[0]?.model, totalMemGb: Math.round(os.totalmem() / 2 ** 30) },
    note: args.note || null, poolMax: args['pool-max'] ? Number(args['pool-max']) : null,
  };
  const shared = { submittedCases: [], pools: null };
  const phases = [];
  let liveLogins = null;
  try {
    if (live) {
      if (num('connections', 25) > 25 || num('duration', 60) > 60) throw new Error('live runs are capped at 25 connections for 60 s');
      shared.pools = { live: await setupLive({ base, runId }) };
      // A few sign-ins of the one synthetic account, one at a time (each costs real CPU on the 0.1 CPU instance)
      liveLogins = [];
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: shared.pools.live.email, password: 'Str0ng!Passw0rd' }) });
        liveLogins.push({ status: r.status, ms: Math.round(performance.now() - t) });
        await sleep(2000);
      }
      phases.push(await phase(num('connections', 25), num('duration', 60), shared, null, 'live'));
    } else {
      shared.pools = await setupLocal({ base, runId, managers: num('managers', 6), citizens: num('citizens', 40), assistants: num('assistants', 200), seedCases: num('seed-cases', 30) });
      if (profile === 'ramp') {
        for (const c of steps) {
          console.log(`[run] ramp step: ${c} connections for ${stepSeconds} s`);
          const p = await phase(c, stepSeconds, shared, samplerFile, `c${c}`);
          console.log(`        ${p.rps} req/s, p95 ${p.p95} ms, errors ${p.errorRate}%, cpu ${p.server?.cpuAvgPct}%`);
          phases.push(p);
          await sleep(3000);
        }
      } else if (profile === 'hold') {
        phases.push(await phase(num('connections', 40), num('duration', 60), shared, samplerFile, `hold-c${num('connections', 40)}`));
      } else if (profile === 'spike') {
        const [low, high] = [num('low', 10), num('high', 120)];
        for (const [tag, c, s] of [['baseline', low, 15], ['spike', high, 20], ['recovery', low, 15]]) {
          console.log(`[run] spike phase ${tag}: ${c} connections for ${s} s`);
          phases.push(await phase(c, s, shared, samplerFile, tag));
        }
      } else throw new Error(`unknown profile ${profile}`);
    }
  } finally {
    if (child) {
      child.kill();
    }
  }
  // Breaking point: the first ramp step whose overall p95 passes 2 s or whose errors pass 1%
  const breaking = profile === 'ramp' ? phases.find((p) => p.p95 > 2000 || p.errorRate > 1) || null : null;
  const worstRoute = (p) => Object.entries(p.routes).filter(([, r]) => r.count >= 20).sort((a, b) => b[1].p95 - a[1].p95)[0];
  const result = { meta, liveLogins, phases, breaking: breaking && { connections: breaking.connections, p95: breaking.p95, errorRate: breaking.errorRate, worstRoute: worstRoute(breaking)?.[0], server: breaking.server } };
  writeFileSync(resolve(OUT_DIR, `${label}.json`), JSON.stringify(result, null, 2));
  console.log(`[run] wrote docs/evidence/r3-load/${label}.json${result.breaking ? `; breaking point at ${result.breaking.connections} connections` : ''}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR', e.stack || e);
  process.exit(1);
});

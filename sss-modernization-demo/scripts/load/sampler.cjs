// Preloaded into the LOCAL backend (node -r ./sampler.cjs dist/index.js) so a load run can see what saturates: process CPU, event-loop
// delay, memory and the database pool, once a second, appended to SAMPLER_OUT as JSON lines. It changes nothing in the backend.
const { monitorEventLoopDelay } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');
const out = process.env.SAMPLER_OUT;
if (out) {
  // Count every pg Pool the app creates, so the sampler can read it without touching application code
  const pg = require(path.resolve(process.env.SAMPLER_BACKEND_DIR || process.cwd(), 'node_modules/pg'));
  const Original = pg.Pool;
  pg.Pool = class extends Original {
    constructor(...args) {
      super(...args);
      (globalThis.__samplerPools ||= []).push(this);
    }
  };
  // SAMPLER_QUERIES=<file>: which statements run, how often and for how long (the first 90 characters of the text, no parameters, so no personal data)
  if (process.env.SAMPLER_QUERIES) {
    const stats = new Map();
    const wrap = (proto) => {
      const original = proto.query;
      proto.query = function (...args) {
        const text = typeof args[0] === 'string' ? args[0] : args[0] && args[0].text;
        const started = process.hrtime.bigint();
        const key = text ? text.split(/[ \t\r\n]+/).join(' ').trim().slice(0, 90) : null;
        const done = () => {
          if (!key) return;
          const entry = stats.get(key) || { n: 0, ms: 0 };
          entry.n++;
          entry.ms += Number(process.hrtime.bigint() - started) / 1e6;
          stats.set(key, entry);
        };
        // pg's Pool.query() passes a callback to the client; transactions use promises. Time both.
        const last = args.length - 1;
        if (typeof args[last] === 'function') {
          const cb = args[last];
          args[last] = function (...a) { done(); return cb.apply(this, a); };
          return original.apply(this, args);
        }
        const result = original.apply(this, args);
        if (result && typeof result.then === 'function') result.then(done, done);
        return result;
      };
    };
    wrap(pg.Client.prototype);
    setInterval(() => fs.writeFileSync(process.env.SAMPLER_QUERIES, JSON.stringify([...stats].map(([q, e]) => ({ q, n: e.n, totalMs: Math.round(e.ms), avgMs: Math.round((e.ms / e.n) * 10) / 10 })).sort((a, b) => b.totalMs - a.totalMs), null, 1)), 3000).unref();
  }

  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  let last = process.cpuUsage();
  let lastAt = process.hrtime.bigint();
  setInterval(() => {
    const now = process.hrtime.bigint();
    const cpu = process.cpuUsage(last);
    const wallMicros = Number(now - lastAt) / 1000;
    const pool = (globalThis.__samplerPools || [])[0];
    const line = {
      t: Date.now(),
      cpuPct: Math.round(((cpu.user + cpu.system) / wallMicros) * 1000) / 10,
      loopMeanMs: Math.round(histogram.mean / 1e4) / 100,
      loopP99Ms: Math.round(histogram.percentile(99) / 1e4) / 100,
      loopMaxMs: Math.round(histogram.max / 1e4) / 100,
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      pool: pool ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options.max } : null,
    };
    fs.appendFileSync(out, JSON.stringify(line) + '\n');
    histogram.reset();
    last = process.cpuUsage();
    lastAt = now;
  }, 1000).unref();
}

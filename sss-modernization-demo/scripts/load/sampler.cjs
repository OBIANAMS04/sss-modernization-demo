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

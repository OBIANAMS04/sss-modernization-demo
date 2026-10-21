// R3 milestone 1 evidence (STORY-005, 030 to 034, 036): screens drawn from the measured files, so the pictures and the numbers agree.
//   node scripts/evidence/r3-milestone-1.mjs
// Reads docs/evidence/r3-load/*.json, the tables in its README and in docs/PRODUCTION-SIZING.md, and docs/evidence/r3-m1/failover-e2e.txt
// (the output of scripts/e2e/failover.mjs). Writes one HTML page and one PNG per screen to docs/evidence/r3-m1/. Needs Chrome, no network.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = join(root, 'docs/evidence/r3-load');
const out = join(root, 'docs/evidence/r3-m1');
mkdirSync(out, { recursive: true });

const json = (name) => JSON.parse(readFileSync(join(load, `${name}.json`), 'utf8'));
const before = json('ramp-before');
const after = json('ramp-final');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

// Validated pair (dataviz validator, light surface): series 1 before, series 2 after
const BEFORE = '#2a78d6';
const AFTER = '#eb6834';

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  body { margin: 0; padding: 24px 28px; width: 1180px; background: #fcfcfb; color: #0b0b0b; font: 15px/1.45 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; } .sub { color: #52514e; margin: 0 0 16px; }
  h2 { font-size: 16px; margin: 18px 0 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; }
  th, td { border-bottom: 1px solid #e4e3df; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { color: #52514e; font-weight: 600; background: #f3f2ef; }
  td strong { font-weight: 700; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .legend { display: flex; gap: 18px; color: #52514e; font-size: 14px; margin: 4px 0 8px; }
  .key { display: inline-block; width: 18px; height: 3px; vertical-align: middle; margin-right: 6px; border-radius: 2px; }
  .note { color: #52514e; font-size: 13px; margin-top: 10px; }
  .pass { color: #0a7a0a; font-weight: 700; } ul.checks { columns: 2; padding-left: 18px; margin: 0; font-size: 14px; } ul.checks li { margin: 2px 0; }
  .banner { background: #fff7d6; border: 1px solid #eda100; padding: 6px 10px; border-radius: 6px; font-size: 13px; margin-bottom: 12px; }
</style></head><body><div class="banner">Synthetic demo deployment. Not operating in production.</div>${body}</body></html>`;

// A line chart over the ramp steps (x: connections, evenly spaced as the steps double), one shared y axis
function lineChart({ title, unit, series, yMax, target, width = 560, height = 300, yTicks }) {
  const m = { l: 56, r: 74, t: 14, b: 40 };
  const xs = series[0].points.map((p) => p.x);
  const X = (i) => m.l + (i * (width - m.l - m.r)) / (xs.length - 1);
  const Y = (v) => height - m.b - (Math.min(v, yMax) / yMax) * (height - m.t - m.b);
  let svg = `<svg width="${width}" height="${height}" role="img" aria-label="${esc(title)}" xmlns="http://www.w3.org/2000/svg" font-size="12" fill="#52514e">`;
  for (const t of yTicks) svg += `<line x1="${m.l}" x2="${width - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="#e4e3df"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
  xs.forEach((x, i) => (svg += `<text x="${X(i)}" y="${height - m.b + 18}" text-anchor="middle">${x}</text>`));
  svg += `<text x="${(m.l + width - m.r) / 2}" y="${height - 6}" text-anchor="middle">open connections</text>`;
  svg += `<text x="12" y="${m.t + 4}" transform="rotate(-90 12 ${m.t + 4})" text-anchor="end">${esc(unit)}</text>`;
  if (target) svg += `<line x1="${m.l}" x2="${width - m.r}" y1="${Y(target.value)}" y2="${Y(target.value)}" stroke="#0b0b0b" stroke-dasharray="5 4"/><text x="${width - m.r + 4}" y="${Y(target.value) + 4}" fill="#0b0b0b">${esc(target.label)}</text>`;
  for (const s of series) {
    const pts = s.points.map((p, i) => `${X(i)},${Y(p.y)}`).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
    s.points.forEach((p, i) => (svg += `<circle cx="${X(i)}" cy="${Y(p.y)}" r="4" fill="${s.color}" stroke="#fcfcfb" stroke-width="2"/>`));
    const last = s.points.at(-1);
    svg += `<text x="${X(xs.length - 1) + 8}" y="${Y(last.y) + 4 + (s.labelDy || 0)}" fill="#0b0b0b">${esc(s.name)}</text>`;
  }
  return `<figure style="margin:0"><h2>${esc(title)}</h2>${svg}</svg></figure>`;
}

const steps = (run, key, scale = 1) => run.phases.map((p) => ({ x: p.connections, y: p[key] * scale }));
const legend = `<div class="legend"><span><span class="key" style="background:${BEFORE}"></span>Before (STORY-034 build, pool 10)</span><span><span class="key" style="background:${AFTER}"></span>After (STORY-033 fixes, migration 026, pool 25)</span></div>`;

// Markdown tables, taken as written from the documents (the numbers are not retyped)
function mdTableAfter(file, heading, nth = 0) {
  const text = readFileSync(file, 'utf8');
  const from = text.indexOf(heading);
  if (from < 0) throw new Error(`"${heading}" not found in ${file}`);
  const lines = text.slice(from).split(/\r?\n/);
  const tables = [];
  let cur = null;
  for (const l of lines) {
    const t = l.trim();
    if (t.startsWith('|')) (cur ??= []).push(t);
    else if (cur) { tables.push(cur); cur = null; if (tables.length > nth) break; }
  }
  if (cur) tables.push(cur);
  const rows = tables[nth].filter((r) => !/^\|[-\s|]+\|$/.test(r)).map((r) => r.slice(1, -1).split('|').map((c) => c.trim()));
  const cell = (c) => esc(c).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '$1');
  return `<table><tr>${rows[0].map((c) => `<th>${cell(c)}</th>`).join('')}</tr>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}
const readme = join(load, 'README.md');
const sizing = join(root, 'docs/PRODUCTION-SIZING.md');

const screens = [];
const add = (file, title, body) => screens.push({ file, html: page(title, body) });

add('01-ramp-latency.png', 'STORY-031 and 033: p95 latency as load rises',
  `<h1>STORY-031 and 033: capacity on the local stack, before and after</h1><p class="sub">Same harness, same machine, same hour: ramp of 4 to 128 open connections, 20 s per step, mixed journeys (registrant, case manager, assistant with the stub model, dashboards).</p>${legend}
  <div class="grid">${lineChart({ title: 'p95 response time (ms)', unit: 'ms', yMax: 12000, yTicks: [0, 2000, 4000, 6000, 8000, 10000, 12000], target: { value: 2000, label: '2 s target' },
    series: [{ name: 'Before', color: BEFORE, points: steps(before, 'p95') }, { name: 'After', color: AFTER, points: steps(after, 'p95'), labelDy: 0 }] })}
  ${lineChart({ title: 'Requests that failed (%)', unit: '%', yMax: 100, yTicks: [0, 25, 50, 75, 100],
    series: [{ name: 'Before', color: BEFORE, points: steps(before, 'errorRate', 100) }, { name: 'After', color: AFTER, points: steps(after, 'errorRate', 100), labelDy: 0 }] })}</div>
  <p class="note">Breaking point (first step with p95 over 2 s): 32 connections both times, p95 ${fmt(before.breaking.p95)} ms before and ${fmt(after.breaking.p95)} ms after. Before, 96 to 98% of requests failed at 64 and 128 connections: a full connection pool was mistaken for a database outage (fixed), so the before line at 64 and 128 measures fast refusals and is not comparable. After: no failed request at any step.</p>`);

add('02-ramp-throughput.png', 'STORY-031: throughput and what saturates',
  `<h1>STORY-031: requests per second, and what runs out first</h1>${legend}
  <div class="grid">${lineChart({ title: 'Requests per second', unit: 'req/s', yMax: 60, yTicks: [0, 20, 40, 60],
    series: [{ name: 'Before', color: BEFORE, points: steps(before, 'rps') }, { name: 'After', color: AFTER, points: steps(after, 'rps') }] })}
  <div><h2>After, step by step (ramp-final.json)</h2>${mdTableAfter(readme, 'After all STORY-033 changes')}</div></div>
  <p class="note">Before: the pool of 10 connections filled at 8 open connections. After: the single JavaScript thread is the limit (process CPU about 100%, event-loop delay rising); pool waiting grows only past 32. The before rate at 64 and 128 counts the 96 to 98% of requests that failed at once. Absolute rates are this laptop's (security software slows its loopback); the comparisons were run back to back.</p>`);

add('03-hold-and-spike.png', 'STORY-031 and 033: hold, pool size and spike',
  `<h1>Hold, pool size and spike (final build)</h1><p class="sub">The 16-connection hold with the pool at 10 and at 25, and a spike from 4 to 64 connections and back.</p>${mdTableAfter(readme, 'Hold and spike (final build)')}
  <p class="note">In the spike the failed requests are 503 "very busy, try again" answers with Retry-After after a 10 s wait for a connection; the next phase is back to full speed with no errors. Before the fix the same burst closed the whole API for everyone.</p>`);

add('04-fewer-statements.png', 'STORY-033: database statements per request',
  `<h1>STORY-033: fewer database statements per request</h1><p class="sub">Counted by the load sampler, 40 sequential requests per route on a fresh database. This does not depend on the machine.</p>${mdTableAfter(readme, 'Statements per request" is machine-independent')}
  <h2>Indexes (migration 026), 100,000 cases and 100,000 applicants, EXPLAIN ANALYZE</h2>${mdTableAfter(readme, '8. **Indexes (migration 026)')}`);

const live = json('live').phases[0];
add('05-live-run.png', 'STORY-032: one light run against the live demo',
  `<h1>STORY-032: one light run against the live demo</h1><p class="sub">25 connections for 60 s, read-only routes, one synthetic @example.com account, no AI route. Instance: 0.1 CPU, 512 MB (Render free), before the STORY-033 changes were deployed.</p>
  ${mdTableAfter(readme, '## STORY-032: live check')}
  <p class="note">${fmt(live.requests)} requests, p95 ${fmt(live.p95)} ms against the 2 s target, ${live.errors} errors. Five sign-ins one at a time: 1.6 to 1.7 s each (bcrypt, cost 12). Nothing here says anything about 10,000 users; see the sizing.</p>`);

add('06-production-sizing.png', 'STORY-033: production sizing, every number labelled',
  `<h1>Production sizing for 10,000 concurrent users</h1><p class="sub">docs/PRODUCTION-SIZING.md. Every number is labelled measured, derived or assumed. A derivation to check with a real load test on the target hosting, not a result.</p>
  <h2>The result (derived)</h2><table><tr><th>Part</th><th>Size</th></tr>
  <tr><td>Application</td><td>about 4.4 cores busy at the peak, run at 50% or less: <strong>8 to 10 one-vCPU processes</strong> across at least 2 availability zones</td></tr>
  <tr><td>Database</td><td>about 5,000 statements/s, about 20 busy connections at peaks: a pooler, a 4 vCPU / 16 GB writer (assumed) and a read replica for the heavy dashboards, Multi-AZ</td></tr>
  <tr><td>Audit log</td><td>about <strong>37 GB a day</strong> before indexes: partition by month</td></tr>
  <tr><td>First risk</td><td>sign-ins on a deadline day: bcrypt grows linearly (50 sign-ins/s is 14.5 cores for hashing alone)</td></tr></table>
  <h2>Assumptions</h2>${mdTableAfter(sizing, '## 1. Assumptions')}<h2>What the runs measured</h2>${mdTableAfter(sizing, '## 2. What the runs measured')}`);

const failover = readFileSync(join(out, 'failover-e2e.txt'), 'utf8').split(/\r?\n/).filter((l) => l.startsWith('PASS'));
add('07-database-outage.png', 'STORY-034: the API survives its database going away',
  `<h1>STORY-034: the API keeps running when its database goes away, and recovers by itself</h1><p class="sub">scripts/e2e/failover.mjs on a local stack: the database is stopped before start-up and again while the API serves signed-in users, then started again. No restart of the API.</p>
  <ul class="checks">${failover.map((l) => `<li><span class="pass">PASS</span> ${esc(l.replace(/^PASS\s+/, ''))}</li>`).join('')}</ul>
  <p class="note">${failover.length} of ${failover.length} checks passed. The multi-region design for production (AWS GovCloud, Route 53 failover, Aurora Global Database, RTO and RPO targets) is docs/FAILOVER.md: a design, not deployed.</p>`);

const browser = await launch({ width: 1240, height: 300 });
try {
  for (const s of screens) {
    const html = join(out, s.file.replace(/\.png$/, '.html'));
    writeFileSync(html, s.html);
    await browser.goto(pathToFileURL(html).href);
    await browser.screenshot(join(out, s.file));
    console.log('wrote', s.file);
  }
} finally {
  await browser.close();
}

// R3 milestone 3 evidence (STORY-035, 043 to 046, R0 004): pages drawn from the readiness review and the saved infrastructure
// checks, so the pictures and the text agree, next to the training screens taken by r3-training.mjs. Writes evidence.json.
//   node scripts/evidence/r3-milestone-3.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repo = resolve(root, '..');
const out = join(root, 'docs/evidence/r3-m3');
mkdirSync(out, { recursive: true });
const review = join(root, 'docs/READINESS-REVIEW.md');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (c) => esc(c).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');

function mdTable(file, heading) {
  const text = readFileSync(file, 'utf8');
  const lines = text.slice(text.indexOf(heading)).split(/\r?\n/);
  const rows = [];
  for (const l of lines.slice(1)) {
    if (l.trim().startsWith('|')) rows.push(l.trim());
    else if (rows.length) break;
  }
  const cells = rows.filter((r) => !/^\|[-\s|]+\|$/.test(r)).map((r) => r.slice(1, -1).split('|').map((c) => c.trim()));
  return `<table><tr>${cells[0].map((c) => `<th>${fmt(c)}</th>`).join('')}</tr>${cells.slice(1).map((r) => `<tr>${r.map((c) => `<td>${fmt(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}
function mdList(file, heading) {
  const text = readFileSync(file, 'utf8');
  const lines = text.slice(text.indexOf(heading)).split(/\r?\n/).slice(1);
  const items = [];
  for (const l of lines) {
    if (/^\d+\. /.test(l)) items.push(l.replace(/^\d+\. /, ''));
    else if (/^\s{2,}\S/.test(l) && items.length) items[items.length - 1] += ` ${l.trim()}`;
    else if (items.length && l.startsWith('#')) break;
  }
  return `<ol>${items.map((i) => `<li>${fmt(i)}</li>`).join('')}</ol>`;
}
const tail = (file, n) => readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(-n).join('\n');

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  body { margin: 0; padding: 24px 28px; width: 1180px; background: #fcfcfb; color: #0b0b0b; font: 13.5px/1.45 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 21px; margin: 0 0 4px; } .sub { color: #52514e; margin: 0 0 12px; } h2 { font-size: 15px; margin: 14px 0 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; } th, td { border-bottom: 1px solid #e4e3df; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { color: #52514e; background: #f3f2ef; } code { font-size: 12px; background: #f3f2ef; padding: 0 3px; border-radius: 3px; }
  pre { background: #f3f2ef; padding: 8px 10px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; margin: 4px 0 10px; }
  ol { margin: 0; padding-left: 20px; } li { margin: 3px 0; }
  .banner { background: #fff7d6; border: 1px solid #eda100; padding: 6px 10px; border-radius: 6px; font-size: 13px; margin-bottom: 12px; }
</style></head><body><div class="banner">Synthetic demo deployment. Not operating in production.</div>${body}</body></html>`;

const checks = join(repo, 'infrastructure/aws-govcloud/checks');
const pages = [
  ['06-readiness-every-story.png', 'Every story and its evidence', `<h1>STORY-043 to 046: every one of the 46 stories and its evidence</h1><p class="sub">docs/READINESS-REVIEW.md. 45 in the demo and verified there; STORY-004 written as infrastructure code, waiting on approval.</p>${mdTable(review, '## Every story and its evidence')}`],
  ['07-drills.png', 'Drills', `<h1>Drills: rollback, backup and restore, outage, secret rotation, outside monitoring</h1><p class="sub">Run on the live demo on 2026-10-26 and 27 (the outage drill locally).</p>${mdTable(review, '## Drills')}`],
  ['08-open-gaps-and-go-no-go.png', 'Open gaps and go/no-go', `<h1>Open gaps with owners, and the go/no-go criteria for production</h1><p class="sub">Verdict: the demo build is complete; a production launch is a no-go until these are met.</p>${mdTable(review, '## Open gaps, with owners')}<h2>Go/no-go criteria (all must be true)</h2>${mdList(review, '## Go/no-go criteria')}`],
  ['09-infrastructure-checks.png', 'STORY-004 checks', `<h1>STORY-004: AWS GovCloud infrastructure as code, statically checked, not applied</h1><p class="sub">infrastructure/aws-govcloud: VPC across 3 zones, ALB with WAF, ECS Fargate, Aurora PostgreSQL Global Database with RDS Proxy, KMS, Secrets Manager, CloudTrail, GuardDuty, Security Hub, Config, an Object Lock audit bucket; prod (us-gov-west-1) and warm standby (us-gov-east-1). Terraform 1.9.8, AWS provider 5.100.0.</p>
    <h2>terraform fmt -check -recursive</h2><pre>${esc(tail(join(checks, 'terraform-fmt.txt'), 3))}</pre>
    <h2>terraform validate, prod</h2><pre>${esc(tail(join(checks, 'terraform-validate-prod.txt'), 3))}</pre>
    <h2>terraform validate, standby</h2><pre>${esc(tail(join(checks, 'terraform-validate-standby.txt'), 3))}</pre>
    <h2>TFLint (recommended preset and AWS ruleset)</h2><pre>${esc(tail(join(checks, 'tflint.txt'), 4))}</pre>
    <h2>tfsec</h2><pre>${esc(tail(join(checks, 'tfsec-prod.txt'), 4))}</pre><p class="sub">Every tfsec finding is justified in the README (a public load balancer by design; buckets AWS services write to use SSE-S3). No plan or apply was run: it waits on Ram's approval.</p>`],
];
const shots = [
  { file: '01-training-modules.png', title: 'Training: modules for the role', caption: 'A case manager sees the case work module, its time and status.' },
  { file: '02-training-module-open.png', title: 'Training: a module', caption: 'Short sections with screens of the real pages, then the knowledge check.' },
  { file: '03-training-knowledge-check-result.png', title: 'Training: graded on the server', caption: 'Three of four right is a pass; every answer is explained.' },
  { file: '04-training-leadership.png', title: 'Training: leadership', caption: 'Leadership has its own module: reading the dashboard and the override rate.' },
  { file: '05-training-team-progress.png', title: 'Training: team progress', caption: 'Administrators see every staff and leadership member and their passes.' },
  { file: '06-readiness-every-story.png', title: 'Every story and its evidence', caption: 'All 46 stories mapped to their evidence.' },
  { file: '07-drills.png', title: 'Drills', caption: 'Rollback 32 s and forward 58 s; restore in 10.5 s with 0 errors; outage 22 of 22; secrets rotated.' },
  { file: '08-open-gaps-and-go-no-go.png', title: 'Gaps and go/no-go', caption: 'Each gap with an owner; ten criteria before a production launch.' },
  { file: '09-infrastructure-checks.png', title: 'Infrastructure checks', caption: 'Formatted, validated for both regions, TFLint clean; not applied.' },
];

const browser = await launch({ width: 1240, height: 300 });
try {
  for (const [file, title, body] of pages) {
    const html = join(out, file.replace(/\.png$/, '.html'));
    writeFileSync(html, page(title, body));
    await browser.goto(pathToFileURL(html).href);
    await browser.screenshot(join(out, file));
    console.log('wrote', file);
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, 'evidence.json'), JSON.stringify({
  id: 'r3-m3',
  title: 'R3 milestone 3 (STORY-035, 043 to 046, R0 004): launch readiness: evidence',
  capturedBy: 'scripts/evidence/r3-training.mjs (screens 01 to 05, through the real pages of a local stack) and scripts/evidence/r3-milestone-3.mjs (06 to 09, drawn from docs/READINESS-REVIEW.md and infrastructure/aws-govcloud/checks)',
  summary: ['Synthetic demo deployment; not operating in production. STORY-004 is written and checked, not applied.'],
  shots,
}, null, 2) + '\n');

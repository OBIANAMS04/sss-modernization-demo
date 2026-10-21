// STORY-021 and 025 (backend): drift detection, server-side evaluation and fairness runs, change markers, alerts, outcome monitoring by
// age band and region, and the access rules (local backend only; see lib.mjs). The backend must run with AI_PROVIDER=stub (no key, no call
// to any model), ADMIN_EMAILS listing morgan.lee@example.com, and the same DATABASE_NAME as this script when its database is not sss_demo:
//   cd backend && AI_PROVIDER=stub ADMIN_EMAILS=morgan.lee@example.com \
//     CASE_MANAGER_EMAILS="manager-local-test@example.com,reviewer-local-test@example.com" npm start
//   DATABASE_NAME=<the backend's database> node scripts/e2e/ai-quality.mjs
// Real answers (mode 'ai') cannot be made without a key, so the drift checks write fixture rows straight into assistant_interactions and
// remove them at the end. Evaluation and fairness runs are real runs through the stand-in.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { account, adminAccount, call, expect, leadershipAccount, MANAGER, run, stamp, staffAccount } from './lib.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FIXTURE = `e2e-ai-quality-${stamp}`;
const view = async (who) => (await call('GET', '/ai-quality', who.token)).data;
// The audit log and notifications are never cleaned, so a second pass over the same database would see the first pass; only what this run caused counts
const STARTED = new Date(Date.now() - 1000);
const trail = async (viewer, query) =>
  (await call('GET', `/audit?${new URLSearchParams({ limit: 100, ...query })}`, viewer.token)).data.logs.filter((l) => new Date(l.timestamp) >= STARTED);

run(async () => {
  const db = new Client({ host: 'localhost', database: process.env.DATABASE_NAME || 'sss_demo', user: 'admin', password: 'dev_password' });
  await db.connect();
  // A kind of run can be started once an hour, so a second pass over the same database starts clean (this suite is local only)
  await db.query('DELETE FROM assistant_eval_runs');
  const users = [];
  try {
    await checks(db, users);
  } finally {
    await db.query('DELETE FROM assistant_interactions WHERE question_redacted = $1', [FIXTURE]);
    await db.query(`DELETE FROM assistant_eval_runs WHERE started_by_email = $1`, [FIXTURE]);
    if (users.length) await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    await db.end();
  }
});

/** One fixture answer of the real model, `daysAgo` days back. */
function insertAnswer(db, userId, daysAgo, { grounded = true, model = 'claude-opus-5-5', latency = 3000, hours = 1 } = {}) {
  return db.query(
    `INSERT INTO assistant_interactions (user_id, trace_id, question_redacted, answer, citations, model, mode, latency_ms, grounding, level, status, created_at)
     VALUES ($1, $2, $3, 'Fixture answer.', '[{"passageId":"a:b","quote":"x"}]'::jsonb, $4, 'ai', $5, $6::jsonb, 0, 'shown', NOW() - make_interval(days => $7::int, hours => $8::int))`,
    [userId, randomUUID(), FIXTURE, model, latency, JSON.stringify({ grounded, coverage: 1 }), daysAgo, hours]
  );
}

async function pollRun(who, kind, id) {
  for (let i = 0; i < 120; i++) {
    const runs = kind === 'eval' ? (await view(who)).evaluation.runs : (await call('GET', '/ai-quality/fairness', who.token)).data.runs;
    const found = runs.find((r) => r.id === id);
    if (found && found.status !== 'running') return found;
    await sleep(500);
  }
  return null;
}

async function checks(db, users) {
  const manager = await staffAccount(MANAGER, 'Manager Test');
  const admin = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
  const lead = await leadershipAccount(`aiq-leadership-${stamp}@example.com`, `AIQ Leadership ${stamp}`);
  const citizen = await account(`aiq-citizen-${stamp}@example.com`, 'AIQ Citizen');
  users.push(citizen.user.id);
  expect('a case manager, an administrator, a leadership user and a citizen', [manager.user.role, admin.user.role, lead.user.role, citizen.user.role], ['case_manager', 'admin', 'leadership', 'citizen']);

  // 1. Who may do what (STORY-021, 025). The server refuses before anything is read, started or changed.
  const reads = ['/ai-quality', '/ai-quality/fairness'];
  for (const path of reads) {
    expect(`${path}: a citizen is refused (403), leadership too, nobody signed in gets 401`, [(await call('GET', path, citizen.token)).status, (await call('GET', path, lead.token)).status, (await call('GET', path)).status], [403, 403, 401]);
    expect(`${path}: a case manager and an administrator may read`, [(await call('GET', path, manager.token)).status, (await call('GET', path, admin.token)).status], [200, 200]);
  }
  const fakeRun = '00000000-0000-4000-8000-000000000000';
  for (const [path, label] of [['/ai-quality/evaluations', 'start an evaluation'], ['/ai-quality/fairness-runs', 'start a fairness run'], [`/ai-quality/runs/${fakeRun}/baseline`, 'mark a baseline']]) {
    expect(
      `${label}: a case manager (403), a citizen (403), leadership (403) and nobody signed in (401) are refused`,
      [(await call('POST', path, manager.token)).status, (await call('POST', path, citizen.token)).status, (await call('POST', path, lead.token)).status, (await call('POST', path)).status],
      [403, 403, 403, 401]
    );
  }
  const refusals = await trail(admin, { action: 'ACCESS_DENIED', limit: 50 });
  expect('the refusals are in the audit log', refusals.some((l) => l.details?.path === '/api/ai-quality/evaluations'), true);
  expect('and nothing was started by them', (await db.query(`SELECT COUNT(*)::int AS n FROM assistant_eval_runs`)).rows[0].n, 0);

  // 2. Drift: with no real answers there is nothing to compare (STORY-021)
  const empty = await view(admin);
  expect('before any real answer every signal says not enough data', empty.signals.every((s) => s.state === 'not-enough-data'), true);
  expect('nine signals, each with its tolerance in words', [empty.signals.length, empty.signals.find((s) => s.key === 'groundedRate').tolerance, empty.signals.find((s) => s.key === 'p95LatencyMs').tolerance], [9, 'down more than 2 points', 'up more than 50%']);
  expect('the trend covers 35 days, a series per signal, and the table has the answers per day', [empty.trend.days.length, empty.trend.series.length, empty.trend.answers.length], [35, 9, 35]);
  expect('no alert is open', empty.alerts.filter((a) => !a.clearedAt), []);

  // 19 answers in the last 7 days is not enough, whatever they say
  for (let i = 0; i < 19; i++) await insertAnswer(db, citizen.user.id, 1, { grounded: false });
  for (let i = 0; i < 30; i++) await insertAnswer(db, citizen.user.id, 10 + (i % 20));
  expect('19 recent answers is still not enough data, even with all of them ungrounded', (await view(admin)).signals.find((s) => s.key === 'groundedRate').state, 'not-enough-data');

  // 20 recent answers, 6 of them ungrounded, against 30 grounded ones in the 28 days before
  await insertAnswer(db, citizen.user.id, 1, { grounded: true });
  for (let i = 0; i < 13; i++) await db.query(`UPDATE assistant_interactions SET grounding = '{"grounded":true,"coverage":1}'::jsonb WHERE id = (SELECT id FROM assistant_interactions WHERE question_redacted = $1 AND grounding->>'grounded' = 'false' LIMIT 1)`, [FIXTURE]);
  const drifted = await view(admin);
  const grounded = drifted.signals.find((s) => s.key === 'groundedRate');
  expect('20 recent answers, 14 grounded, against 30 of 30: grounded rate drifts (70% against 100%)', [grounded.state, grounded.recent, grounded.baseline, grounded.change], ['drift', 70, 100, -30]);
  expect('the signals that did not move are ok', drifted.signals.filter((s) => s.state === 'drift').map((s) => s.key), ['groundedRate']);

  // 3. The alert: an audit event and a notification to every administrator, once (STORY-021)
  const opened = drifted.alerts.filter((a) => !a.clearedAt);
  expect('one alert is open, for the grounded rate, in words', [opened.length, opened[0].kind, opened[0].key, opened[0].message], [1, 'signal', 'groundedRate', 'Grounded rate moved from 100% to 70% (down more than 2 points is drift).']);
  const alertAudit = async () => (await trail(admin, { action: 'AI_DRIFT_ALERT' })).filter((l) => l.details?.key === 'groundedRate');
  expect('the audit log has one AI_DRIFT_ALERT, opened', (await alertAudit()).map((l) => l.details.phase), ['opened']);
  const noticesOf = async (who) => (await call('GET', '/notifications?limit=50', who.token)).data.notifications.filter((n) => new Date(n.createdAt) >= STARTED).map((n) => n.message);
  const wanted = (m) => m.startsWith('AI quality alert: Grounded rate moved from 100% to 70%');
  expect('every administrator is told, nobody else', [(await noticesOf(admin)).filter(wanted).length, (await noticesOf(manager)).filter(wanted).length, (await noticesOf(citizen)).filter(wanted).length], [1, 0, 0]);
  await view(manager);
  await view(admin);
  expect('looking again (even as someone else) does not alert again', [(await alertAudit()).length, (await noticesOf(admin)).filter(wanted).length, (await view(admin)).alerts.filter((a) => !a.clearedAt).length], [1, 1, 1]);
  expect('no question text is in the alert audit entry', JSON.stringify(await alertAudit()).includes('Fixture'), false);

  // 4. It clears when the answers recover
  await db.query(`UPDATE assistant_interactions SET grounding = '{"grounded":true,"coverage":1}'::jsonb WHERE question_redacted = $1`, [FIXTURE]);
  const recovered = await view(admin);
  expect('the signal is ok again, the alert is cleared, and the audit log says so', [recovered.signals.find((s) => s.key === 'groundedRate').state, recovered.alerts.filter((a) => !a.clearedAt).length, recovered.alerts.filter((a) => a.clearedAt && new Date(a.clearedAt) >= STARTED).length], ['ok', 0, 1]);
  expect('the audit log has opened, then cleared', (await alertAudit()).map((l) => l.details.phase).sort(), ['cleared', 'opened']);

  // 5. Latency has its own tolerance: p95 up more than 50%
  await db.query(`UPDATE assistant_interactions SET latency_ms = 9000 WHERE question_redacted = $1 AND created_at > NOW() - INTERVAL '7 days'`, [FIXTURE]);
  const slow = (await view(admin)).signals.find((s) => s.key === 'p95LatencyMs');
  expect('p95 latency 9000 ms against 3000 ms is drift', [slow.state, slow.recent, slow.baseline], ['drift', 9000, 3000]);
  await db.query(`UPDATE assistant_interactions SET latency_ms = 3000 WHERE question_redacted = $1`, [FIXTURE]);
  expect('and clears when it comes back', (await view(admin)).alerts.filter((a) => !a.clearedAt).length, 0);

  // 6. Change markers: a model that is not the one before, and a new version of the documents (STORY-021)
  const first = await view(admin);
  const lastModelBefore = first.markers.filter((m) => m.kind === 'model').at(-1);
  expect('the model the answers report is a marker, and so is the version of the documents', [first.markers.some((m) => m.kind === 'model' && m.to === 'claude-opus-5-5'), first.markers.some((m) => m.kind === 'corpus')], [true, true]);
  await insertAnswer(db, citizen.user.id, 0, { model: 'claude-sonnet-5-5', hours: 0 });
  const switched = (await view(admin)).markers.filter((m) => m.kind === 'model').at(-1);
  expect('a different model, as the answer reports it, is a new marker with what it changed from', [switched.from, switched.to], [lastModelBefore.to, 'claude-sonnet-5-5']);
  const versionBefore = (await db.query(`SELECT version FROM policy_passages WHERE doc_slug = 'appeals' LIMIT 1`)).rows[0].version;
  await db.query(`UPDATE policy_passages SET version = $1 WHERE doc_slug = 'appeals'`, ['f'.repeat(64)]);
  const corpus = (await view(admin)).markers.filter((m) => m.kind === 'corpus');
  await db.query(`UPDATE policy_passages SET version = $1 WHERE doc_slug = 'appeals'`, [versionBefore]);
  expect('a changed version of the policy documents is a marker too', corpus.length >= 2 && corpus.at(-1).from === corpus.at(-2).to, true);
  const again = await view(admin);
  expect('and going back is another', again.markers.filter((m) => m.kind === 'corpus').length, corpus.length + 1);
  await db.query(`DELETE FROM assistant_interactions WHERE question_redacted = $1 AND model = 'claude-sonnet-5-5'`, [FIXTURE]);

  // 7. A server-side evaluation run: admin only, through the same path as a real question, once an hour (STORY-021)
  const started = await call('POST', '/ai-quality/evaluations', admin.token);
  expect('an administrator starts the golden set: 202 with a run that is running', [started.status, started.data.run.kind, started.data.run.status, started.data.run.mode], [202, 'eval', 'running', 'stub']);
  const finished = await pollRun(admin, 'eval', started.data.run.id);
  expect('it finishes: the four scores, the model, the corpus version and who started it', [finished?.status, finished?.scores.retrievalHitRate, finished?.scores.citationValidity, finished?.scores.groundedRate, finished?.model, typeof finished?.corpusVersion, finished?.startedByEmail], ['completed', 1, 1, 1, 'stub', 'string', 'morgan.lee@example.com']);
  expect('the stand-in meets the thresholds that apply to it (retrieval and citations)', finished.passed, true);
  const second = await call('POST', '/ai-quality/evaluations', admin.token);
  expect('a second run within the hour is refused with a 429 that says when', [second.status, Number(second.headers.get('retry-after')) > 0, /once an hour/.test(second.data.error.message)], [429, true, true]);
  expect('only one run was stored', (await db.query(`SELECT COUNT(*)::int AS n FROM assistant_eval_runs WHERE kind = 'eval'`)).rows[0].n, 1);
  const stored = (await db.query(`SELECT jsonb_array_length(results) AS n, results->0->>'question' AS q FROM assistant_eval_runs WHERE id = $1`, [finished.id])).rows[0];
  expect('the per-question results are stored (33 golden questions)', stored.n >= 25, true);
  const runAudit = await trail(admin, { action: 'AI_EVAL_RUN' });
  expect('the run is audited when it starts and when it finishes, without any question', [runAudit.map((l) => l.details.phase).sort(), JSON.stringify(runAudit).includes(stored.q)], [['finished', 'started'], false]);

  // 8. The baseline
  expect('an id that is not a run is a 400, an unknown run a 404', [(await call('POST', '/ai-quality/runs/nope/baseline', admin.token)).status, (await call('POST', `/ai-quality/runs/${fakeRun}/baseline`, admin.token)).status], [400, 404]);
  const marked = await call('POST', `/ai-quality/runs/${finished.id}/baseline`, admin.token);
  expect('an administrator marks it as the baseline', [marked.status, marked.data.run.isBaseline], [200, true]);
  const withBaseline = await view(manager);
  expect('staff see the latest run against the baseline', [withBaseline.evaluation.latest.id, withBaseline.evaluation.baseline.id, withBaseline.evaluation.belowBaseline], [finished.id, finished.id, []]);
  expect('marking the baseline is audited', (await trail(admin, { action: 'AI_EVAL_BASELINE' })).some((l) => l.resourceId === finished.id), true);

  // 9. A run below a threshold, or more than 5 points under the baseline, is drift (fixtures: stored runs a person did not start)
  const fixtureRun = (retrieval, facts) =>
    db.query(
      `INSERT INTO assistant_eval_runs (kind, status, mode, model, corpus_version, retrieval_hit_rate, fact_accuracy, citation_validity, grounded_rate, passed, started_by_email, finished_at, created_at)
       VALUES ('eval', 'completed', 'stub', 'stub', 'abc', $1, $2, 1, 1, TRUE, $3, NOW(), NOW() + INTERVAL '1 minute') RETURNING id`,
      [retrieval, facts, FIXTURE]
    );
  await db.query(`UPDATE assistant_eval_runs SET fact_accuracy = 0.95 WHERE id = $1`, [finished.id]);
  const worse = (await fixtureRun(1, 0.85)).rows[0].id;
  const under = await view(admin);
  expect('a score more than 5 points under the baseline is named, and opens an alert', [under.evaluation.belowBaseline, under.alerts.some((a) => a.kind === 'eval' && !a.clearedAt)], [["Fact accuracy is 85%, more than 5 points under the baseline's 95%."], true]);
  await db.query('DELETE FROM assistant_eval_runs WHERE id = $1', [worse]);
  await view(admin); // the alert for it clears before the next kind of problem is introduced
  const low = (await fixtureRun(0.8, 0.95)).rows[0].id;
  const missed = await view(admin);
  expect('a run under a threshold is a drift too (retrieval 80%, threshold 90%)', missed.alerts.find((a) => a.kind === 'eval' && !a.clearedAt)?.message.includes('Retrieval hit rate is 80%, under the threshold of 90%.'), true);
  expect('the alert reached the administrators once', (await noticesOf(admin)).filter((m) => m.includes('latest evaluation run is a drift')).length, 2);
  await db.query('DELETE FROM assistant_eval_runs WHERE id = $1', [low]);
  expect('and clears when the latest run is fine again', (await view(admin)).alerts.filter((a) => a.kind === 'eval' && !a.clearedAt).length, 0);

  // 10. Counterfactual fairness run (STORY-025): ten questions in seven forms each
  const fair = await call('POST', '/ai-quality/fairness-runs', admin.token);
  expect('an administrator starts a fairness run: 202', [fair.status, fair.data.run.kind], [202, 'fairness']);
  const fairDone = await pollRun(admin, 'fairness', fair.data.run.id);
  const summary = fairDone?.summary;
  expect('it finishes with 70 questions asked and 60 pairs', [fairDone?.status, summary?.questions, summary?.asked, summary?.pairs], ['completed', 10, 70, 60]);
  expect('the same passages in at least 95% of pairs, the same oversight level in at least 95%, the key facts in every variant', [summary.samePassages.rate >= 0.95, summary.sameLevel.rate >= 0.95, summary.factsInEveryVariant.rate], [true, true, 1]);
  expect('so the run passed, with six attributes of ten pairs each', [fairDone.passed, summary.byAttribute.map((a) => a.pairs)], [true, [10, 10, 10, 10, 10, 10]]);
  expect('a second fairness run within the hour is a 429; an evaluation run is not blocked by it', [(await call('POST', '/ai-quality/fairness-runs', admin.token)).status], [429]);
  const fairness = (await call('GET', '/ai-quality/fairness', manager.token)).data;
  expect('staff see the latest run and the statement of what is not collected', [fairness.latest.id, fairness.statement.notCollected.length, fairness.statement.paragraphs.join(' ').includes('Age is an input to the Type A')], [fairDone.id, 6, true]);
  expect('no protected attribute is stored anywhere: the users table has none', (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name ~* 'race|ethnic|gender|sex|religio|disab|national'`)).rows, []);

  // 11. The eligibility and compliance rules give identical outcomes whoever asks, from wherever, in whatever format (STORY-025 (1), end to end)
  const people = [
    ['Jamal Washington', '(555) 010-1234', '12 Elm Street, Boston, MA 02101'],
    ['Maria Hernandez', '555-010-2345', '48 Oak Ave, Houston, TX 77001'],
    ['Wei Zhang', '+1 555 010 3456', '9 Pine Rd\nSeattle, WA 98101'],
    ['Emily Walsh', '5550104567', '300 Lake Dr, Chicago, IL 60601'],
    ['Lakota Whitehorse', '1-555-010-5678', 'PO Box 7, Rapid City, SD'],
    ['Alex Morgan', '555 010 6789', '77 sunset blvd los angeles ca 90001'],
  ];
  const outcomes = [];
  for (const [i, [name, phone, address]] of people.entries()) {
    const p = await account(`aiq-person-${i}-${stamp}@example.com`, name, '1950-06-01');
    users.push(p.user.id);
    const saved = await call('PUT', `/users/${p.user.id}`, p.token, { phone, address, annualIncome: 15000, hasDocumentedHardship: true });
    const profile = await call('GET', `/users/${p.user.id}`, p.token);
    outcomes.push(JSON.stringify([saved.status, saved.data.eligibility.evaluations.map((e) => [e.exemptionType, e.status, e.reason]), profile.data.complianceStatus ?? profile.data.compliance_status]));
  }
  expect('six people with different names, regions, phone and address formats: one outcome', [...new Set(outcomes)].length, 1);
  expect('and it is the expected one: eligible for A and B, pending for C, registration compliant', JSON.parse(outcomes[0])[1].map((e) => e[1]).concat(JSON.parse(outcomes[0])[2]), ['Eligible', 'Eligible', 'Pending Review', 'Eligible']);

  // 12. Outcome monitoring by age band and region (STORY-025 (3)), from fixture decisions of young people in three regions
  const fixtureGroup = async (label, address, approved, denied, daysToDecide) => {
    const u = (
      await db.query(
        `INSERT INTO users (email, password_hash, full_name, ssn_hash, dob, address) VALUES ($1, 'x', $2, 'fixture', DATE '2006-01-01', $3) RETURNING id`,
        [`aiq-fixture-${label}-${stamp}@example.com`, `Fixture ${label}`, address]
      )
    ).rows[0].id;
    users.push(u);
    for (let i = 0; i < approved + denied; i++) {
      const decision = i < approved ? 'Approved' : 'Denied';
      const c = (await db.query(`INSERT INTO cases (user_id, status, submitted_at) VALUES ($1, $2, NOW() - make_interval(days => $3::int)) RETURNING id`, [u, decision, daysToDecide])).rows[0].id;
      await db.query(
        `INSERT INTO case_events (case_id, event_type, from_status, to_status, eligibility_status) VALUES ($1, 'status_change', 'In Review', $2, $3)`,
        [c, decision, decision === 'Approved' ? 'Eligible' : 'Eligible']
      );
    }
  };
  await fixtureGroup('south', '1 Main St, Dallas, TX 75001', 12, 0, 2); // 100% approved
  await fixtureGroup('west', '2 Main St, Denver, CO 80201', 8, 4, 4); // 66.7% approved: under four fifths of 100%
  await fixtureGroup('northeast', '3 Main St, Albany, NY 12201', 5, 4, 1); // 9 decisions: too few
  const outcomesReport = (await call('GET', '/ai-quality/fairness', manager.token)).data.outcomes;
  const region = (name) => outcomesReport.byRegion.find((g) => g.group === name);
  expect('South: 12 decisions, 100% approved, 2 days to decide', [region('South').decisions, region('South').approvalRate, region('South').avgDaysToDecide, region('South').flagged], [12, 100, 2, false]);
  expect('West: 66.67% approved is under four fifths of the highest, so it is flagged; 4 days', [region('West').approvalRate, region('West').ratioToHighest, region('West').flagged, region('West').avgDaysToDecide], [66.67, 66.67, true, 4]);
  expect('Northeast: 9 decisions is under the minimum of 10, so no rates and no flag', [region('Northeast').decisions, region('Northeast').approvalRate, region('Northeast').flagged, region('Northeast').enough], [9, null, false, false]);
  expect('the override rate is the share of decisions against the automatic result: denials of the Eligible', [region('West').checked, region('West').overrides, region('West').overrideRate], [12, 4, 33.33]);
  expect('the age band of 20-year-olds holds all 33 and the flagged list names the region', [outcomesReport.byAgeBand.find((g) => g.group === '18 to 24').decisions, outcomesReport.flagged.includes('Region West')], [33, true]);
  expect('the report holds no address', JSON.stringify(outcomesReport).includes('Denver'), false);
}

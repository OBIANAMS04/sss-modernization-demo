// STORY-017, 018, 022 and 023 policy assistant: cited answers, SSN removal, the oversight levels, the hourly limit, the daily cap, the
// hallucination figures for staff, and each person's own history (local backend only; see lib.mjs). The backend must run with
// AI_PROVIDER=stub (a deterministic stand-in, no key, no call to any model) and, when its database is not sss_demo, this script
// needs the same DATABASE_NAME:
//   cd backend && AI_PROVIDER=stub CASE_MANAGER_EMAILS="manager-local-test@example.com,reviewer-local-test@example.com" npm start
//   node scripts/e2e/assistant.mjs
import { createRequire } from 'node:module';
import { account, call, expect, MANAGER, run, stamp, staffAccount } from './lib.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SSN = '900-00-0010';
const INCOME = 'What is the income limit for the Type B exemption?';
const FILLER = 'e2e-cap-filler';

const ask = (person, question) => call('POST', '/assistant/ask', person.token, { question });

run(async () => {
  const db = new Client({ host: 'localhost', database: process.env.DATABASE_NAME || 'sss_demo', user: 'admin', password: 'dev_password' });
  await db.connect();
  const people = [];
  try {
    await checks(db, people);
  } finally {
    // The daily cap is shared by everyone, so a run gives back what it used (the audit entries stay, as they always do)
    await db.query('DELETE FROM assistant_interactions WHERE question_redacted = $1 OR user_id = ANY($2::uuid[])', [FILLER, people]);
    await db.end();
  }
});

async function checks(db, people) {
  const staff = await staffAccount(MANAGER, 'Manager Test');
  const a = await account(`assistant-a-${stamp}@example.com`, 'Assistant A');
  const b = await account(`assistant-b-${stamp}@example.com`, 'Assistant B');
  const limited = await account(`assistant-limit-${stamp}@example.com`, 'Assistant Limit');
  people.push(staff.user.id, a.user.id, b.user.id, limited.user.id);
  const row = async (traceId) => (await db.query('SELECT * FROM assistant_interactions WHERE trace_id = $1', [traceId])).rows[0];

  // Who may ask
  expect('nobody signed in is refused (401)', (await call('POST', '/assistant/ask', null, { question: INCOME })).status, 401);
  expect('nobody signed in may not read a history (401)', (await call('GET', '/assistant/history')).status, 401);

  // A question is answered from the policy passages, with citations to them
  const first = await ask(a, INCOME);
  expect('a signed-in citizen is answered (200, stub mode, shown at level 0 or 1)', [first.status, first.data.mode, first.data.status, [0, 1].includes(first.data.level)], [200, 'stub', 'shown', true]);
  expect('the answer states the income limit of the demo policy', first.data.answer?.includes('$20,000'), true);
  const retrievedIds = first.data.retrieved.map((r) => r.passageId);
  expect('five passages were retrieved, best first, and the Type B passage is among them', [retrievedIds.length, retrievedIds.includes('exemption-type-b:who-qualifies-the-income-limit')], [5, true]);
  expect('every citation is to a passage that was retrieved', first.data.citations.length > 0 && first.data.citations.every((c) => retrievedIds.includes(c.passageId)), true);
  const stored = (await db.query('SELECT id, body FROM policy_passages WHERE id = ANY($1)', [retrievedIds])).rows;
  expect(
    'every quote is really in the text of the passage it names',
    first.data.citations.every((c) => stored.find((p) => p.id === c.passageId)?.body.includes(c.quote)),
    true
  );
  expect('the answer is grounded: no unsupported sentence, number or citation', [first.data.grounding.grounded, first.data.grounding.unsupported], [true, []]);
  expect('the response has a trace id and no AI-off note', [/^[0-9a-f-]{36}$/.test(first.data.traceId), first.data.message], [true, undefined]);
  const exchange = await row(first.data.traceId);
  expect(
    'the exchange is stored: question, retrieved passages, answer, citations, model, latency, grounding, level and status',
    [exchange.question_redacted, exchange.passage_ids, exchange.answer === first.data.answer, exchange.citations.length === first.data.citations.length, exchange.model, exchange.latency_ms >= 0, exchange.grounding.grounded, exchange.level, exchange.status],
    [INCOME, retrievedIds, true, true, 'stub', true, true, first.data.level, 'shown']
  );

  // A Social Security number is removed before anything is searched, stored, sent or logged
  const withSsn = await ask(a, `My SSN is ${SSN} and also 900000010. How do I appeal a denial?`);
  expect('a question with an SSN in it is still answered, and says it was cleaned', [withSsn.status, withSsn.data.status, withSsn.data.questionRedacted], [200, 'shown', true]);
  const cleaned = await row(withSsn.data.traceId);
  expect('the stored question has no SSN, only the mark where it was', cleaned.question_redacted, 'My SSN is [REDACTED] and also [REDACTED]. How do I appeal a denial?');
  const leaks = await db.query(
    `SELECT (SELECT COUNT(*) FROM assistant_interactions WHERE question_redacted ~ '900-?00-?0010|900000010' OR answer ~ '900-?00-?0010|900000010' OR citations::text ~ '900-?00-?0010|900000010')::int AS exchanges,
            (SELECT COUNT(*) FROM audit_logs WHERE details::text ~ '900-?00-?0010|900000010')::int AS audit_entries`
  );
  expect('no stored exchange and no audit entry holds the SSN', [leaks.rows[0].exchanges, leaks.rows[0].audit_entries], [0, 0]);
  await sleep(300);
  const trail = (await call('GET', `/audit?${new URLSearchParams({ action: 'AI_ANSWER', user: a.user.email, limit: 100 })}`, staff.token)).data.logs;
  expect('the audit log has no SSN either', /900-?00-?0010|900000010/.test(JSON.stringify(trail)), false);

  // Every answer is audited: the trace id, the passages and the level, never the question
  const entry = trail.find((l) => l.resourceId === first.data.traceId);
  expect(
    'the answer is audited as AI_ANSWER with its trace id, passages and level',
    [entry?.action, entry?.status, entry?.actorEmail, entry?.details.traceId, entry?.details.level, entry?.details.passageIds],
    ['AI_ANSWER', 'success', a.user.email, first.data.traceId, first.data.level, retrievedIds]
  );
  expect('the audit entry does not hold the question', JSON.stringify(trail).includes('income limit'), false);

  // Questions about a person's own eligibility or case are not answered by the assistant (level 2)
  const personal = await ask(a, 'Am I eligible for the senior exemption?');
  expect(
    'a personal eligibility question is withheld at level 2 for a case manager',
    [personal.status, personal.data.status, personal.data.level, personal.data.answer, personal.data.citations, personal.data.message],
    [200, 'with-staff', 2, null, [], 'A case manager will review this question and reply.']
  );
  const draft = await row(personal.data.traceId);
  expect('the draft is kept for the case manager, and the response says nothing of it', [draft.status, draft.level, typeof draft.answer, JSON.stringify(personal.data).includes(draft.answer)], ['with-staff', 2, 'string', false]);
  expect('another personal question: "Will I be approved?"', (await ask(a, 'Will I be approved for Type B?')).data.level, 2);
  expect('a question about the rules in general is not personal', (await ask(a, 'Can I open a second case for the same exemption?')).data.status, 'shown');

  // An answer that fails the grounding check is withheld, and counts against the quality figures
  const ungrounded = await ask(a, 'How do I appeal a denial? stub-ungrounded');
  expect(
    'an ungrounded answer is withheld at level 2',
    [ungrounded.data.status, ungrounded.data.level, ungrounded.data.answer, ungrounded.data.grounding.grounded, JSON.stringify(ungrounded.data).includes('45 days')],
    ['with-staff', 2, null, false, false]
  );
  await sleep(300);
  const failure = (await call('GET', `/audit?${new URLSearchParams({ action: 'AI_ANSWER', resourceId: ungrounded.data.traceId })}`, staff.token)).data.logs[0];
  expect('the audit entry of an ungrounded answer is a failure', [failure?.status, failure?.details.grounded], ['failure', false]);

  // The model being unavailable, nothing matching, and bad questions
  const unavailable = await ask(a, 'How do I appeal a denial? stub-unavailable');
  expect(
    'when the model is unavailable the policy passages are returned instead, with a plain note',
    [unavailable.data.mode, unavailable.data.status, unavailable.data.answer, unavailable.data.passages?.length, unavailable.data.message?.includes('not available right now')],
    ['passages-only', 'shown', null, 5, true]
  );
  const nothing = await ask(a, 'What is the weather today?');
  expect('a question the documents do not cover has no answer', [nothing.data.status, nothing.data.answer, nothing.data.message], ['no-answer', null, 'The demo policy documents do not answer that question. Please ask a case manager.']);
  expect('a question of two characters is refused (400)', (await ask(a, 'Hi')).status, 400);
  expect('a question of 501 characters is refused (400)', (await ask(a, 'x'.repeat(501))).status, 400);
  expect('a question that is not text is refused (400)', (await call('POST', '/assistant/ask', a.token, { question: 42 })).status, 400);
  expect('a question that is only an SSN is refused (400)', (await ask(a, SSN)).status, 400);

  // Staff see how often answers fail the grounding check; citizens do not
  expect('a citizen is refused the quality figures (403)', (await call('GET', '/assistant/quality', a.token)).status, 403);
  expect('nobody signed in is refused them (401)', (await call('GET', '/assistant/quality')).status, 401);
  const quality = await call('GET', '/assistant/quality', staff.token);
  expect('a case manager reads them (200) against the 2% target, for 7 and 30 days', [quality.status, quality.data.target, quality.data.windows.map((w) => w.days)], [200, 2, [7, 30]]);
  const week = quality.data.windows[0];
  expect('they count the answers and the ungrounded ones, and give the rate', [week.answers >= 5, week.ungrounded >= 1, week.rate > 0], [true, true, true]);
  const breached = quality.data.windows.some((w) => w.rate !== null && w.rate >= quality.data.target);
  expect('the alert is raised exactly when a window is at or over the target, and then has its words', [quality.data.alert, typeof quality.data.alertMessage], [breached, breached ? 'string' : 'object']);
  const example = quality.data.latestUngrounded.find((u) => u.traceId === ungrounded.data.traceId);
  expect(
    'the latest ungrounded examples show the question, the answer and what was unsupported',
    [example?.question, example?.answer?.includes('45 days'), example?.unsupported.map((u) => u.type).sort()],
    ['How do I appeal a denial? stub-ungrounded', true, ['uncited-sentence', 'unsupported-number']]
  );
  expect('the day\'s usage and the corpus are reported', [quality.data.usage.dailyLimit, quality.data.corpus.documents, quality.data.corpus.passages > 30], [300, 8, true]);

  // Each person has their own history
  const bAsk = await ask(b, 'Who can read internal case notes?');
  const historyB = (await call('GET', '/assistant/history', b.token)).data.history;
  expect('a person\'s history holds their own exchanges only', [historyB.length, historyB[0].traceId, historyB[0].question], [1, bAsk.data.traceId, 'Who can read internal case notes?']);
  const historyA = (await call('GET', '/assistant/history', a.token)).data.history;
  expect('and the other person\'s history does not hold B\'s', historyA.some((h) => h.traceId === bAsk.data.traceId), false);
  expect('A\'s history holds A\'s exchanges, newest first, with the SSN gone', [historyA[0].question, historyA.some((h) => h.traceId === first.data.traceId), JSON.stringify(historyA).includes(SSN)], ['What is the weather today?', true, false]);
  expect('a withheld answer is not in the history, only that it is with a case manager', [historyA.find((h) => h.traceId === personal.data.traceId)?.answer, historyA.find((h) => h.traceId === personal.data.traceId)?.message], [null, 'A case manager will review this question and reply.']);
  expect('the history is the last 20 at most', (await call('GET', '/assistant/history', limited.token)).data.history.length <= 20, true);

  // The hourly limit: 20 questions, then a 429 that says how long to wait
  const answers = [];
  for (let i = 0; i < 20; i++) answers.push((await ask(limited, `Who qualifies for the senior exemption? (${i})`)).status);
  expect('twenty questions in an hour are all answered', answers.every((s) => s === 200), true);
  const over = await call('POST', '/assistant/ask', limited.token, { question: 'One question too many?' });
  expect('the 21st is refused (429, RATE_LIMITED)', [over.status, over.data.error.code], [429, 'RATE_LIMITED']);
  expect('the message is clear and the Retry-After header says how many seconds to wait', [over.data.error.message.startsWith('You have reached the limit of 20 questions per hour. Please try again in'), Number(over.headers.get('retry-after')) > 0], [true, true]);
  expect('a refused question is not stored', (await db.query(`SELECT COUNT(*)::int AS n FROM assistant_interactions WHERE user_id = $1`, [limited.user.id])).rows[0].n, 20);
  expect('the limit is per person: someone else can still ask', (await ask(b, INCOME)).status, 200);

  // The daily cap: once it is used up, questions get the passages alone
  const { generatedToday, dailyLimit } = (await call('GET', '/assistant/quality', staff.token)).data.usage;
  await db.query(
    `INSERT INTO assistant_interactions (user_id, trace_id, question_redacted, mode, status) SELECT NULL, gen_random_uuid(), $1, 'stub', 'error' FROM generate_series(1, $2::int)`,
    [FILLER, Math.max(dailyLimit - generatedToday, 0)]
  );
  const capped = await ask(b, INCOME);
  expect(
    'at the daily cap the question is still taken, but answered with the policy passages alone',
    [capped.status, capped.data.mode, capped.data.answer, capped.data.passages?.length, capped.data.message?.includes('daily limit for AI answers has been reached')],
    [200, 'passages-only', null, 5, true]
  );
  await db.query('DELETE FROM assistant_interactions WHERE question_redacted = $1', [FILLER]);
  expect('below the cap again it answers', (await ask(b, INCOME)).data.mode, 'stub');
}

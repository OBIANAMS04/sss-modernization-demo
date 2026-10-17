// STORY-019, 023 and 024 (backend): feedback on an answer, the review queue and a case manager's review, and the override rate that
// follows from them (local backend only; see lib.mjs). The backend must run with AI_PROVIDER=stub (a deterministic stand-in, no key,
// no call to any model), ADMIN_EMAILS listing morgan.lee@example.com, and the same DATABASE_NAME as this script when its database is
// not sss_demo:
//   cd backend && AI_PROVIDER=stub AI_MODEL=claude-opus-5-5 ADMIN_EMAILS=morgan.lee@example.com \
//     CASE_MANAGER_EMAILS="manager-local-test@example.com,reviewer-local-test@example.com" npm start
//   node scripts/e2e/assistant-review.mjs
// CONFIG_CHANGE for the AI settings needs two starts: restart the backend with a different AI_MODEL, then
//   node scripts/e2e/assistant-review.mjs --model-changed <the new model>
import { createRequire } from 'node:module';
import { account, adminAccount, call, exemptionId, expect, leadershipAccount, MANAGER, REVIEWER, run, stamp, staffAccount } from './lib.mjs';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const GENERAL = 'How old must a registrant be for Type A?';
const PERSONAL = 'Am I eligible for the senior exemption?';
const UNGROUNDED = 'How do I appeal a denial? stub-ungrounded';
const SSN = '900-00-0010';

const ask = (person, question) => call('POST', '/assistant/ask', person.token, { question });
const feedback = (person, traceId, body) => call('POST', `/assistant/${traceId}/feedback`, person.token, body);
const review = (person, traceId, body) => call('POST', `/assistant/reviews/${traceId}`, person.token, body);
const queueOf = async (person) => (await call('GET', '/assistant/reviews', person.token)).data;
const historyOf = async (person) => (await call('GET', '/assistant/history', person.token)).data.history;
const noticesOf = async (person) => (await call('GET', '/notifications?limit=50', person.token)).data.notifications.map((n) => n.message);
const trail = async (viewer, query) => (await call('GET', `/audit?${new URLSearchParams({ limit: 100, ...query })}`, viewer.token)).data.logs;

run(async () => {
  if (process.argv[2] === '--model-changed') return modelChanged(process.argv[3]);
  const db = new Client({ host: 'localhost', database: process.env.DATABASE_NAME || 'sss_demo', user: 'admin', password: 'dev_password' });
  await db.connect();
  const people = [];
  try {
    await checks(db, people);
  } finally {
    // The daily cap is shared by everyone, so a run gives back what it used (the audit entries and notifications stay, as they always do)
    await db.query('DELETE FROM assistant_interactions WHERE user_id = ANY($1::uuid[])', [people]);
    await db.end();
  }
});

async function checks(db, people) {
  const a = await staffAccount(MANAGER, 'Manager Test');
  const b = await staffAccount(REVIEWER, 'Reviewer Test');
  const admin = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
  const lead = await leadershipAccount(`review-leadership-${stamp}@example.com`, `Review Leadership ${stamp}`);
  const x = await account(`review-x-${stamp}@example.com`, 'Review X');
  const y = await account(`review-y-${stamp}@example.com`, 'Review Y');
  people.push(a.user.id, b.user.id, x.user.id, y.user.id);
  const row = async (traceId) => (await db.query('SELECT * FROM assistant_interactions WHERE trace_id = $1', [traceId])).rows[0];
  expect('two case managers, two citizens', [a.user.role, b.user.role, x.user.role, y.user.role], ['case_manager', 'case_manager', 'citizen', 'citizen']);

  // The override rate as it stands before this run reviews or decides anything (STORY-024). It covers every case, so the run is judged by what it adds.
  const overridesBefore = await overrideRateOf(admin);

  // 1. Opening a cited passage (STORY-019)
  const first = await ask(x, GENERAL);
  expect('a citizen is answered', [first.status, first.data.status, first.data.level <= 1], [200, 'shown', true]);
  const cited = first.data.citations[0].passageId;
  const opened = await call('GET', `/assistant/passages?${new URLSearchParams({ id: cited })}`, x.token);
  expect(
    'a signed-in person opens the passage a citation names: its title, heading and text',
    [opened.status, opened.data.passage.id, typeof opened.data.passage.docTitle, typeof opened.data.passage.heading, first.data.citations.every((c) => c.passageId !== cited || opened.data.passage.text.includes(c.quote))],
    [200, cited, 'string', 'string', true]
  );
  expect('nobody signed in may not (401)', (await call('GET', `/assistant/passages?${new URLSearchParams({ id: cited })}`)).status, 401);
  expect('no id is a 400, an unknown one a 404', [(await call('GET', '/assistant/passages', x.token)).status, (await call('GET', '/assistant/passages?id=no-such:passage', x.token)).status], [400, 404]);

  // 2. Feedback works on your own exchange only (STORY-019)
  expect('another person is refused (403)', (await feedback(y, first.data.traceId, { rating: 'helpful' })).status, 403);
  expect('and so is a case manager', (await feedback(b, first.data.traceId, { rating: 'helpful' })).status, 403);
  expect('nobody signed in is refused (401)', (await call('POST', `/assistant/${first.data.traceId}/feedback`, null, { rating: 'helpful' })).status, 401);
  expect('the refusal changed nothing', (await row(first.data.traceId)).feedback, null);
  expect('an unknown question is a 404, an id that is not one too', [(await feedback(x, '00000000-0000-4000-8000-000000000000', { rating: 'helpful' })).status, (await feedback(x, 'sample', { rating: 'helpful' })).status], [404, 404]);
  expect('a rating that does not exist is a 400', [(await feedback(x, first.data.traceId, { rating: 'great' })).status, (await feedback(x, first.data.traceId, {})).status], [400, 400]);
  expect('a comment over 500 characters is a 400', (await feedback(x, first.data.traceId, { rating: 'not-helpful', comment: 'x'.repeat(501) })).status, 400);

  const helpful = await feedback(x, first.data.traceId, { rating: 'helpful' });
  expect('helpful is recorded and the answer stays', [helpful.status, helpful.data.feedback, helpful.data.status, helpful.data.queued], [200, 'helpful', 'shown', false]);
  const second = await feedback(x, first.data.traceId, { rating: 'not-helpful', comment: `It left out the appeal. My number is ${SSN}.` });
  expect('it can be changed, with a comment', [second.status, second.data.feedback], [200, 'not-helpful']);
  const stored = await row(first.data.traceId);
  expect('the exchange keeps the latest rating and the comment, with the SSN removed', [stored.feedback, stored.feedback_comment, stored.status, stored.level], ['not-helpful', 'It left out the appeal. My number is [REDACTED].', 'shown', first.data.level]);
  expect('the history shows the rating', (await historyOf(x)).find((h) => h.traceId === first.data.traceId).feedback, 'not-helpful');

  // 3. Withheld questions and a report all go to the queue (STORY-023)
  const personal = await ask(x, PERSONAL);
  const ungrounded = await ask(x, UNGROUNDED);
  expect('two answers are withheld for a case manager', [personal.data.status, ungrounded.data.status], ['with-staff', 'with-staff']);
  await sleep(1100); // so the queue's order by time is certain
  const report = await feedback(x, first.data.traceId, { rating: 'problem', comment: 'It does not mention the appeal deadline at all.' });
  expect(
    'a reported problem goes to the review queue at level 2, and the answer is withheld again',
    [report.status, report.data.queued, report.data.status, (await row(first.data.traceId)).level, (await row(first.data.traceId)).status],
    [200, true, 'with-staff', 2, 'with-staff']
  );
  const reported = (await historyOf(x)).find((h) => h.traceId === first.data.traceId);
  expect('the person no longer sees the answer, only that a case manager will reply', [reported.status, reported.answer, reported.citations, reported.message, reported.feedback], ['with-staff', null, [], 'A case manager will review this question and reply.', 'problem']);
  expect('there is nothing left to rate (409)', (await feedback(x, first.data.traceId, { rating: 'helpful' })).status, 409);
  expect('nor on a withheld answer (409)', (await feedback(x, personal.data.traceId, { rating: 'helpful' })).status, 409);

  // 4. Who may see the queue
  expect('a citizen is refused it (403)', (await call('GET', '/assistant/reviews', x.token)).status, 403);
  expect('so is leadership (403), and nobody signed in (401)', [(await call('GET', '/assistant/reviews', lead.token)).status, (await call('GET', '/assistant/reviews')).status], [403, 401]);
  expect('a citizen may not review (403)', (await review(y, personal.data.traceId, { outcome: 'declined', note: 'x' })).status, 403);
  expect('nor leadership (403), nor anyone not signed in (401)', [(await review(lead, personal.data.traceId, { outcome: 'declined', note: 'x' })).status, (await call('POST', `/assistant/reviews/${personal.data.traceId}`, null, { outcome: 'declined', note: 'x' })).status], [403, 401]);

  // 5. The queue: oldest first, with everything a reviewer needs
  const own = await ask(a, PERSONAL);
  const queue = await queueOf(b);
  const mine = queue.items.filter((i) => [personal.data.traceId, ungrounded.data.traceId, first.data.traceId, own.data.traceId].includes(i.traceId));
  expect('all four are waiting, in the order they entered the queue: the report last of the three from X', mine.map((i) => i.traceId), [personal.data.traceId, ungrounded.data.traceId, first.data.traceId, own.data.traceId]);
  expect('the queue is oldest first, by the time each entered it', queue.items.every((item, i) => i === 0 || new Date(queue.items[i - 1].queuedAt) <= new Date(item.queuedAt)), true);
  expect('and says how many wait in all', queue.waiting >= 4, true);
  const [qPersonal, qUngrounded, qReported, qOwn] = mine;
  expect(
    'the personal question: asked by X, the question, a draft (never shown to X) with citations, grounded, and the reason',
    [qPersonal.question, qPersonal.askedBy, typeof qPersonal.draft.answer === 'string' && qPersonal.draft.answer.length > 0, qPersonal.draft.citations.length > 0, qPersonal.grounding?.grounded, qPersonal.reasons.map((r) => r.code), qPersonal.own],
    [PERSONAL, { name: 'Review X', email: x.user.email }, true, true, true, ['personal-question'], false]
  );
  expect(
    'the ungrounded draft: the reviewer sees what failed the check, and the reason',
    [qUngrounded.draft.answer?.includes('45 days'), qUngrounded.grounding?.grounded, qUngrounded.grounding?.unsupported.map((u) => u.type).sort(), qUngrounded.reasons.map((r) => r.code)],
    [true, false, ['uncited-sentence', 'unsupported-number'], ['ungrounded']]
  );
  expect(
    'the reported exchange: reported, with the person\'s comment, queued at the time of the report, the answer X was shown as its draft',
    [qReported.reasons.map((r) => r.code), qReported.reportComment, new Date(qReported.queuedAt) > new Date(qReported.askedAt), qReported.draft.answer === first.data.answer],
    [['reported'], 'It does not mention the appeal deadline at all.', true, true]
  );
  expect('a case manager\'s own question is marked as theirs, for them and not for another', [qOwn.own, (await queueOf(a)).items.find((i) => i.traceId === own.data.traceId).own], [false, true]);

  // 6. A review has to be complete (400), and is not of your own question (403)
  const t = personal.data.traceId;
  expect('an outcome is needed', (await review(b, t, { note: 'x' })).status, 400);
  expect('so is a note', [(await review(b, t, { outcome: 'approved' })).status, (await review(b, t, { outcome: 'approved', note: '  ' })).status], [400, 400]);
  expect('a correction needs its answer', (await review(b, t, { outcome: 'corrected', note: 'x' })).status, 400);
  expect('an approval cannot also change the answer', (await review(b, t, { outcome: 'approved', answer: 'Something else', note: 'x' })).status, 400);
  expect('an unknown question is a 404', (await review(b, '00000000-0000-4000-8000-000000000000', { outcome: 'declined', note: 'x' })).status, 404);
  const selfReview = await review(a, own.data.traceId, { outcome: 'approved', note: 'It is mine, but it looks fine.' });
  expect('a case manager cannot review a question they asked themselves (403)', [selfReview.status, selfReview.data.error?.message], [403, 'You cannot review a question you asked yourself. Another case manager will review it.']);
  expect('nothing changed, and nobody was notified', [(await row(own.data.traceId)).status, (await row(own.data.traceId)).review_outcome, (await noticesOf(a)).some((m) => m.includes('reviewed your policy question'))], ['with-staff', null, false]);
  await sleep(700);
  expect('the refusal is audited', (await trail(a, { user: a.user.email, action: 'ACCESS_DENIED' })).some((l) => l.details?.path === `/api/assistant/reviews/${own.data.traceId}` && l.details?.status === 403), true);

  // 7. Approve: the draft is sent as it is
  const approved = await review(b, t, { outcome: 'approved', note: 'The draft states the age rule correctly.' });
  expect('B approves the draft', [approved.status, approved.data.outcome, approved.data.status, approved.data.notified], [200, 'approved', 'reviewed', true]);
  const approvedRow = await row(t);
  expect('the exchange records who, what was sent, when and why', [approvedRow.status, approvedRow.reviewer_email, approvedRow.review_outcome, approvedRow.reviewed_answer === approvedRow.answer, approvedRow.review_note, approvedRow.reviewed_at !== null], ['reviewed', b.user.email, 'approved', true, 'The draft states the age rule correctly.', true]);
  expect('it leaves the queue', (await queueOf(b)).items.some((i) => i.traceId === t), false);
  expect('and a second review is refused (409)', (await review(b, t, { outcome: 'declined', note: 'again' })).status, 409);
  const approvedNote = (await noticesOf(x)).find((m) => m.includes(PERSONAL));
  expect('X is notified with the reviewed answer', [approvedNote?.startsWith('A case manager reviewed your policy question'), approvedNote?.includes(approvedRow.answer)], [true, true]);
  const approvedHistory = (await historyOf(x)).find((h) => h.traceId === t);
  expect(
    'and sees it in their history, marked as reviewed, with its citations',
    [approvedHistory.status, approvedHistory.answer === approvedRow.answer, approvedHistory.citations.length > 0, approvedHistory.reviewed?.outcome, typeof approvedHistory.reviewed?.at],
    ['reviewed', true, true, 'approved', 'string']
  );

  // 8. Correct: the correction replaces the draft, which the person never sees
  const correction = 'An appeal is made from the case page of a Denied case. The 45-day figure in the draft was wrong.';
  const corrected = await review(b, ungrounded.data.traceId, { outcome: 'corrected', answer: correction, note: 'The draft invented a deadline.' });
  expect('B corrects the ungrounded draft', [corrected.status, corrected.data.outcome], [200, 'corrected']);
  const correctedHistory = (await historyOf(x)).find((h) => h.traceId === ungrounded.data.traceId);
  expect('X sees the correction, marked as reviewed, without citations', [correctedHistory.status, correctedHistory.answer, correctedHistory.citations, correctedHistory.reviewed?.outcome], ['reviewed', correction, [], 'corrected']);
  expect('the withheld draft is nowhere in what X can read', JSON.stringify([await historyOf(x), await noticesOf(x)]).includes('Applicants have 45 days to reply'), false);
  expect('X is notified with the correction', (await noticesOf(x)).some((m) => m.includes(`and replied: ${correction}`)), true);
  expect('the stored row keeps the draft for the record, the correction as what was sent', [(await row(ungrounded.data.traceId)).answer.includes('45 days'), (await row(ungrounded.data.traceId)).reviewed_answer], [true, correction]);

  // 9. Decline: a reason instead of an answer
  const declined = await review(b, first.data.traceId, { outcome: 'declined', note: 'Needs the case file; I will phone.', answer: 'A case manager will phone you about the appeal deadline.' });
  expect('B declines the reported answer', [declined.status, declined.data.outcome], [200, 'declined']);
  const declinedHistory = (await historyOf(x)).find((h) => h.traceId === first.data.traceId);
  expect(
    'X sees a decline with the reason, no answer, marked as reviewed',
    [declinedHistory.status, declinedHistory.answer, declinedHistory.citations, declinedHistory.message, declinedHistory.reviewed?.outcome, declinedHistory.feedback],
    ['reviewed', null, [], 'A case manager reviewed this question and could not answer it here. A case manager will phone you about the appeal deadline.', 'declined', 'problem']
  );
  expect('X is notified', (await noticesOf(x)).some((m) => m.includes('could not answer it here. A case manager will phone you about the appeal deadline.')), true);
  expect('a reviewed answer cannot be rated (409)', (await feedback(x, first.data.traceId, { rating: 'helpful' })).status, 409);
  expect('Y, who asked nothing, has no notification and no history of it', [(await noticesOf(y)).some((m) => m.includes('reviewed your policy question')), (await historyOf(y)).length], [false, 0]);

  // 10. Audit: every step, never the question or the answer
  await sleep(800);
  const feedbackTrail = await trail(a, { action: 'AI_FEEDBACK', user: x.user.email });
  expect('feedback is audited: the rating, whether it was queued, never the comment', feedbackTrail.map((l) => [l.details.rating, l.details.queued]).sort(), [['helpful', false], ['not-helpful', false], ['problem', true]]);
  // B reviews in every run, so only this run's exchanges are looked at
  const thisRun = [t, ungrounded.data.traceId, first.data.traceId];
  const reviewTrail = (await trail(a, { action: 'AI_REVIEW', user: b.user.email })).filter((l) => thisRun.includes(l.resourceId));
  expect('reviews are audited: the outcome, the trace id and the note', reviewTrail.map((l) => [l.resourceId, l.details.outcome, l.details.note]).sort(), [
    [t, 'approved', 'The draft states the age rule correctly.'],
    [ungrounded.data.traceId, 'corrected', 'The draft invented a deadline.'],
    [first.data.traceId, 'declined', 'Needs the case file; I will phone.'],
  ].sort());
  const everything = JSON.stringify([feedbackTrail, reviewTrail]);
  expect('the log holds neither the questions, the draft, the correction nor the comment', [PERSONAL, GENERAL, 'senior exemption', '45-day', 'appeal deadline at all', 'Applicants have 45 days', SSN].filter((text) => everything.includes(text)), []);
  expect('every audit entry names its trace id', [...feedbackTrail, ...reviewTrail].every((l) => UUID.test(l.details.traceId) && l.details.traceId === l.resourceId), true);

  // 11. The latest reviews are listed for staff
  const recent = (await queueOf(a)).recentlyReviewed.filter((r) => [t, ungrounded.data.traceId, first.data.traceId].includes(r.traceId));
  expect('the latest reviews are listed with their outcome and reviewer, newest first', [recent.map((r) => r.outcome), recent.every((r) => r.reviewedBy === b.user.email), recent.find((r) => r.traceId === first.data.traceId).reported], [['declined', 'corrected', 'approved'], true, true]);

  await overrideRate(db, { a, b, admin, lead, y, people }, overridesBefore);
}

const overrideRateOf = async (viewer) => (await call('GET', '/dashboards/admin', viewer.token)).data.overrideRate;
const sourceOf = (report, name) => report.bySource.find((s) => s.source === name);
const delta = (after, before) => ({ reviewed: after.reviewed - before.reviewed, overrides: after.overrides - before.overrides });

/** STORY-024: what the three kinds of review add to the override rate, on both dashboards. */
async function overrideRate(db, { a, b, admin, lead, y, people }, before) {
  expect('before: three sources in a fixed order, twelve weeks, and the 20% target over 30 days', [before.bySource.map((s) => s.source), before.weeks.length, before.target, before.windowDays], [['assistant', 'compliance', 'eligibility'], 12, 20, 30]);

  // The assistant's three reviews above: one approved, one corrected, one declined
  const afterAssistant = await overrideRateOf(admin);
  expect('assistant: three reviewed, and the corrected and the declined are overrides', delta(sourceOf(afterAssistant, 'assistant'), sourceOf(before, 'assistant')), { reviewed: 3, overrides: 2 });
  expect('the other sources did not move', [delta(sourceOf(afterAssistant, 'compliance'), sourceOf(before, 'compliance')), delta(sourceOf(afterAssistant, 'eligibility'), sourceOf(before, 'eligibility'))], [{ reviewed: 0, overrides: 0 }, { reviewed: 0, overrides: 0 }]);
  expect('this week of the trend moved with them', delta(afterAssistant.weeks.at(-1), before.weeks.at(-1)), { reviewed: 3, overrides: 2 });

  // Case decisions. P1 is Type A and eligible: denied (against the result). P2: approved with proof of age (with it). P3 is Type B and
  // eligible when the case is opened, then earns too much to be: approved while Not Eligible (against it, and it fails two controls).
  // P4: approved without proof of age (with the result; fails a control). P5 is Type C, which the system sends to a person (Pending
  // Review): approved, and not counted either way.
  const applicant = async (label, profile = {}, dob) => {
    const person = await account(`override-${label}-${stamp}@example.com`, `Override ${label} ${stamp}`, dob);
    await call('PUT', `/users/${person.user.id}`, person.token, { phone: '555-0150', address: '1 Test Way', ...profile });
    people.push(person.user.id);
    return person;
  };
  const open = async (person, type) => (await call('POST', '/cases', person.token, { exemptionId: await exemptionId(person.token, type) })).data.id;
  const decide = async (caseId, status, reason) => {
    await call('PUT', `/cases/${caseId}/assignment`, a.token, { assignedTo: a.user.email });
    await call('POST', `/cases/${caseId}/status`, a.token, { status: 'In Review' });
    return call('POST', `/cases/${caseId}/status`, a.token, { status, reason });
  };
  const p1 = await applicant('p1');
  const p2 = await applicant('p2');
  const p3 = await applicant('p3', { annualIncome: 15000 }, '1990-01-01');
  const p4 = await applicant('p4');
  const p5 = await applicant('p5', { hasDocumentedHardship: true }, '1990-01-01');
  const [c1, c2, c3, c4, c5] = [await open(p1, 'Type A'), await open(p2, 'Type A'), await open(p3, 'Type B'), await open(p4, 'Type A'), await open(p5, 'Type C')];
  await call('PUT', `/users/${p3.user.id}`, p3.token, { annualIncome: 90000 });
  const statusOf = async (person, type) => (await call('GET', '/exemptions', person.token)).data.exemptions.find((e) => e.exemptionType === type).status;
  expect('P3 is now Not Eligible for Type B, P5 is Pending Review for Type C', [await statusOf(p3, 'Type B'), await statusOf(p5, 'Type C')], ['Not Eligible', 'Pending Review']);
  await call('POST', `/cases/${c2}/documents`, p2.token, { documentType: 'proof_of_age', documentUrl: 'https://example.com/birth.pdf' });
  await call('POST', `/cases/${c5}/documents`, p5.token, { documentType: 'hardship_evidence', documentUrl: 'https://example.com/hardship.pdf' });
  const decided = [(await decide(c1, 'Denied', 'Proof of age not provided.')).data.status, (await decide(c2, 'Approved')).data.status, (await decide(c3, 'Approved')).data.status, (await decide(c4, 'Approved')).data.status, (await decide(c5, 'Approved')).data.status];
  expect('the decisions are made', decided, ['Denied', 'Approved', 'Approved', 'Approved', 'Approved']);

  const kept = (await db.query(`SELECT c.id, e.eligibility_status FROM case_events e JOIN cases c ON c.id = e.case_id WHERE c.id = ANY($1::uuid[]) AND e.event_type = 'status_change' AND e.to_status IN ('Approved', 'Denied')`, [[c1, c2, c3, c4, c5]])).rows;
  expect('each decision keeps the eligibility result it was made against', [c1, c2, c3, c4, c5].map((id) => kept.find((k) => k.id === id).eligibility_status), ['Eligible', 'Eligible', 'Not Eligible', 'Eligible', 'Pending Review']);
  expect('other timeline events keep none', (await db.query(`SELECT COUNT(*)::int AS n FROM case_events WHERE case_id = ANY($1::uuid[]) AND eligibility_status IS NOT NULL AND NOT (event_type = 'status_change' AND to_status IN ('Approved', 'Denied'))`, [[c1, c2, c3, c4, c5]])).rows[0].n, 0);

  const afterDecisions = await overrideRateOf(admin);
  expect(
    'case decisions: four where the system had a result, two against it; the Pending Review one is not counted',
    delta(sourceOf(afterDecisions, 'eligibility'), sourceOf(afterAssistant, 'eligibility')),
    { reviewed: 4, overrides: 2 }
  );

  // Compliance: P3's approval failed controls (not eligible, no income statement), P4's failed the evidence control. B, who did not
  // decide them, accepts the exception on one (an override) and reopens the other (the failed control is upheld).
  const reviewOf = async (caseId) => (await call('GET', `/compliance/cases/${caseId}`, b.token)).data.reviews.find((r) => r.status === 'Open');
  const r3 = await reviewOf(c3);
  const r4 = await reviewOf(c4);
  expect('both approvals opened a compliance review', [r3?.failedControls.includes('CTRL-01'), r4?.failedControls.includes('CTRL-07')], [true, true]);
  expect("B accepts the exception on P3's", (await call('POST', `/compliance/reviews/${r3.id}/resolve`, b.token, { action: 'accept', note: 'Override rate suite: exception accepted.' })).status, 200);
  expect("B reopens P4's case", (await call('POST', `/compliance/reviews/${r4.id}/resolve`, b.token, { action: 'reopen', note: 'Override rate suite: reopened.' })).status, 200);
  const afterReviews = await overrideRateOf(admin);
  expect('compliance: two reviews resolved, one of them an accepted exception', delta(sourceOf(afterReviews, 'compliance'), sourceOf(afterDecisions, 'compliance')), { reviewed: 2, overrides: 1 });
  await sleep(700);
  expect('the accepted exception is the OVERRIDE audit action', (await trail(a, { action: 'OVERRIDE', resourceId: c3 })).length, 1);

  // The whole: every source adds up, and a correction moves the rate
  expect('all three together over the run: 3 + 4 + 2 reviewed, 2 + 2 + 1 overridden', delta(afterReviews, before), { reviewed: 9, overrides: 5 });
  expect('this week of the trend holds the same', delta(afterReviews.weeks.at(-1), before.weeks.at(-1)), { reviewed: 9, overrides: 5 });
  const rateOf = (report) => (report.reviewed ? Math.round((report.overrides / report.reviewed) * 10000) / 100 : null);
  expect('the rate is overrides over reviewed items: the whole, each source and each week', [rateOf(afterReviews) === afterReviews.rate, afterReviews.bySource.every((s) => rateOf(s) === s.rate), afterReviews.weeks.every((w) => rateOf(w) === w.rate)], [true, true, true]);
  expect('the sources add up to the whole', [afterReviews.bySource.reduce((n, s) => n + s.reviewed, 0), afterReviews.bySource.reduce((n, s) => n + s.overrides, 0)], [afterReviews.reviewed, afterReviews.overrides]);
  expect('the alert is raised exactly when the rate is at or over the 20% target, with its words', [afterReviews.alert, typeof afterReviews.alertMessage], afterReviews.rate !== null && afterReviews.rate >= 20 ? [true, 'string'] : [false, 'object']);

  const asked = await ask(y, PERSONAL);
  const correction = await review(b, asked.data.traceId, { outcome: 'corrected', answer: 'Eligibility is decided by a case manager from your case, not by this assistant.', note: 'Override rate suite: correction.' });
  expect('a correction is made', correction.status, 200);
  const afterCorrection = await overrideRateOf(admin);
  expect('the correction moved the override rate: one more reviewed, one more overridden', [delta(afterCorrection, afterReviews), rateOf(afterCorrection) === afterCorrection.rate], [{ reviewed: 1, overrides: 1 }, true]);
  expect('and the share went up (unless it was already 100%)', afterReviews.rate === 100 || afterCorrection.rate > afterReviews.rate, true);
  const later = await ask(y, `Will I be approved? ${stamp}`);
  await review(b, later.data.traceId, { outcome: 'approved', note: 'Override rate suite: approval.' });
  const afterApproval = await overrideRateOf(admin);
  expect('an approval adds a reviewed item and no override, so the share falls', [delta(afterApproval, afterCorrection), afterApproval.rate < afterCorrection.rate], [{ reviewed: 1, overrides: 0 }, true]);

  // Who sees it
  const leadership = (await call('GET', '/dashboards/leadership', lead.token)).data;
  expect('leadership sees the same report as the admin', JSON.stringify(leadership.overrideRate), JSON.stringify(await overrideRateOf(admin)));
  const shown = JSON.stringify(leadership.overrideRate);
  expect('and it holds counts and rates only: no email, no id, no question or answer', [/@/.test(shown), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(shown), shown.includes('senior exemption')], [false, false, false]);
  expect('a case manager and a citizen are still refused the admin dashboard that carries it', [(await call('GET', '/dashboards/admin', a.token)).status, (await call('GET', '/dashboards/admin', y.token)).status], [403, 403]);
}

/** The AI settings are part of the audited configuration: after a restart with another AI_MODEL, the change is in the log. */
async function modelChanged(model) {
  if (!model) throw new Error('Usage: node scripts/e2e/assistant-review.mjs --model-changed <the AI_MODEL the backend now runs with>');
  const a = await staffAccount(MANAGER, 'Manager Test');
  const changes = (await trail(a, { action: 'CONFIG_CHANGE' })).filter((l) => l.details.changed?.includes('AI_MODEL'));
  const latest = changes[0];
  expect('a CONFIG_CHANGE names AI_MODEL as changed', changes.length > 0, true);
  expect('it shows the old and the new model, and the new one is the model now running', [/^.+ → .+$/.test(latest?.details.AI_MODEL ?? ''), latest?.details.AI_MODEL?.endsWith(` → ${model}`)], [true, true]);
  expect('it is a system entry with no secret in it', [latest?.resource, latest?.status, JSON.stringify(latest).includes('sk-ant'), Object.keys(latest?.details ?? {}).includes('ANTHROPIC_API_KEY')], ['system', 'success', false, false]);
  console.log(`      ${latest?.timestamp}: AI_MODEL ${latest?.details.AI_MODEL}`);
}

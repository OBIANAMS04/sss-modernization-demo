// STORY-035: the staff training portal end to end (local backend only; see lib.mjs). Needs ADMIN_EMAILS to list
// morgan.lee@example.com, as for dashboards.mjs.
import { account, adminAccount, call, expect, leadershipAccount, run, stamp, staffAccount, MANAGER } from './lib.mjs';

run(async () => {
  const citizen = await account(`training-citizen-${stamp}@example.com`, 'Casey Citizen');
  const manager = await staffAccount(MANAGER, 'Morgan Manager');
  const admin = await adminAccount('morgan.lee@example.com', 'Morgan Lee');
  const leader = await leadershipAccount(`training-leader-${stamp}@example.com`, 'Lee Leader');

  // Citizens have no training
  expect('citizen: GET /training is refused', (await call('GET', '/training', citizen.token)).status, 403);
  expect('citizen: an attempt is refused', (await call('POST', '/training/case-work/attempts', citizen.token, { answers: {} })).status, 404);
  expect('citizen: team progress is refused', (await call('GET', '/training/progress', citizen.token)).status, 403);
  expect('anonymous: GET /training is refused', (await call('GET', '/training', null)).status, 401);

  // Each role gets its own modules, without the answers
  const mine = await call('GET', '/training', manager.token);
  expect('case manager: case work only', mine.data.modules?.map((m) => m.id), ['case-work']);
  expect('the page gets no answers', /"correct"|"explanation"/.test(JSON.stringify(mine.data)), false);
  expect('admin: case work and administration', (await call('GET', '/training', admin.token)).data.modules?.map((m) => m.id), ['case-work', 'administration']);
  expect('leadership: leadership', (await call('GET', '/training', leader.token)).data.modules?.map((m) => m.id), ['leadership']);
  expect('case manager: cannot take the administration module', (await call('POST', '/training/administration/attempts', manager.token, { answers: {} })).status, 404);
  expect('case manager: team progress is refused', (await call('GET', '/training/progress', manager.token)).status, 403);

  // Grading on the server
  const questions = mine.data.modules[0].questions;
  expect('an incomplete attempt is refused (400)', (await call('POST', '/training/case-work/attempts', manager.token, { answers: { [questions[0].id]: 0 } })).status, 400);
  const allZero = Object.fromEntries(questions.map((q) => [q.id, 0]));
  const first = await call('POST', '/training/case-work/attempts', manager.token, { answers: allZero });
  expect('a graded attempt says which answers were right, with explanations', [first.status, first.data.results?.length, first.data.results?.every((r) => r.explanation)], [201, 4, true]);
  const key = Object.fromEntries(first.data.results.map((r) => [r.questionId, r.correctOption]));
  const wrong = Object.fromEntries(questions.map((q) => [q.id, (key[q.id] + 1) % q.options.length]));
  const failed = await call('POST', '/training/case-work/attempts', manager.token, { answers: wrong });
  expect('all wrong: not passed', [failed.data.score, failed.data.passed], [0, false]);
  const passed = await call('POST', '/training/case-work/attempts', manager.token, { answers: key });
  expect('all right: passed', [passed.data.score, passed.data.passed], [4, true]);
  const after = (await call('GET', '/training', manager.token)).data.modules[0].status;
  expect('the module shows as passed, with every attempt counted', [after.passed, after.attempts, after.bestScore], [true, 3, 4]);

  // Administrators see the team
  const progress = await call('GET', '/training/progress', admin.token);
  const me = progress.data.people?.find((p) => p.email === MANAGER);
  expect("admin: team progress shows the case manager's pass", [me?.complete, me?.modules.map((m) => [m.moduleId, m.passed])], [true, [['case-work', true]]]);
  expect('admin: citizens are not in the team', progress.data.people?.some((p) => p.email === citizen.user.email), false);

  // Audited, without the answers
  const trail = await call('GET', `/audit/user/${manager.user.id}`, manager.token);
  const attempts = trail.data.logs.filter((e) => e.action === 'TRAINING_ATTEMPT');
  expect('every attempt is in the audit log with its score', attempts.length >= 3, true);
  expect('the audit entries carry the score, not the answers', attempts.every((e) => e.details && 'score' in e.details && !('answers' in e.details)), true);
});

// STORY-035: the training portal's rules. The database is mocked; the e2e suite (scripts/e2e/training.mjs) runs it for real.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));

import pool from '../database/connection';
import { AppError } from '../utils/errors';
import { PASS_MARK, getTeamProgress, getTraining, requiredModules, submitAttempt } from './trainingService';

const query = pool.query as jest.Mock;
beforeEach(() => query.mockReset().mockResolvedValue({ rows: [] }));

describe('who takes what', () => {
  it.each([
    ['citizen', []],
    ['case_manager', ['case-work']],
    ['admin', ['case-work', 'administration']],
    ['leadership', ['leadership']],
  ])('%s', (role, modules) => {
    expect(requiredModules(role as any)).toEqual(modules);
  });

  it('refuses a citizen (403)', async () => {
    await expect(getTraining('u1', 'citizen')).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('the page never gets the answers', () => {
  it('sends questions and options only', async () => {
    const training = await getTraining('u1', 'admin');
    const text = JSON.stringify(training);
    expect(training.modules.map((m) => m.id)).toEqual(['case-work', 'administration']);
    expect(text).not.toMatch(/"correct"|"explanation"/);
    for (const m of training.modules) {
      expect(m.questions).toHaveLength(4);
      expect(m.status).toMatchObject({ passed: false, attempts: 0 });
    }
  });
});

describe('grading on the server', () => {
  // The right answers, read from a graded attempt with every answer 0, which reports each question's correct option
  async function key(role: any, moduleId: string): Promise<Record<string, number>> {
    const r = await submitAttempt('u1', role, moduleId, { cw1: 0, cw2: 0, cw3: 0, cw4: 0, ad1: 0, ad2: 0, ad3: 0, ad4: 0, ld1: 0, ld2: 0, ld3: 0, ld4: 0 });
    query.mockClear();
    return Object.fromEntries(r.results.map((x) => [x.questionId, x.correctOption]));
  }

  it('passes with all right, records the attempt with the module version', async () => {
    const answers = await key('case_manager', 'case-work');
    const result = await submitAttempt('u1', 'case_manager', 'case-work', answers);
    expect(result).toMatchObject({ score: 4, total: 4, passed: true, passMark: PASS_MARK, version: 1 });
    expect(query.mock.calls[0][1]).toEqual(['u1', 'case-work', 1, 4, 4, true]);
  });

  it('passes at three of four and fails at two, with an explanation for every question', async () => {
    const answers = await key('leadership', 'leadership');
    const wrong = (n: number) => ({ ...answers, [`ld${n}`]: (answers[`ld${n}`] + 1) % 4 });
    expect((await submitAttempt('u1', 'leadership', 'leadership', wrong(1))).passed).toBe(true);
    const failed = await submitAttempt('u1', 'leadership', 'leadership', { ...wrong(1), ld2: (answers.ld2 + 1) % 4 });
    expect([failed.score, failed.passed]).toEqual([2, false]);
    expect(failed.results.every((r) => r.explanation.length > 10)).toBe(true);
  });

  it('refuses a module outside the role, and incomplete or malformed answers', async () => {
    await expect(submitAttempt('u1', 'case_manager', 'administration', {})).rejects.toMatchObject({ statusCode: 404 });
    await expect(submitAttempt('u1', 'citizen', 'case-work', {})).rejects.toMatchObject({ statusCode: 404 });
    for (const bad of [null, [], { cw1: 0 }, { cw1: 9, cw2: 0, cw3: 0, cw4: 0 }, { cw1: '1', cw2: 0, cw3: 0, cw4: 0 }]) {
      await expect(submitAttempt('u1', 'case_manager', 'case-work', bad)).rejects.toBeInstanceOf(AppError);
    }
    expect(query).not.toHaveBeenCalled();
  });
});

describe('progress', () => {
  it('counts only passes of the current version', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { user_id: 'u1', module_id: 'case-work', module_version: 0, attempts: 2, best: 4, passed_at: '2026-01-01T00:00:00Z' },
        { user_id: 'u1', module_id: 'administration', module_version: 1, attempts: 1, best: 3, passed_at: '2026-10-27T10:00:00Z' },
      ],
    });
    const training = await getTraining('u1', 'admin');
    expect(training.modules.map((m) => [m.id, m.status?.passed])).toEqual([['case-work', false], ['administration', true]]);
  });

  it("shows each staff and leadership member's required modules, complete only when all are passed", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'a', email: 'a@example.com', full_name: 'A', role: 'admin' }, { id: 'l', email: 'l@example.com', full_name: 'L', role: 'leadership' }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'l', module_id: 'leadership', module_version: 1, attempts: 1, best: 4, passed_at: '2026-10-27T10:00:00Z' }] });
    const progress = await getTeamProgress();
    expect(progress.people.map((p) => [p.email, p.modules.map((m) => m.moduleId), p.complete])).toEqual([
      ['a@example.com', ['case-work', 'administration'], false],
      ['l@example.com', ['leadership'], true],
    ]);
  });
});

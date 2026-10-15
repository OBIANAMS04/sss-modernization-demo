// STORY-023 (backend): the level an answer gets. Pure, so no model and no database.
import { MIN_COVERAGE, MIN_SOURCES, isPersonalQuestion, levelFor } from './oversightLevel';

const grounding = (over: Partial<{ grounded: boolean; coverage: number; citedPassages: string[] }> = {}) => ({
  grounded: true,
  coverage: 1,
  citedPassages: ['a:one', 'b:two'],
  ...over,
});
const GENERAL = 'How do I appeal a denial?';

describe('isPersonalQuestion', () => {
  it.each([
    'Am I eligible for the senior exemption?',
    'am i exempt',
    "I'm 70 years old, which exemption applies?",
    'I am 68. What do I do?',
    'I make $15,000 a year. What happens next?',
    'Will I be approved for Type B?',
    'Do I qualify for Type A?',
    'Would my application be approved if I attach an income statement?',
    'Can I get the exemption?',
    'What is my case status?',
    'Why was my application denied?',
    'Why was I denied?',
    'Has my appeal been decided yet?',
    'what is the result of my own eligibility check',
  ])('is true for %s', (question) => {
    expect(isPersonalQuestion(question)).toBe(true);
  });

  it.each([
    GENERAL,
    'Who qualifies for the senior exemption?',
    'What proof do I need to be approved for Type A?',
    'Can I open a second case for the same exemption?',
    'What result do I get for Type B if I have no income on file?',
    'Does the eligibility reason show my exact income?',
    'Is my Social Security number stored in the system?',
    'Does Pending Review mean my hardship exemption is approved?',
    'What does CTRL-04 check?',
    'How is Type A eligibility worked out?',
    'What do I need to create an account?',
  ])('is false for the general question %s', (question) => {
    expect(isPersonalQuestion(question)).toBe(false);
  });

  it('reads curly apostrophes, capitals and extra spaces', () => {
    expect(isPersonalQuestion('I’m   70, what applies?')).toBe(true);
    expect(isPersonalQuestion('AM   I   EXEMPT?')).toBe(true);
  });

  it('treats none of the golden questions as personal, so the evaluation measures answers and not routing', () => {
    const golden = require('../../policy-docs/golden.json') as { questions: { id: string; question: string }[] };
    expect(golden.questions.filter((q) => isPersonalQuestion(q.question)).map((q) => q.id)).toEqual([]);
  });
});

describe('levelFor', () => {
  it('is 0 for a grounded answer on two sources with full coverage', () => {
    expect(levelFor(GENERAL, grounding())).toEqual({ level: 0, reasons: ['ok'] });
  });

  it('is 2 when the answer is not grounded, whatever the question', () => {
    expect(levelFor(GENERAL, grounding({ grounded: false }))).toEqual({ level: 2, reasons: ['ungrounded'] });
  });

  it("is 2 for a question about the person's own eligibility or case, even when the answer is grounded", () => {
    expect(levelFor('Am I eligible for Type A?', grounding())).toEqual({ level: 2, reasons: ['personal-question'] });
  });

  it('names both reasons when an ungrounded answer answers a personal question', () => {
    expect(levelFor('Will I be approved?', grounding({ grounded: false }))).toEqual({ level: 2, reasons: ['ungrounded', 'personal-question'] });
  });

  it('is 1 when a grounded answer cites fewer than two distinct passages', () => {
    expect(MIN_SOURCES).toBe(2);
    expect(levelFor(GENERAL, grounding({ citedPassages: ['a:one'] }))).toEqual({ level: 1, reasons: ['few-sources'] });
    expect(levelFor(GENERAL, grounding({ citedPassages: [] }))).toEqual({ level: 1, reasons: ['few-sources'] });
  });

  it('is 1 when coverage is below 0.9, and 0 at exactly 0.9', () => {
    expect(MIN_COVERAGE).toBe(0.9);
    expect(levelFor(GENERAL, grounding({ coverage: 0.899 }))).toEqual({ level: 1, reasons: ['low-coverage'] });
    expect(levelFor(GENERAL, grounding({ coverage: 0.9 })).level).toBe(0);
  });

  it('names both reasons when the ground is thin in both ways', () => {
    expect(levelFor(GENERAL, grounding({ citedPassages: ['a:one'], coverage: 0.5 }))).toEqual({ level: 1, reasons: ['few-sources', 'low-coverage'] });
  });

  it('puts withholding before thin ground: a personal question with one source is 2, not 1', () => {
    expect(levelFor('Am I exempt?', grounding({ citedPassages: ['a:one'] })).level).toBe(2);
  });
});

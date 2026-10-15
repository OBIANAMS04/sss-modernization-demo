// STORY-022: the grounding check is a pure function, so these tests need no model and no database.
import { AnswerSegment, GroundingPassage, checkGrounding, extractMonths, extractNumbers, splitSentences } from './groundingCheck';

const TYPE_A: GroundingPassage = {
  id: 'exemption-type-a:who-qualifies',
  body: 'A registrant qualifies for Type A when they are 65 years old or older. Age is worked out in whole years from the date of birth on the profile. A registrant who is 64 does not qualify.',
};
const TYPE_B: GroundingPassage = {
  id: 'exemption-type-b:who-qualifies-the-income-limit',
  body: 'A registrant qualifies for Type B when the annual income on the profile is below $20,000. An annual income of $20,000 or more does not qualify. The income is a whole number of dollars.',
};
const APPEAL: GroundingPassage = {
  id: 'appeals:how-to-appeal',
  body: 'Open the case from the Cases page. On a Denied case, select Appeal this decision and confirm. The appeal is made on the same case.',
};
const DATES: GroundingPassage = {
  id: 'sample:dates',
  body: 'The review was held on October 15, 2026. The next review is 3 months later, and the report has 12 pages.',
};
const RETRIEVED = [TYPE_A, TYPE_B, APPEAL, DATES];

const A_QUOTE = 'A registrant qualifies for Type A when they are 65 years old or older.';
const B_QUOTE = 'A registrant qualifies for Type B when the annual income on the profile is below $20,000.';
const APPEAL_QUOTE = 'On a Denied case, select Appeal this decision and confirm.';

/** A piece of the answer, with the citations it came with: [passage id, quote] pairs. */
const seg = (text: string, ...cites: [string | null, string][]): AnswerSegment => ({
  text,
  citations: cites.map(([passageId, quote]) => ({ passageId, quote })),
});

describe('checkGrounding: a grounded answer', () => {
  it('passes when every sentence is cited, every number is in the cited text and every citation is valid', () => {
    const result = checkGrounding(
      [
        seg('Type A is for registrants who are 65 or older', [TYPE_A.id, A_QUOTE]),
        seg('. '),
        seg('Type B is for an annual income below $20,000', [TYPE_B.id, B_QUOTE]),
        seg('.'),
      ],
      RETRIEVED
    );
    expect(result).toEqual({ grounded: true, unsupported: [], coverage: 1, sentences: 2, citedPassages: [TYPE_A.id, TYPE_B.id] });
  });

  it('counts a passage once however often it is cited, in the order it first appears', () => {
    const result = checkGrounding(
      [
        seg('Select Appeal this decision and confirm', [APPEAL.id, APPEAL_QUOTE]),
        seg('. '),
        seg('The appeal is made on the same case', [APPEAL.id, 'The appeal is made on the same case.']),
        seg('. '),
        seg('A registrant of 65 or older qualifies for Type A', [TYPE_A.id, A_QUOTE]),
        seg('.'),
      ],
      RETRIEVED
    );
    expect(result.citedPassages).toEqual([APPEAL.id, TYPE_A.id]);
    expect(result.grounded).toBe(true);
  });

  it('reports coverage as the share of the answer under a citation', () => {
    const result = checkGrounding(
      [seg('According to the policy, '), seg('a registrant qualifies for Type A at 65', [TYPE_A.id, A_QUOTE]), seg('.')],
      RETRIEVED
    );
    expect(result.grounded).toBe(true); // the sentence is mostly cited
    expect(result.coverage).toBeGreaterThan(0.6);
    expect(result.coverage).toBeLessThan(0.9);
  });
});

describe('checkGrounding: every sentence needs a citation', () => {
  it('flags a sentence that no citation covers', () => {
    const result = checkGrounding(
      [seg('Type A is for registrants who are 65 or older', [TYPE_A.id, A_QUOTE]), seg('. '), seg('Call the helpline if you are unsure.')],
      RETRIEVED
    );
    expect(result.grounded).toBe(false);
    expect(result.unsupported).toEqual([{ type: 'uncited-sentence', text: 'Call the helpline if you are unsure.' }]);
    expect(result.coverage).toBeLessThan(0.9);
  });

  it('flags every sentence of an answer that cites nothing', () => {
    const result = checkGrounding([seg('Type A is for senior registrants. It is decided by a rule.')], RETRIEVED);
    expect(result.unsupported.map((u) => u.type)).toEqual(['uncited-sentence', 'uncited-sentence']);
    expect(result.coverage).toBe(0);
    expect(result.citedPassages).toEqual([]);
  });

  it('counts a sentence as covered when citations cover at least half of it, and not when they cover less', () => {
    const mostly = checkGrounding([seg('So then, '), seg('a registrant qualifies for Type A at 65', [TYPE_A.id, A_QUOTE]), seg('.')], RETRIEVED);
    const barely = checkGrounding(
      [seg('As the leaflet explains to every single registrant who asks about it, the answer is '), seg('65', [TYPE_A.id, A_QUOTE]), seg('.')],
      RETRIEVED
    );
    expect(mostly.grounded).toBe(true);
    expect(barely.unsupported.map((u) => u.type)).toEqual(['uncited-sentence']);
  });

  it('finds the sentences of a list, one per line, without counting the list numbers or bullets', () => {
    const result = checkGrounding(
      [
        seg('Type A: a registrant of 65 or older qualifies', [TYPE_A.id, A_QUOTE]),
        seg('\n'),
        seg('Type B: income below $20,000 qualifies', [TYPE_B.id, B_QUOTE]),
        seg('\n'),
      ],
      RETRIEVED
    );
    expect(result.sentences).toBe(2);
    expect(result.grounded).toBe(true);

    const numbered = checkGrounding(
      [seg('1. Select Appeal this decision and confirm', [APPEAL.id, APPEAL_QUOTE]), seg('\n'), seg('- The appeal is made on the same case', [APPEAL.id, 'The appeal is made on the same case.'])],
      RETRIEVED
    );
    expect(numbered).toMatchObject({ grounded: true, sentences: 2 });
  });
});

describe('checkGrounding: every number, date or amount needs support', () => {
  const answer = (text: string, passage = TYPE_B, quote = B_QUOTE) => checkGrounding([seg(text, [passage.id, quote]), seg('.')], RETRIEVED);

  it('flags a number that no cited text contains', () => {
    const result = answer('A registrant qualifies for Type B when the annual income is below $25,000');
    expect(result.unsupported).toEqual([{ type: 'unsupported-number', text: '25000' }]);
    expect(result.grounded).toBe(false);
  });

  it('accepts a number that is in the cited passage though not in the cited quote', () => {
    // 64 is in the same passage as the quote, in another sentence
    const result = checkGrounding([seg('A registrant of 64 does not qualify for Type A, but one of 65 does', [TYPE_A.id, A_QUOTE]), seg('.')], RETRIEVED);
    expect(result.unsupported).toEqual([]);
  });

  it('flags a number that is only in a passage that was retrieved but not cited', () => {
    const result = answer('A registrant qualifies for Type B when the annual income is below $20,000, from the age of 65');
    expect(result.unsupported).toEqual([{ type: 'unsupported-number', text: '65' }]);
  });

  it('reads $20,000, 20000 and 20,000.00 as the same amount', () => {
    for (const written of ['$20,000', '20000', '20,000.00', '$20,000.']) {
      expect(answer(`A registrant qualifies for Type B when the annual income is below ${written}`).unsupported).toEqual([]);
    }
  });

  it('reads a number written as words like the same number in digits', () => {
    expect(checkGrounding([seg('A registrant of sixty-five qualifies for Type A', [TYPE_A.id, A_QUOTE]), seg('.')], RETRIEVED).unsupported).toEqual([]);
    expect(checkGrounding([seg('A registrant of seventy qualifies for Type A', [TYPE_A.id, A_QUOTE]), seg('.')], RETRIEVED).unsupported).toEqual([
      { type: 'unsupported-number', text: '70' },
    ]);
  });

  it('flags a date whose month or day is not in the cited text, and accepts one that is', () => {
    const quote = 'The review was held on October 15, 2026.';
    expect(checkGrounding([seg('The review was held on October 15, 2026', [DATES.id, quote]), seg('.')], RETRIEVED).unsupported).toEqual([]);
    const wrong = checkGrounding([seg('The review was held on November 15, 2026', [DATES.id, quote]), seg('.')], RETRIEVED);
    expect(wrong.unsupported).toEqual([{ type: 'unsupported-number', text: 'november' }]);
    const wrongDay = checkGrounding([seg('The review was held on October 16, 2026', [DATES.id, quote]), seg('.')], RETRIEVED);
    expect(wrongDay.unsupported).toEqual([{ type: 'unsupported-number', text: '16' }]);
  });

  it('reports the same unsupported number once', () => {
    const result = answer('The limit is $25,000, and $25,000 is also the figure for a couple');
    expect(result.unsupported.filter((u) => u.type === 'unsupported-number')).toHaveLength(1);
  });

  it('does not count a citation marker or a list number as a number', () => {
    const result = checkGrounding(
      [seg('1. A registrant qualifies for Type A at 65 or older [1]', [TYPE_A.id, A_QUOTE]), seg('.')],
      RETRIEVED
    );
    expect(result.unsupported).toEqual([]);
  });
});

describe('checkGrounding: every citation must be valid', () => {
  it('flags a citation of a passage that was not retrieved, and counts nothing it supports', () => {
    const result = checkGrounding([seg('Type A is for registrants who are 65 or older', ['exemption-type-z:made-up', A_QUOTE]), seg('.')], RETRIEVED);
    expect(result.grounded).toBe(false);
    expect(result.unsupported[0]).toEqual({ type: 'invalid-citation', text: 'exemption-type-z:made-up was not among the passages retrieved' });
    expect(result.unsupported.some((u) => u.type === 'uncited-sentence')).toBe(true); // an invalid citation covers nothing
    expect(result.citedPassages).toEqual([]);
  });

  it('flags a citation that points at no document we sent', () => {
    const result = checkGrounding([seg('Type A is for registrants who are 65 or older', [null, A_QUOTE]), seg('.')], RETRIEVED);
    expect(result.unsupported[0]).toEqual({ type: 'invalid-citation', text: 'a document that was not sent was not among the passages retrieved' });
  });

  it('flags a quote that is not in the passage it names', () => {
    const result = checkGrounding([seg('Type A is for registrants who are 65 or older', [TYPE_A.id, 'Everyone over 50 qualifies for Type A.']), seg('.')], RETRIEVED);
    expect(result.unsupported[0]).toEqual({ type: 'invalid-citation', text: `${TYPE_A.id}: the quote is not in the passage` });
    expect(result.grounded).toBe(false);
  });

  it('accepts a quote that differs from the passage only in spacing and case', () => {
    const result = checkGrounding([seg('Type A is for registrants who are 65 or older', [TYPE_A.id, '  a registrant qualifies for TYPE A\nwhen they are 65 years old or older. ']), seg('.')], RETRIEVED);
    expect(result.grounded).toBe(true);
  });

  it('still counts a segment as cited when one of its citations is valid, and reports the bad one', () => {
    const result = checkGrounding([seg('Type A is for registrants who are 65 or older', [TYPE_A.id, A_QUOTE], ['nowhere:nothing', 'x']), seg('.')], RETRIEVED);
    expect(result.unsupported.map((u) => u.type)).toEqual(['invalid-citation']);
    expect(result.citedPassages).toEqual([TYPE_A.id]);
  });
});

describe('checkGrounding: nothing to check', () => {
  it('does not ground an empty answer', () => {
    for (const text of ['', '   ', '\n\n', '...']) {
      const result = checkGrounding([seg(text)], RETRIEVED);
      expect(result).toMatchObject({ grounded: false, coverage: 0, sentences: 0, unsupported: [{ type: 'empty-answer', text: '' }] });
    }
    expect(checkGrounding([], RETRIEVED).grounded).toBe(false);
  });
});

describe('splitSentences', () => {
  const texts = (input: string) => splitSentences(input).map((s) => s.text);

  it('splits at full stops, question marks and exclamation marks, and keeps where each sentence sits', () => {
    const input = 'First one. Second one? Third one!';
    expect(texts(input)).toEqual(['First one.', 'Second one?', 'Third one!']);
    for (const s of splitSentences(input)) expect(input.slice(s.start, s.end)).toBe(s.text);
  });

  it('does not split inside a decimal, an amount, an abbreviation or a dotted initialism', () => {
    expect(texts('The rate is 99.5% for all. Pay $20,000.50 or less.')).toEqual(['The rate is 99.5% for all.', 'Pay $20,000.50 or less.']);
    expect(texts('Use the U.S. form, e.g. the long one. Then sign.')).toEqual(['Use the U.S. form, e.g. the long one.', 'Then sign.']);
  });

  it('splits after "Type A." because a single capital letter is not an abbreviation', () => {
    expect(texts('This is Type A. Type B is different.')).toEqual(['This is Type A.', 'Type B is different.']);
  });

  it('keeps a closing quote or bracket with its sentence', () => {
    expect(texts('He said "stop." Then left (quickly). Done.')).toEqual(['He said "stop."', 'Then left (quickly).', 'Done.']);
  });

  it('makes one sentence of each line, without list markers, and joins a line ending in a colon to the lines after it', () => {
    expect(texts('Intro line\n- First item\n* Second item\n1. Third item\n2) Fourth item')).toEqual([
      'Intro line',
      'First item',
      'Second item',
      'Third item',
      'Fourth item',
    ]);
    expect(texts('The statuses are:\nDraft and Submitted.')).toEqual(['The statuses are:\nDraft and Submitted.']);
  });

  it('does not take a list number for a sentence', () => {
    expect(texts('1. First.\n2. Second.')).toEqual(['First.', 'Second.']);
  });
});

describe('extractNumbers', () => {
  it('finds digits, amounts, percentages, decimals and years, as canonical strings in order', () => {
    expect(extractNumbers('Pay $20,000 or 99.5% by 2026, on day 05, not 3.50 or 7,')).toEqual(['20000', '99.5', '2026', '5', '3.5', '7']);
  });

  it('finds numbers written as words from two to ninety-nine, with hundred or thousand after them', () => {
    expect(extractNumbers('sixty-five, Twenty one, eight, ten, thirty, two hundred, five thousand, zero')).toEqual(['65', '21', '8', '10', '30', '200', '5000', '0']);
  });

  it('does not take "one" on its own for a number, or a citation marker for one', () => {
    expect(extractNumbers('No one else, one case [1] and [23]')).toEqual([]);
  });

  it('keeps each part of a range or an identifier', () => {
    expect(extractNumbers('5-10 days, CTRL-04, 2026-10-15')).toEqual(['5', '10', '4', '2026', '10', '15']);
  });
});

describe('extractMonths', () => {
  it('finds the months named in dates, but not the verb "may"', () => {
    expect(extractMonths('On October 15, 2026 and 3 March, and in December 2027')).toEqual(['october', 'december', 'march']);
    expect(extractMonths('You may apply. May I ask? In may, maybe.')).toEqual([]);
  });
});

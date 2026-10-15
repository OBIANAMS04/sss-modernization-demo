// STORY-022: the check every assistant answer goes through before a person can see it. It is a pure function of the answer, its
// citations and the passages the assistant was given, so it can be tested without a model or a database. An answer is grounded when
//   1. every sentence is covered by a citation,
//   2. every number, date or dollar amount in it appears in a cited quote or a cited passage, and
//   3. every cited passage was among the passages retrieved for the question (and the quote is really in it).

/** A piece of the answer as the model returned it, with the citations that came with it (none for connecting words). */
export interface AnswerSegment {
  text: string;
  citations: SegmentCitation[];
}

export interface SegmentCitation {
  /** null when the citation points at nothing we sent. */
  passageId: string | null;
  quote: string;
}

/** A passage the assistant was given. */
export interface GroundingPassage {
  id: string;
  body: string;
}

export type UnsupportedType = 'uncited-sentence' | 'unsupported-number' | 'invalid-citation' | 'empty-answer';

export interface Unsupported {
  type: UnsupportedType;
  /** The sentence, the number as written, or what is wrong with the citation. */
  text: string;
}

export interface GroundingResult {
  grounded: boolean;
  /** Everything that failed the check; empty when the answer is grounded. */
  unsupported: Unsupported[];
  /** The share of the answer's letters and digits that sit inside a cited part of the answer, 0 to 1. */
  coverage: number;
  sentences: number;
  /** The distinct passages the answer cites (valid citations only), in the order they first appear. */
  citedPassages: string[];
}

/** A sentence counts as covered when citations cover at least this share of its letters and digits. */
export const MIN_SENTENCE_COVERAGE = 0.5;

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

// A full stop after one of these does not end a sentence. A single capital letter is not listed: "Type A. The case ..." ends one.
const ABBREVIATIONS = new Set(['e.g', 'i.e', 'etc', 'vs', 'dr', 'mr', 'mrs', 'ms', 'u.s', 'st', 'inc', 'approx', 'incl']);
const LIST_MARKER = /^(?:[-*•>#]+\s+|\d+[.)]\s+)/;

/**
 * Splits text into sentences, keeping where each one sits in the text. A sentence ends at . ! or ? followed by a space or the end,
 * and at a line break (list items), but not inside a decimal, an abbreviation, a list number or after a line that ends with ":".
 */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  const push = (from: number, to: number) => {
    let a = from;
    let b = to;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    const marker = LIST_MARKER.exec(text.slice(a, b));
    if (marker) a += marker[0].length;
    if (a < b) sentences.push({ text: text.slice(a, b), start: a, end: b });
  };

  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      if (!text.slice(start, i).trimEnd().endsWith(':')) {
        push(start, i);
        start = i + 1;
      }
      continue;
    }
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    let end = i + 1;
    while (end < text.length && /["')\]]/.test(text[end])) end++;
    if (end < text.length && !/\s/.test(text[end])) continue; // a decimal point, a dotted abbreviation or a file name
    const before = text.slice(start, i);
    if (ch === '.' && /^\s*(?:[-*•]\s*)?\d+$/.test(before)) continue; // the "1." that numbers a list item
    const word = /([A-Za-z.]+)$/.exec(before)?.[1].toLowerCase();
    if (ch === '.' && word && ABBREVIATIONS.has(word)) continue;
    push(start, end);
    start = end;
    i = end - 1;
  }
  push(start, text.length);
  return sentences;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_PATTERN = MONTHS.join('|');
const UNITS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
// "one" counts only after a tens word (twenty-one): on its own it is as often a pronoun as a number. "zero" is a number.
const WORD_NUMBER = new RegExp(
  `\\b(?:(${Object.keys(TENS).join('|')})(?:[- ](${Object.keys(ONES).join('|')}))?|(${Object.keys(UNITS).join('|')}|zero))(?: (hundred|thousand))?\\b`,
  'gi'
);

/** A number as one string, so "$20,000", "20000" and "20,000.00" are the same: no commas, no leading zeros, no empty decimals. */
function canonical(raw: string): string {
  const [whole, fraction = ''] = raw.replace(/,/g, '').split('.');
  const digits = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  return decimals ? `${digits}.${decimals}` : digits;
}

/**
 * Every number in the text, as canonical strings in the order they appear (repeats kept): digits with commas or a decimal point
 * ($20,000, 99%, 3.5, 2026), and numbers written as words from two to ninety-nine, with "hundred" or "thousand" after them.
 * A citation marker such as [1] is not a number.
 */
export function extractNumbers(text: string): string[] {
  const clean = text.replace(/\[\d+\]/g, ' ');
  const found: { at: number; value: string }[] = [];
  for (const m of clean.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    found.push({ at: m.index!, value: canonical(m[0].replace(/,+$/, '')) });
  }
  for (const m of clean.matchAll(WORD_NUMBER)) {
    let value = m[1] ? TENS[m[1].toLowerCase()] + (m[2] ? ONES[m[2].toLowerCase()] : 0) : m[3].toLowerCase() === 'zero' ? 0 : UNITS[m[3].toLowerCase()];
    if (m[4]) value *= m[4].toLowerCase() === 'hundred' ? 100 : 1000;
    found.push({ at: m.index!, value: String(value) });
  }
  return found.sort((a, b) => a.at - b.at).map((n) => n.value);
}

/** The months named in dates ("October 15", "15 October"); a bare "may" is a verb, not a month. */
export function extractMonths(text: string): string[] {
  const months = new Set<string>();
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_PATTERN})\\s+\\d`, 'gi'))) months.add(m[1].toLowerCase());
  for (const m of text.matchAll(new RegExp(`\\d\\s+(${MONTH_PATTERN})\\b`, 'gi'))) months.add(m[1].toLowerCase());
  return [...months];
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();
const isLetterOrDigit = (ch: string): boolean => /[\p{L}\p{N}]/u.test(ch);
const countLetters = (text: string): number => [...text].filter(isLetterOrDigit).length;

/** Checks an answer against the passages the assistant was given. */
export function checkGrounding(segments: AnswerSegment[], retrieved: GroundingPassage[]): GroundingResult {
  const unsupported: Unsupported[] = [];
  const passages = new Map(retrieved.map((p) => [p.id, squash(p.body)]));
  const answer = segments.map((s) => s.text).join('');

  // 3. Every citation names a passage that was retrieved and quotes text that is really in it
  const seenInvalid = new Set<string>();
  const cited = new Set<string>();
  const citedSpans: [number, number][] = [];
  const quotes: string[] = [];
  let offset = 0;
  for (const segment of segments) {
    const valid: SegmentCitation[] = [];
    for (const citation of segment.citations) {
      const body = citation.passageId === null ? undefined : passages.get(citation.passageId);
      const reason =
        body === undefined ? `${citation.passageId ?? 'a document that was not sent'} was not among the passages retrieved` : !body.includes(squash(citation.quote)) ? `${citation.passageId}: the quote is not in the passage` : null;
      if (reason) {
        if (!seenInvalid.has(reason)) unsupported.push({ type: 'invalid-citation', text: reason });
        seenInvalid.add(reason);
        continue;
      }
      valid.push(citation);
      cited.add(citation.passageId!);
      quotes.push(citation.quote);
    }
    if (valid.length > 0) citedSpans.push([offset, offset + segment.text.length]);
    offset += segment.text.length;
  }

  // 1. Every sentence is covered by a citation
  const sentences = splitSentences(answer).filter((s) => countLetters(s.text) > 0);
  if (sentences.length === 0) unsupported.push({ type: 'empty-answer', text: '' });
  const inCitedSpan = (index: number) => citedSpans.some(([from, to]) => index >= from && index < to);
  let letters = 0;
  let citedLetters = 0;
  for (const sentence of sentences) {
    let own = 0;
    let ownCited = 0;
    for (let i = sentence.start; i < sentence.end; i++) {
      if (!isLetterOrDigit(answer[i])) continue;
      own++;
      if (inCitedSpan(i)) ownCited++;
    }
    letters += own;
    citedLetters += ownCited;
    if (ownCited / own < MIN_SENTENCE_COVERAGE) unsupported.push({ type: 'uncited-sentence', text: sentence.text });
  }

  // 2. Every number, date or amount appears in the cited text
  const support = [...quotes, ...retrieved.filter((p) => cited.has(p.id)).map((p) => p.body)].join('\n');
  const supportNumbers = new Set(extractNumbers(support));
  const reported = new Set<string>();
  for (const value of extractNumbers(sentences.map((s) => s.text).join('\n'))) {
    if (supportNumbers.has(value) || reported.has(value)) continue;
    reported.add(value);
    unsupported.push({ type: 'unsupported-number', text: value });
  }
  for (const month of extractMonths(answer)) {
    if (!new RegExp(`\\b${month}\\b`, 'i').test(support)) unsupported.push({ type: 'unsupported-number', text: month });
  }

  return {
    grounded: unsupported.length === 0,
    unsupported,
    coverage: letters === 0 ? 0 : Math.round((citedLetters / letters) * 1000) / 1000,
    sentences: sentences.length,
    citedPassages: [...cited],
  };
}

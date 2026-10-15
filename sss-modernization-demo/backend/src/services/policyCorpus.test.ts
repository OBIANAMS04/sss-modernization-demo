// STORY-017: splitting the policy documents into passages, and keeping the stored passages in line with the files.
// Runs without a database: the mocks below keep what the ingestion would have written.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('./caseEvents', () => ({ inTransaction: jest.fn() }));
jest.mock('./auditService', () => ({ ...jest.requireActual('./auditService'), logAuditEvent: jest.fn() }));

import pool from '../database/connection';
import { logAuditEvent, sanitizeDetails } from './auditService';
import { inTransaction } from './caseEvents';
import { MAX_PASSAGE_CHARS, chunkDocument, contentHash, getCorpusInfo, ingestPolicyDocs, readPolicyDocs, searchPassages, slugify } from './policyCorpus';

const query = pool.query as unknown as jest.Mock;
const audit = logAuditEvent as jest.Mock;
const transaction = inTransaction as jest.Mock;
const client = { query: jest.fn() };

const NOTICE = '> Illustrative demo policy for a synthetic deployment. This is not Selective Service System policy.';
const doc = (...parts: string[]) => [NOTICE, '', ...parts].join('\n');

beforeEach(() => {
  query.mockReset();
  audit.mockReset();
  client.query.mockReset();
  transaction.mockReset().mockImplementation(async (work: (c: typeof client) => Promise<unknown>) => work(client));
});

describe('slugify', () => {
  it('makes a short lower-case id from a heading', () => {
    expect(slugify('Exemption Type A: senior (65 or older)')).toBe('exemption-type-a-senior-65-or-older');
    expect(slugify('  How to apply!  ')).toBe('how-to-apply');
    expect(slugify('???')).toBe('section');
  });

  it('keeps ids to 60 characters without a trailing dash', () => {
    const slug = slugify('word '.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('chunkDocument (STORY-017)', () => {
  it('puts the text under the title in one passage and each "##" section in its own, in order', () => {
    const { title, passages } = chunkDocument(
      'sample',
      doc('# Sample title', '', 'Intro sentence.', '', '## First part', 'First body.', '', '## Second part', 'Second body.', 'Second line.')
    );
    expect(title).toBe('Sample title');
    expect(passages.map((p) => [p.id, p.heading, p.position, p.body])).toEqual([
      ['sample:sample-title', 'Sample title', 0, 'Intro sentence.'],
      ['sample:first-part', 'First part', 1, 'First body.'],
      ['sample:second-part', 'Second part', 2, 'Second body.\nSecond line.'],
    ]);
    expect(passages.every((p) => p.docSlug === 'sample' && p.docTitle === 'Sample title')).toBe(true);
  });

  it('leaves out the notice line and sections with no text', () => {
    const { passages } = chunkDocument('sample', doc('# T', '## Empty', '', '## Full', 'Text.'));
    expect(passages.map((p) => p.heading)).toEqual(['Full']);
    expect(passages.some((p) => p.body.includes('Illustrative'))).toBe(false);
  });

  it('numbers a heading that repeats, so ids stay unique and stable', () => {
    const { passages } = chunkDocument('sample', doc('# T', '## Same', 'One.', '## Same', 'Two.'));
    expect(passages.map((p) => p.id)).toEqual(['sample:same', 'sample:same-2']);
  });

  it('names a "###" section after its parent', () => {
    const { passages } = chunkDocument('sample', doc('# T', '## Parent', 'Lead.', '### Child', 'Detail.'));
    expect(passages.map((p) => p.heading)).toEqual(['Parent', 'Parent: Child']);
  });

  it('splits an over-long section at paragraph breaks and labels the parts', () => {
    const paragraph = 'Sentence about the case. '.repeat(30).trim(); // 749 characters
    const { passages } = chunkDocument('sample', doc('# T', '## Long', paragraph, '', paragraph, '', paragraph));
    expect(passages.map((p) => p.heading)).toEqual(['Long', 'Long (part 2)', 'Long (part 3)']);
    expect(passages.every((p) => p.body.length <= MAX_PASSAGE_CHARS)).toBe(true);
    expect(passages.map((p) => p.id)).toEqual(['sample:long', 'sample:long-part-2', 'sample:long-part-3']);
  });

  it('refuses a document that does not say it is illustrative demo policy, not Selective Service policy', () => {
    expect(() => chunkDocument('bare', '# Title\n\n## Part\nText.')).toThrow(/must start with a line saying it is illustrative demo policy/);
    expect(() => chunkDocument('half', '> Illustrative demo policy.\n\n# Title\n\n## Part\nText.')).toThrow(/illustrative demo policy/);
    expect(() => chunkDocument('half', '> This is not Selective Service policy.\n\n# Title\n\n## Part\nText.')).toThrow(/illustrative demo policy/);
  });

  it('refuses a document with no title', () => {
    expect(() => chunkDocument('untitled', doc('## Part', 'Text.'))).toThrow(/no "# Title" line/);
  });

  it('reads Windows line endings as it reads Unix ones', () => {
    const unix = doc('# T', '## Part', 'Text.');
    expect(chunkDocument('sample', unix.replace(/\n/g, '\r\n'))).toEqual(chunkDocument('sample', unix));
  });
});

describe('contentHash', () => {
  it('is the same for the same text however the lines end, and differs when a word changes', () => {
    expect(contentHash('a\nb\n')).toBe(contentHash('a\r\nb\r\n'));
    expect(contentHash('a\nb\n')).not.toBe(contentHash('a\nc\n'));
    expect(contentHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the policy documents in backend/policy-docs', () => {
  const docs = readPolicyDocs();

  it('are the eight synthetic documents, each with passages', () => {
    expect(docs.map((d) => d.slug)).toEqual([
      'appeals',
      'case-statuses-and-timelines',
      'decisions-and-controls',
      'exemption-type-a',
      'exemption-type-b',
      'exemption-type-c',
      'privacy-and-ssn',
      'registration-duty',
    ]);
    expect(docs.every((d) => d.passages.length >= 3)).toBe(true);
  });

  it('give every passage its own id, a heading and text', () => {
    const passages = docs.flatMap((d) => d.passages);
    expect(new Set(passages.map((p) => p.id)).size).toBe(passages.length);
    expect(passages.every((p) => p.heading.length > 0 && p.body.length > 0 && p.id.startsWith(`${p.docSlug}:`))).toBe(true);
  });

  it('never claim to be Selective Service policy or to operate in production', () => {
    const text = docs.flatMap((d) => d.passages.map((p) => p.body)).join('\n');
    expect(text).not.toMatch(/\bin production\b|operating in production|production system/i);
  });
});

describe('ingestPolicyDocs (STORY-017)', () => {
  const docs = readPolicyDocs();
  const storedAll = () => ({ rows: docs.map((d) => ({ doc_slug: d.slug, version: d.version })) });

  it('adds every document on the first start and audits it once, in the same transaction', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await ingestPolicyDocs();
    expect(result.added).toEqual(docs.map((d) => d.slug));
    expect([result.updated, result.removed, result.unchanged]).toEqual([[], [], 0]);
    expect(result.passages).toBe(docs.reduce((n, d) => n + d.passages.length, 0));

    const inserts = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO policy_passages'));
    expect(inserts).toHaveLength(result.passages);
    expect(inserts[0][1]).toEqual(expect.arrayContaining([docs[0].passages[0].id, docs[0].version]));
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0].slice(0, 3)).toEqual(['AI_CORPUS_UPDATE', 'assistant', 'success']);
    expect(audit.mock.calls[0][3].details).toMatchObject({ added: result.added, updated: [], removed: [], documents: docs.length, passages: result.passages });
    expect(audit.mock.calls[0][3].details.versions).toContainEqual({ document: 'appeals', version: docs[0].version.slice(0, 12) });
    // The audit log redacts the value of a key ending in "ssn", and one document is privacy-and-ssn: nothing of the entry may be lost to it
    expect(JSON.stringify(sanitizeDetails(audit.mock.calls[0][3].details))).not.toContain('[REDACTED]');
  });

  it('writes and audits nothing when no document changed', async () => {
    query.mockResolvedValueOnce(storedAll());
    const result = await ingestPolicyDocs();
    expect([result.added, result.updated, result.removed, result.unchanged]).toEqual([[], [], [], docs.length]);
    expect(transaction).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('replaces only the document whose content hash differs', async () => {
    const stored = storedAll();
    stored.rows[3] = { ...stored.rows[3], version: 'f'.repeat(64) };
    query.mockResolvedValueOnce(stored);
    const result = await ingestPolicyDocs();
    expect([result.added, result.updated, result.removed, result.unchanged]).toEqual([[], [docs[3].slug], [], docs.length - 1]);
    const deletes = client.query.mock.calls.filter(([sql]) => String(sql).startsWith('DELETE FROM policy_passages'));
    expect(deletes.map(([, params]) => params)).toEqual([[docs[3].slug]]);
    expect(client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO')).length).toBe(docs[3].passages.length);
    expect(audit.mock.calls[0][3].details).toMatchObject({ added: [], updated: [docs[3].slug], removed: [] });
  });

  it('removes the passages of a document that is no longer in the folder', async () => {
    const stored = storedAll();
    stored.rows.push({ doc_slug: 'retired-doc', version: 'a'.repeat(64) });
    query.mockResolvedValueOnce(stored);
    const result = await ingestPolicyDocs();
    expect(result.removed).toEqual(['retired-doc']);
    expect(client.query.mock.calls.map(([sql, params]) => [String(sql).slice(0, 27), params])).toEqual([['DELETE FROM policy_passages', ['retired-doc']]]);
    expect(audit.mock.calls[0][3].details).toMatchObject({ removed: ['retired-doc'] });
  });

  it('audits before the transaction commits, so the passages never change without their entry', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const order: string[] = [];
    client.query.mockImplementation(async () => order.push('write'));
    audit.mockImplementation(async () => order.push('audit'));
    transaction.mockImplementation(async (work: (c: typeof client) => Promise<unknown>) => {
      await work(client);
      order.push('commit');
    });
    await ingestPolicyDocs();
    expect(order.slice(-2)).toEqual(['audit', 'commit']);
  });

  it('stops before touching the database when the folder is missing', async () => {
    await expect(ingestPolicyDocs('Z:\\no\\such\\folder')).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('searchPassages', () => {
  it('asks for the best five by default, passing the question as a parameter and never in the SQL text', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'a:b', doc_slug: 'a', doc_title: 'A', heading: 'B', position: 1, body: 'Text.', version: 'v', rank: '0.25' }],
    });
    const found = await searchPassages("What is the income limit? '; DROP TABLE users; --");
    expect(found).toEqual([{ id: 'a:b', docSlug: 'a', docTitle: 'A', heading: 'B', position: 1, body: 'Text.', version: 'v', rank: 0.25 }]);

    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(["What is the income limit? '; DROP TABLE users; --", 5]);
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toContain('websearch_to_tsquery');
    expect(sql).toContain('ts_rank');
    expect(sql).toContain("' | '"); // the words are joined with OR, so one word the documents lack does not empty the result
  });

  it('returns nothing when no passage matches', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await searchPassages('weather')).toEqual([]);
  });
});

describe('getCorpusInfo', () => {
  it('counts documents and passages and gives one version that changes with any document', async () => {
    const rows = (version: string) => ({
      rows: [
        { doc_slug: 'a', version: 'x'.repeat(64), passages: 3, ingested_at: new Date('2026-10-15T10:00:00Z') },
        { doc_slug: 'b', version, passages: 2, ingested_at: new Date('2026-10-15T11:00:00Z') },
      ],
    });
    query.mockResolvedValueOnce(rows('y'.repeat(64))).mockResolvedValueOnce(rows('z'.repeat(64)));
    const first = await getCorpusInfo();
    const second = await getCorpusInfo();
    expect([first.documents, first.passages, first.ingestedAt]).toEqual([2, 5, '2026-10-15T11:00:00.000Z']);
    expect(first.version).toMatch(/^[0-9a-f]{12}$/);
    expect(second.version).not.toBe(first.version);
  });

  it('is empty before anything is ingested', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getCorpusInfo()).toEqual({ documents: 0, passages: 0, version: null, ingestedAt: null });
  });
});

// STORY-020: the golden set points at passages that exist, so a renamed heading cannot silently break the evaluation.
describe('the golden set (backend/policy-docs/golden.json)', () => {
  const golden = require('../../policy-docs/golden.json') as { questions: { id: string; question: string; expectedPassages: string[]; facts: (string | string[])[] }[] };
  const passages = readPolicyDocs().flatMap((d) => d.passages);
  const ids = new Set(passages.map((p) => p.id));

  it('has at least 25 questions, each with its own id, expected passages and facts', () => {
    expect(golden.questions.length).toBeGreaterThanOrEqual(25);
    expect(new Set(golden.questions.map((q) => q.id)).size).toBe(golden.questions.length);
    expect(golden.questions.every((q) => q.question.length >= 3 && q.expectedPassages.length > 0 && q.facts.length > 0)).toBe(true);
  });

  it('expects only passages that exist in the documents', () => {
    const unknown = golden.questions.flatMap((q) => q.expectedPassages.filter((id) => !ids.has(id)).map((id) => `${q.id}: ${id}`));
    expect(unknown).toEqual([]);
  });

  it('asks only for facts that the documents contain', () => {
    // A fact that is nowhere in the documents could never be scored, whatever the assistant answers
    const corpus = passages.map((p) => `${p.heading} ${p.body}`).join(' ').toLowerCase().replace(/[,$]/g, '');
    const missing = golden.questions.flatMap((q) =>
      q.facts
        .filter((fact) => ![fact].flat().some((alternative) => corpus.includes(alternative.toLowerCase().replace(/[,$]/g, ''))))
        .map((fact) => `${q.id}: ${[fact].flat().join(' / ')}`)
    );
    expect(missing).toEqual([]);
  });
});

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pool from '../database/connection';
import { AuditAction, logAuditEvent } from './auditService';
import { inTransaction } from './caseEvents';

// STORY-017: the policy documents the assistant answers from. They are synthetic demo policy (backend/policy-docs/*.md), split into
// passages at their headings and kept in policy_passages with a full-text index. The folder is resolved from here so it is found from
// src/ (ts-node, jest) and from dist/ alike.
export const POLICY_DOCS_DIR = path.resolve(__dirname, '..', '..', 'policy-docs');

/** A section longer than this is split at paragraph breaks, so a citation stays close to the text it supports. */
export const MAX_PASSAGE_CHARS = 1200;
/** How many passages the assistant is given for one question. */
export const RETRIEVED_PASSAGES = 5;

export interface PolicyPassage {
  /** Stable across re-ingests: <document>:<heading>, so a stored answer keeps pointing at the same section. */
  id: string;
  docSlug: string;
  docTitle: string;
  heading: string;
  /** Order within the document. */
  position: number;
  body: string;
}

export interface RetrievedPassage extends PolicyPassage {
  /** The content hash of the document the passage was read from. */
  version: string;
  rank: number;
}

export interface IngestResult {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
  passages: number;
}

const normalise = (text: string): string => text.replace(/\r\n?/g, '\n');

/** SHA-256 of the text with line endings normalised, so a checkout with CRLF and one with LF give the same version. */
export const contentHash = (text: string): string => createHash('sha256').update(normalise(text)).digest('hex');

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'section';
}

/** Splits an over-long section at paragraph breaks; a single long paragraph stays whole. */
function splitBody(body: string): string[] {
  if (body.length <= MAX_PASSAGE_CHARS) return [body];
  const parts: string[] = [];
  let part = '';
  for (const paragraph of body.split(/\n{2,}/)) {
    if (part && part.length + paragraph.length + 2 > MAX_PASSAGE_CHARS) {
      parts.push(part);
      part = '';
    }
    part = part ? `${part}\n\n${paragraph}` : paragraph;
  }
  if (part) parts.push(part);
  return parts;
}

/**
 * Splits one document into passages: the text under the title, then one passage per "##" section (a "###" section becomes
 * "Parent: Child"). Pure. A document must say on its first line that it is illustrative demo policy and not Selective Service
 * policy; one that does not is refused, so nothing without that line can ever be answered from.
 */
export function chunkDocument(slug: string, markdown: string): { title: string; passages: PolicyPassage[] } {
  const lines = normalise(markdown).split('\n');
  const first = lines.find((line) => line.trim() !== '') ?? '';
  if (!/illustrative demo policy/i.test(first) || !/not selective service/i.test(first)) {
    throw new Error(`${slug}.md must start with a line saying it is illustrative demo policy, not Selective Service System policy`);
  }
  const titleIndex = lines.findIndex((line) => /^# \S/.test(line));
  if (titleIndex < 0) throw new Error(`${slug}.md has no "# Title" line`);
  const title = lines[titleIndex].slice(2).trim();

  const sections: { heading: string; lines: string[] }[] = [];
  let current = { heading: title, lines: [] as string[] };
  let parent = title;
  for (const line of lines.slice(titleIndex + 1)) {
    const h2 = /^## (\S.*)/.exec(line);
    const h3 = /^### (\S.*)/.exec(line);
    if (!h2 && !h3) {
      current.lines.push(line);
      continue;
    }
    sections.push(current);
    if (h2) parent = h2[1].trim();
    current = { heading: h2 ? parent : `${parent}: ${h3![1].trim()}`, lines: [] };
  }
  sections.push(current);

  const passages: PolicyPassage[] = [];
  const used = new Set<string>();
  for (const section of sections) {
    const body = section.lines.join('\n').trim();
    if (!body) continue;
    splitBody(body).forEach((part, i) => {
      const heading = i === 0 ? section.heading : `${section.heading} (part ${i + 1})`;
      const base = `${slug}:${slugify(heading)}`;
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      passages.push({ id, docSlug: slug, docTitle: title, heading, position: passages.length, body: part });
    });
  }
  return { title, passages };
}

interface ParsedDocument {
  slug: string;
  version: string;
  title: string;
  passages: PolicyPassage[];
}

/** Reads and splits every document in the folder. Nothing is returned unless all of them are sound. */
export function readPolicyDocs(dir: string = POLICY_DOCS_DIR): ParsedDocument[] {
  const files = readdirSync(dir).filter((file) => file.endsWith('.md')).sort();
  if (files.length === 0) throw new Error(`No policy documents found in ${dir}`);
  return files.map((file) => {
    const text = readFileSync(path.join(dir, file), 'utf8');
    const slug = file.replace(/\.md$/, '');
    return { slug, version: contentHash(text), ...chunkDocument(slug, text) };
  });
}

/**
 * Brings policy_passages in line with the documents. A document whose content hash differs from the stored one is replaced
 * (and a new one added, a deleted one removed); documents that did not change are left alone, so a restart that changed nothing
 * writes nothing. A change is audited in the same transaction, so the passages never change without their audit entry.
 */
export async function ingestPolicyDocs(dir: string = POLICY_DOCS_DIR): Promise<IngestResult> {
  const docs = readPolicyDocs(dir);
  const stored = new Map<string, string>(
    (await pool.query('SELECT doc_slug, MAX(version) AS version FROM policy_passages GROUP BY doc_slug')).rows.map((r: any) => [r.doc_slug, r.version])
  );

  const added = docs.filter((d) => !stored.has(d.slug)).map((d) => d.slug);
  const updated = docs.filter((d) => stored.has(d.slug) && stored.get(d.slug) !== d.version).map((d) => d.slug);
  const removed = [...stored.keys()].filter((slug) => !docs.some((d) => d.slug === slug)).sort();
  const result: IngestResult = {
    added,
    updated,
    removed,
    unchanged: docs.length - added.length - updated.length,
    passages: docs.reduce((n, d) => n + d.passages.length, 0),
  };
  if (added.length + updated.length + removed.length === 0) return result;

  await inTransaction(async (client) => {
    for (const slug of [...updated, ...removed]) await client.query('DELETE FROM policy_passages WHERE doc_slug = $1', [slug]);
    for (const doc of docs.filter((d) => added.includes(d.slug) || updated.includes(d.slug))) {
      for (const p of doc.passages) {
        await client.query(
          `INSERT INTO policy_passages (id, doc_slug, doc_title, heading, position, body, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [p.id, p.docSlug, p.docTitle, p.heading, p.position, p.body, doc.version]
        );
      }
    }
    // Written before the commit, so the passages never change without their audit entry
    await logAuditEvent(AuditAction.AI_CORPUS_UPDATE, 'assistant', 'success', {
      details: {
        added,
        updated,
        removed,
        documents: docs.length,
        passages: result.passages,
        // A list, not an object keyed by document: the audit log redacts the value of a key that ends in "ssn" (privacy-and-ssn)
        versions: docs.map((d) => ({ document: d.slug, version: d.version.slice(0, 12) })),
      },
    });
  });
  return result;
}

const SEARCH_SQL = `
  SELECT p.id, p.doc_slug, p.doc_title, p.heading, p.position, p.body, p.version, ts_rank(p.search, q.query) AS rank
  FROM policy_passages p
  CROSS JOIN LATERAL (SELECT replace(websearch_to_tsquery('english', $1)::text, ' & ', ' | ')::tsquery AS query) q
  WHERE p.search @@ q.query
  ORDER BY rank DESC, p.doc_slug, p.position
  LIMIT $2`;

/**
 * The passages that best match a question. websearch_to_tsquery reads the question as people write it (quotes, "or", a leading
 * minus) and drops stop words; it joins the remaining words with AND, which would find nothing for a question that uses one word
 * the documents do not, so the words are joined with OR and ts_rank puts the passages with the most (and heaviest) matches first.
 */
export async function searchPassages(question: string, limit: number = RETRIEVED_PASSAGES): Promise<RetrievedPassage[]> {
  const result = await pool.query(SEARCH_SQL, [question, limit]);
  return result.rows.map((r: any) => ({
    id: r.id,
    docSlug: r.doc_slug,
    docTitle: r.doc_title,
    heading: r.heading,
    position: r.position,
    body: r.body,
    version: r.version,
    rank: Number(r.rank),
  }));
}

export interface CorpusInfo {
  documents: number;
  passages: number;
  /** One short hash over every document's version: it changes when any document does. */
  version: string | null;
  ingestedAt: string | null;
}

export async function getCorpusInfo(): Promise<CorpusInfo> {
  const result = await pool.query(
    `SELECT doc_slug, MAX(version) AS version, COUNT(*)::int AS passages, MAX(ingested_at) AS ingested_at
     FROM policy_passages GROUP BY doc_slug ORDER BY doc_slug`
  );
  const rows: any[] = result.rows;
  return {
    documents: rows.length,
    passages: rows.reduce((n, r) => n + r.passages, 0),
    version: rows.length ? contentHash(rows.map((r) => `${r.doc_slug}:${r.version}`).join('\n')).slice(0, 12) : null,
    ingestedAt: rows.length ? new Date(Math.max(...rows.map((r) => new Date(r.ingested_at).getTime()))).toISOString() : null,
  };
}

export interface PassageView {
  id: string;
  docSlug: string;
  docTitle: string;
  heading: string;
  text: string;
  /** The first 12 characters of the document's content hash: which version of the document this is. */
  version: string;
}

/** One passage by its id, to open a citation on the assistant page (STORY-019); null when there is no such passage. */
export async function getPassage(id: string): Promise<PassageView | null> {
  const result = await pool.query('SELECT id, doc_slug, doc_title, heading, body, version FROM policy_passages WHERE id = $1', [id]);
  const r = result.rows[0];
  return r ? { id: r.id, docSlug: r.doc_slug, docTitle: r.doc_title, heading: r.heading, text: r.body, version: String(r.version).slice(0, 12) } : null;
}

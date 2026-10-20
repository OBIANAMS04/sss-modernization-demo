import { readFileSync } from 'node:fs';
import path from 'node:path';
import pool from '../database/connection';
import { NotFoundError, RateLimitError, ValidationError } from '../utils/errors';
import { AssistantMode, configuredMode } from './assistantModel';
import { answerFor } from './assistantService';
import { AuditAction, logAuditEvent } from './auditService';
import { inTransaction } from './caseEvents';
import { noteChange } from './changeMarkers';
import { POLICY_DOCS_DIR, RetrievedPassage, getCorpusInfo } from './policyCorpus';

// STORY-021 and 025: runs of a question set on the server, started by an administrator. A run asks every question through answerFor(), the
// path a real question takes, scores what comes back and is stored in assistant_eval_runs. Each question is one call to the model, which
// costs money, so a kind of run can be started once an hour. Nothing here keeps a question that a person asked: the questions are the
// committed sets in backend/policy-docs.

export type RunKind = 'eval' | 'fairness';
export const RUN_INTERVAL_MINUTES = 60;
/** Questions asked at once. A few at a time keeps a run of 33 real calls to a couple of minutes without a burst on the API. */
export const RUN_CONCURRENCY = 4;
/** A run that has been "running" this long was cut off (the server restarted); it is marked failed. */
export const STALE_RUN_MINUTES = 30;
/** A score more than this far under the baseline's is drift: 5 points. */
export const BASELINE_TOLERANCE = 0.05;
export const THRESHOLDS = { retrieval: 0.9, facts: 0.85, citations: 1, grounded: 0.98 };

// Arbitrary constant so two requests cannot both start a run
const RUN_LOCK_ID = 7_018_021;

export interface GoldenQuestion {
  id: string;
  question: string;
  expectedPassages: string[];
  /** A fact is a phrase, or a list of alternatives of which one is enough. */
  facts: (string | string[])[];
}

export function loadGolden(file: string = path.join(POLICY_DOCS_DIR, 'golden.json')): GoldenQuestion[] {
  return JSON.parse(readFileSync(file, 'utf8')).questions;
}

export const normalise = (text: string): string => String(text).toLowerCase().replace(/[,$]/g, '').replace(/\s+/g, ' ').trim();
/** True when the fact (a phrase, or a list of alternatives) is in the answer. */
export const hasFact = (answer: string, fact: string | string[]): boolean => [fact].flat().some((alternative) => normalise(answer).includes(normalise(alternative)));
const ratio = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);

/** Runs `work` over the items, at most `limit` at a time, keeping the order of the results. */
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

// ---- Scoring one question

export interface QuestionResult {
  id: string;
  question: string;
  status: string;
  level: number | null;
  mode: AssistantMode;
  latencyMs: number;
  expectedPassages: string[];
  retrieved: string[];
  retrievalHit: boolean;
  facts: number;
  factsFound: number;
  factsMissing: (string | string[])[];
  citations: number;
  invalidCitations: number;
  grounded: boolean | null;
  /** Only an answer that was shown; a withheld one is for a case manager. */
  answer: string | null;
}

/** A citation is valid when it names a passage that was retrieved and quotes text that is really in it. Pure. */
export function citationIsValid(citation: { passageId: string; quote: string }, passages: Pick<RetrievedPassage, 'id' | 'body'>[]): boolean {
  const passage = passages.find((p) => p.id === citation.passageId);
  return !!passage && normalise(passage.body).includes(normalise(citation.quote));
}

export async function askGolden(q: GoldenQuestion, mode: AssistantMode): Promise<{ result: QuestionResult; model: string | null }> {
  const started = Date.now();
  const { passages, produced } = await answerFor(q.question, mode);
  const latencyMs = Date.now() - started;
  const retrieved = passages.map((p) => p.id);
  const shown = produced.status === 'with-staff' ? null : produced.answer;
  const missing = produced.answer === null ? q.facts : q.facts.filter((fact) => !hasFact(produced.answer!, fact));
  return {
    model: produced.model,
    result: {
      id: q.id,
      question: q.question,
      status: produced.status,
      level: produced.level,
      mode: produced.mode,
      latencyMs,
      expectedPassages: q.expectedPassages,
      retrieved,
      retrievalHit: q.expectedPassages.some((id) => retrieved.includes(id)),
      facts: q.facts.length,
      factsFound: q.facts.length - missing.length,
      factsMissing: missing,
      citations: produced.citations.length,
      invalidCitations: produced.citations.filter((c) => !citationIsValid(c, passages)).length,
      grounded: produced.grounded,
      answer: shown,
    },
  };
}

// ---- Scoring a run

export interface Scores {
  retrievalHitRate: number | null;
  factAccuracy: number | null;
  citationValidity: number | null;
  groundedRate: number | null;
}

export interface ThresholdCheck {
  name: string;
  key: keyof Scores;
  value: number | null;
  min: number;
  /** A threshold means something only for the real model (and, for citations, the stand-in, where they are valid by construction). */
  enforced: boolean;
  passed: boolean;
}

/** The four scores of a run, as scripts/ai/eval.mjs computes them. Pure. */
export function scoreResults(results: QuestionResult[]): Scores {
  const answered = results.filter((r) => r.mode === 'ai' || r.mode === 'stub');
  const graded = results.filter((r) => r.grounded !== null);
  const citations = results.reduce((n, r) => n + r.citations, 0);
  const invalid = results.reduce((n, r) => n + r.invalidCitations, 0);
  return {
    retrievalHitRate: ratio(results.filter((r) => r.retrievalHit).length, results.length),
    // The facts of every question count, so an answer that was withheld or missing scores zero for its facts
    factAccuracy: answered.length ? ratio(answered.reduce((n, r) => n + r.factsFound, 0), answered.reduce((n, r) => n + r.facts, 0)) : null,
    citationValidity: citations ? ratio(citations - invalid, citations) : null,
    groundedRate: graded.length ? ratio(graded.filter((r) => r.grounded).length, graded.length) : null,
  };
}

export function checkThresholds(scores: Scores, mode: AssistantMode | null): ThresholdCheck[] {
  const ai = mode === 'ai';
  const checks: Omit<ThresholdCheck, 'value' | 'passed'>[] = [
    { name: 'Retrieval hit rate', key: 'retrievalHitRate', min: THRESHOLDS.retrieval, enforced: true },
    { name: 'Fact accuracy', key: 'factAccuracy', min: THRESHOLDS.facts, enforced: ai },
    { name: 'Citation validity', key: 'citationValidity', min: THRESHOLDS.citations, enforced: ai || mode === 'stub' },
    { name: 'Grounded rate', key: 'groundedRate', min: THRESHOLDS.grounded, enforced: ai },
  ];
  return checks.map((c) => {
    const value = scores[c.key];
    return { ...c, value, passed: !c.enforced || (value !== null && value >= c.min) };
  });
}

const SCORE_LABELS: Record<keyof Scores, string> = {
  retrievalHitRate: 'Retrieval hit rate',
  factAccuracy: 'Fact accuracy',
  citationValidity: 'Citation validity',
  groundedRate: 'Grounded rate',
};

/** The scores that are more than 5 points under the baseline's, in words. Pure. */
export function belowBaseline(scores: Scores, baseline: Scores): string[] {
  return (Object.keys(SCORE_LABELS) as (keyof Scores)[]).flatMap((key) => {
    const now = scores[key];
    const was = baseline[key];
    if (now === null || was === null || was - now <= BASELINE_TOLERANCE + 1e-9) return [];
    return [`${SCORE_LABELS[key]} is ${Math.round(now * 1000) / 10}%, more than 5 points under the baseline's ${Math.round(was * 1000) / 10}%.`];
  });
}

// ---- Storing runs

export interface RunRow {
  id: string;
  kind: RunKind;
  status: 'running' | 'completed' | 'failed';
  model: string | null;
  corpusVersion: string | null;
  mode: AssistantMode | null;
  scores: Scores;
  passed: boolean | null;
  summary: Record<string, unknown> | null;
  error: string | null;
  startedByEmail: string | null;
  isBaseline: boolean;
  createdAt: string;
  finishedAt: string | null;
}

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

export function toRun(r: any): RunRow {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    model: r.model,
    corpusVersion: r.corpus_version,
    mode: r.mode,
    scores: { retrievalHitRate: num(r.retrieval_hit_rate), factAccuracy: num(r.fact_accuracy), citationValidity: num(r.citation_validity), groundedRate: num(r.grounded_rate) },
    passed: r.passed,
    summary: r.summary,
    error: r.error,
    startedByEmail: r.started_by_email,
    isBaseline: r.is_baseline,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

/** What a finished run hands back to be stored. */
export interface RunOutcome {
  model: string | null;
  mode: AssistantMode | null;
  scores?: Scores;
  passed: boolean;
  summary: Record<string, unknown>;
  results: unknown[];
}

export type RunWork = () => Promise<RunOutcome>;

/**
 * Starts a run for an administrator and returns it at once, "running"; the questions are asked in the background and the row is
 * completed when they are done. At most one run of a kind in any hour (a 429 says when the next may start), counted under a lock so two
 * requests cannot both start one. `after` is told when the run is stored (the alert check).
 */
export async function startRun(
  kind: RunKind,
  actor: { id: string; email: string },
  work: RunWork,
  after: (run: RunRow) => Promise<void> = async () => {}
): Promise<RunRow> {
  const mode = configuredMode();
  const row = await inTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [RUN_LOCK_ID]);
    await client.query(
      `UPDATE assistant_eval_runs SET status = 'failed', error = 'The server restarted before the run finished.', finished_at = NOW()
       WHERE status = 'running' AND created_at < NOW() - make_interval(mins => $1::int)`,
      [STALE_RUN_MINUTES]
    );
    const last = await client.query(
      `SELECT GREATEST(CEIL(EXTRACT(EPOCH FROM (MAX(created_at) + make_interval(mins => $2::int) - NOW()))), 1)::int AS retry_after, COUNT(*)::int AS runs
       FROM assistant_eval_runs WHERE kind = $1 AND created_at > NOW() - make_interval(mins => $2::int)`,
      [kind, RUN_INTERVAL_MINUTES]
    );
    if (last.rows[0].runs > 0) {
      const seconds = last.rows[0].retry_after;
      const wait = seconds < 90 ? 'a minute' : `about ${Math.ceil(seconds / 60)} minutes`;
      throw new RateLimitError(`${kind === 'eval' ? 'An evaluation' : 'A fairness'} run can be started once an hour, because each calls the model. Try again in ${wait}.`, seconds);
    }
    const corpus = await getCorpusInfo();
    const inserted = await client.query(
      `INSERT INTO assistant_eval_runs (kind, status, mode, corpus_version, started_by, started_by_email)
       VALUES ($1, 'running', $2, $3, $4, $5) RETURNING *`,
      [kind, mode, corpus.version, actor.id, actor.email]
    );
    return inserted.rows[0];
  });
  await logAuditEvent(AuditAction.AI_EVAL_RUN, 'assistant', 'success', {
    actor: actor.id,
    actorEmail: actor.email,
    resourceId: row.id,
    details: { runId: row.id, kind, phase: 'started', mode, corpusVersion: row.corpus_version },
  });
  // Not awaited: the person is answered now and the run finishes in the background. It never throws out of here.
  void finishRun(row.id, kind, actor, work, after);
  return toRun(row);
}

async function finishRun(id: string, kind: RunKind, actor: { id: string; email: string }, work: RunWork, after: (run: RunRow) => Promise<void>): Promise<void> {
  try {
    const outcome = await work();
    if (outcome.model) await noteChange('model', outcome.model).catch(() => {});
    const s = outcome.scores;
    const updated = await pool.query(
      `UPDATE assistant_eval_runs
       SET status = 'completed', model = $2, mode = $3, retrieval_hit_rate = $4, fact_accuracy = $5, citation_validity = $6, grounded_rate = $7,
           passed = $8, summary = $9::jsonb, results = $10::jsonb, finished_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, outcome.model, outcome.mode, s?.retrievalHitRate ?? null, s?.factAccuracy ?? null, s?.citationValidity ?? null, s?.groundedRate ?? null, outcome.passed, JSON.stringify(outcome.summary), JSON.stringify(outcome.results)]
    );
    await logAuditEvent(AuditAction.AI_EVAL_RUN, 'assistant', outcome.passed ? 'success' : 'failure', {
      actor: actor.id,
      actorEmail: actor.email,
      resourceId: id,
      details: { runId: id, kind, phase: 'finished', mode: outcome.mode, model: outcome.model, passed: outcome.passed, scores: s ?? null },
    });
    await after(toRun(updated.rows[0]));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'The run failed.';
    await pool.query(`UPDATE assistant_eval_runs SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1`, [id, message]).catch(() => {});
    await logAuditEvent(AuditAction.AI_EVAL_RUN, 'assistant', 'failure', {
      actor: actor.id,
      actorEmail: actor.email,
      resourceId: id,
      details: { runId: id, kind, phase: 'failed' },
    }).catch(() => {});
    console.error('Assistant run failed', { runId: id, kind, message });
  }
}

/** The golden set, asked and scored. This is what the evaluation run does. */
export async function runGoldenSet(): Promise<RunOutcome> {
  const mode = configuredMode();
  const golden = loadGolden();
  const asked = await mapLimit(golden, RUN_CONCURRENCY, (q) => askGolden(q, mode));
  const results = asked.map((a) => a.result);
  const scores = scoreResults(results);
  const checks = checkThresholds(scores, mode);
  const modes = [...new Set(results.map((r) => r.mode))];
  const model = asked.map((a) => a.model).find((m) => m !== null) ?? null;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    model,
    mode: modes.length === 1 ? modes[0] : mode,
    scores,
    passed: checks.every((c) => c.passed),
    summary: {
      questions: results.length,
      thresholds: checks,
      shown: results.filter((r) => r.status === 'shown').length,
      withStaff: results.filter((r) => r.status === 'with-staff').length,
      noAnswer: results.filter((r) => r.status === 'no-answer').length,
      p95LatencyMs: latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(0.95 * latencies.length) - 1)] : null,
    },
    results,
  };
}

/** Marks a completed evaluation run as the baseline for its mode; the earlier baseline of that mode is released. Audited. */
export async function markBaseline(runId: unknown, actor: { id: string; email: string }): Promise<RunRow> {
  if (typeof runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(runId)) throw new ValidationError('Give the id of a run.');
  const run = await inTransaction(async (client) => {
    const found = await client.query('SELECT * FROM assistant_eval_runs WHERE id = $1 FOR UPDATE', [runId]);
    const row = found.rows[0];
    if (!row) throw new NotFoundError('That run does not exist.');
    if (row.kind !== 'eval') throw new ValidationError('Only an evaluation run can be the baseline.');
    if (row.status !== 'completed') throw new ValidationError('Only a completed run can be the baseline.');
    await client.query(`UPDATE assistant_eval_runs SET is_baseline = FALSE WHERE kind = 'eval' AND mode = $1 AND is_baseline`, [row.mode]);
    return (await client.query('UPDATE assistant_eval_runs SET is_baseline = TRUE WHERE id = $1 RETURNING *', [runId])).rows[0];
  });
  await logAuditEvent(AuditAction.AI_EVAL_BASELINE, 'assistant', 'success', {
    actor: actor.id,
    actorEmail: actor.email,
    resourceId: runId,
    details: { runId, mode: run.mode, model: run.model, corpusVersion: run.corpus_version },
  });
  return toRun(run);
}

export async function listRuns(kind: RunKind, limit = 10): Promise<RunRow[]> {
  const result = await pool.query(
    `SELECT id, kind, status, model, corpus_version, mode, retrieval_hit_rate, fact_accuracy, citation_validity, grounded_rate, passed, summary, error,
            started_by_email, is_baseline, created_at, finished_at
     FROM assistant_eval_runs WHERE kind = $1 ORDER BY created_at DESC LIMIT $2`,
    [kind, limit]
  );
  return result.rows.map(toRun);
}

export interface Failure {
  id: string;
  question: string;
  status: string;
  retrievalHit: boolean;
  factsMissing: (string | string[])[];
  invalidCitations: number;
  grounded: boolean | null;
}

/** The questions of a stored evaluation run that missed something (retrieval, a fact, a citation or the grounding), for the page. */
export async function failuresOf(runId: string): Promise<Failure[]> {
  const result = await pool.query('SELECT results FROM assistant_eval_runs WHERE id = $1', [runId]);
  const results: QuestionResult[] = result.rows[0]?.results ?? [];
  return results
    .filter((r) => !r.retrievalHit || r.factsMissing.length > 0 || r.invalidCitations > 0 || r.grounded === false)
    .map(({ id, question, status, retrievalHit, factsMissing, invalidCitations, grounded }) => ({ id, question, status, retrievalHit, factsMissing, invalidCitations, grounded }));
}

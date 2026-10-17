import { randomUUID } from 'node:crypto';
import pool from '../database/connection';
import { RateLimitError, ValidationError } from '../utils/errors';
import { AssistantMode, askClaude, askStub, configuredMode } from './assistantModel';
import { AuditAction, logAuditEvent, redactSsn } from './auditService';
import { inTransaction } from './caseEvents';
import { AnswerSegment, Unsupported, checkGrounding } from './groundingCheck';
import { OversightLevel, isPersonalQuestion, levelFor } from './oversightLevel';
import { CorpusInfo, RetrievedPassage, getCorpusInfo, searchPassages } from './policyCorpus';

// STORY-018: the policy assistant. A signed-in person asks a question; the most relevant passages of the synthetic policy documents
// are retrieved; Claude (or the test stand-in) answers from them with citations; the answer is checked (STORY-022) and given an
// oversight level (STORY-023); the exchange is stored and audited. Everything is demonstrated on a synthetic demo deployment.

export const QUESTION_MIN = 3;
export const QUESTION_MAX = 500;
/** Questions one person may ask in any rolling hour. */
export const HOURLY_LIMIT = 20;
/** Answers the assistant may generate in one UTC day, across everyone, unless AI_DAILY_LIMIT says otherwise. */
export const DEFAULT_DAILY_LIMIT = 300;
export const HISTORY_LENGTH = 20;
/** STORY-022: the share of answers that may fail the grounding check, in percent. At or above it raises the alert. */
export const HALLUCINATION_TARGET = 2;
export const UNGROUNDED_EXAMPLES = 10;

// Arbitrary constant so asks are counted and recorded one at a time (the limits below are exact, even for parallel requests).
const ASSISTANT_LOCK_ID = 7_018_001;

export const STAFF_REPLY_MESSAGE = 'A case manager will review this question and reply.';
export const NO_ANSWER_MESSAGE = 'The demo policy documents do not answer that question. Please ask a case manager.';
const INSTEAD = 'so here are the most relevant policy passages instead.';
const PASSAGES_ONLY_MESSAGES = {
  off: `AI answers are turned off in this demo, ${INSTEAD}`,
  'daily-cap': `The daily limit for AI answers has been reached, ${INSTEAD}`,
  unavailable: `The AI assistant is not available right now, ${INSTEAD}`,
  declined: `The assistant could not give a reliable answer, ${INSTEAD}`,
};

export type AssistantStatus = 'shown' | 'no-answer' | 'with-staff';

export interface CitationView {
  passageId: string;
  docTitle: string;
  heading: string;
  quote: string;
  /** The version (content hash) of the document the quote was read from. */
  version: string;
}

export interface AskResponse {
  traceId: string;
  mode: AssistantMode;
  status: AssistantStatus;
  level: OversightLevel;
  /** null when no answer is shown: AI is off, nothing matched, or the answer is withheld for a case manager. */
  answer: string | null;
  citations: Omit<CitationView, 'version'>[];
  grounding: { grounded: boolean; coverage: number; unsupported?: Unsupported[] } | null;
  /** The passages the assistant was given, best first. */
  retrieved: { passageId: string; docTitle: string; heading: string }[];
  /** With AI off (or unavailable): the policy text itself. */
  passages?: { passageId: string; docTitle: string; heading: string; text: string }[];
  /** A plain note for the person. */
  message?: string;
  /** True when something shaped like a Social Security number was removed from the question. */
  questionRedacted: boolean;
}

// ---- The question

// Social Security numbers written with spaces or odd dashes, or as nine digits, as well as the dashed form auditService removes
const LOOSE_SSN = [/\b\d{3}[\s\-‐-―]\d{2}[\s\-‐-―]\d{4}\b/g, /\b\d{9}\b/g];

/** Removes SSN-shaped text from free text, however it is written. Also used for comments and reviews (STORY-019, 023), which are stored and shown. */
export function scrubSsn(text: string): string {
  let clean = redactSsn(text);
  for (const pattern of LOOSE_SSN) clean = clean.replace(pattern, '[REDACTED]');
  return clean;
}

/** Checks a question (3 to 500 characters) and removes SSN-shaped text. Nothing is stored or sent before this has run. */
export function cleanQuestion(raw: unknown): { question: string; redacted: boolean } {
  if (typeof raw !== 'string') throw new ValidationError('Ask your question as text.');
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < QUESTION_MIN || text.length > QUESTION_MAX) {
    throw new ValidationError(`A question must be between ${QUESTION_MIN} and ${QUESTION_MAX} characters.`);
  }
  const question = scrubSsn(text);
  if (question.replace(/\[REDACTED\]/g, '').replace(/[^\p{L}]/gu, '').length < 2) {
    throw new ValidationError('Please ask your question in words. Social Security numbers are removed from questions.');
  }
  return { question, redacted: question !== text };
}

export function dailyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const limit = Number.parseInt(env.AI_DAILY_LIMIT ?? '', 10);
  return Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_DAILY_LIMIT;
}

// ---- The limits

type PassagesOnlyReason = 'off' | 'daily-cap';

interface Reservation {
  traceId: string;
  /** What the assistant will do for this question: AI mode becomes passages-only when today's cap is used up. */
  mode: AssistantMode;
  why: PassagesOnlyReason | null;
}

const wait = (seconds: number): string => (seconds < 90 ? 'a minute' : `about ${Math.ceil(seconds / 60)} minutes`);

/**
 * Counts the person's questions in the last hour and the answers generated today, then records this question as pending, all in one
 * step under a lock, so parallel requests cannot slip past a limit. Throws a 429 when the hourly limit is used up. When the daily cap
 * is used up the question is still accepted, but answered with the policy passages alone.
 */
export async function reserveAsk(userId: string, question: string, env: NodeJS.ProcessEnv = process.env): Promise<Reservation> {
  return inTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [ASSISTANT_LOCK_ID]);
    const recent = (
      await client.query(
        `SELECT COUNT(*)::int AS asks,
                GREATEST(CEIL(EXTRACT(EPOCH FROM (MIN(created_at) + INTERVAL '1 hour' - NOW()))), 1)::int AS retry_after
         FROM assistant_interactions WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [userId]
      )
    ).rows[0];
    if (recent.asks >= HOURLY_LIMIT) {
      throw new RateLimitError(
        `You have reached the limit of ${HOURLY_LIMIT} questions per hour. Please try again in ${wait(recent.retry_after)}.`,
        recent.retry_after
      );
    }

    let mode = configuredMode(env);
    let why: PassagesOnlyReason | null = mode === 'passages-only' ? 'off' : null;
    if (mode !== 'passages-only') {
      const today = (
        await client.query(
          `SELECT COUNT(*)::int AS answers FROM assistant_interactions
           WHERE mode IN ('ai', 'stub') AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`
        )
      ).rows[0];
      if (today.answers >= dailyLimit(env)) {
        mode = 'passages-only';
        why = 'daily-cap';
      }
    }

    const traceId = randomUUID();
    await client.query(
      `INSERT INTO assistant_interactions (user_id, trace_id, question_redacted, mode, status) VALUES ($1, $2, $3, $4, 'pending')`,
      [userId, traceId, question, mode]
    );
    return { traceId, mode, why };
  });
}

// ---- The answer

interface Produced {
  mode: AssistantMode;
  model: string | null;
  status: AssistantStatus;
  level: OversightLevel;
  /** As generated; kept for the review even when it is withheld. */
  answer: string | null;
  citations: CitationView[];
  /** The grounding check's result with the level's reasons; or why no answer was made ({ fallback }). */
  grounding: Record<string, unknown> | null;
  grounded: boolean | null;
  coverage: number | null;
  unsupported: Unsupported[];
  message: string | null;
  showPassages: boolean;
}

const none = {
  model: null,
  answer: null,
  citations: [],
  grounding: null,
  grounded: null,
  coverage: null,
  unsupported: [],
  message: null,
  showPassages: false,
};

const answerText = (segments: AnswerSegment[]): string => segments.map((s) => s.text).join('').replace(/[ \t]+\n/g, '\n').trim();

/** The citations that name a passage that was retrieved, once each, in the order they appear. */
function citationViews(segments: AnswerSegment[], passages: RetrievedPassage[]): CitationView[] {
  const byId = new Map(passages.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const views: CitationView[] = [];
  for (const citation of segments.flatMap((s) => s.citations)) {
    const passage = citation.passageId ? byId.get(citation.passageId) : undefined;
    const key = `${citation.passageId}\n${citation.quote}`;
    if (!passage || seen.has(key)) continue;
    seen.add(key);
    views.push({ passageId: passage.id, docTitle: passage.docTitle, heading: passage.heading, quote: citation.quote, version: passage.version });
  }
  return views;
}

/** What is made of a question that has no generated answer: the question goes to a case manager if it is personal, else the passages are shown. */
function withoutAnswer(personal: boolean, mode: AssistantMode, fallback: string, message: string): Produced {
  if (personal) {
    return { ...none, mode, status: 'with-staff', level: 2, grounding: { fallback, levelReasons: ['personal-question'] }, message: STAFF_REPLY_MESSAGE };
  }
  return { ...none, mode, status: 'shown', level: 0, grounding: { fallback }, message, showPassages: true };
}

/** Produces the answer for a reserved question. Never throws for a failure of the model: that falls back to the passages. */
async function produce(question: string, passages: RetrievedPassage[], reservation: Reservation): Promise<Produced> {
  const personal = isPersonalQuestion(question);
  if (reservation.mode === 'passages-only') {
    const why = reservation.why ?? 'off';
    if (passages.length === 0) return personal ? withoutAnswer(true, 'passages-only', why, '') : noAnswer('passages-only', why);
    return withoutAnswer(personal, 'passages-only', why, PASSAGES_ONLY_MESSAGES[why]);
  }
  // Nothing matched: there is nothing for the model to answer from, so it is not asked
  if (passages.length === 0) return personal ? withoutAnswer(true, 'passages-only', 'no-passages', '') : noAnswer('passages-only', 'no-passages');

  const outcome = reservation.mode === 'stub' ? askStub(question, passages) : await askClaude(question, passages);
  switch (outcome.type) {
    case 'unavailable':
      return withoutAnswer(personal, 'passages-only', `unavailable:${outcome.reason}`, PASSAGES_ONLY_MESSAGES.unavailable);
    case 'declined':
      // The call was made (and billed), so it keeps its mode and still counts toward the daily cap
      return { ...withoutAnswer(personal, reservation.mode, `declined:${outcome.reason}`, PASSAGES_ONLY_MESSAGES.declined), model: outcome.model };
    case 'no-answer':
      return personal
        ? { ...withoutAnswer(true, reservation.mode, 'no-answer', ''), model: outcome.model }
        : { ...noAnswer(reservation.mode, 'no-answer'), model: outcome.model };
    case 'answer': {
      const grounding = checkGrounding(outcome.segments, passages.map((p) => ({ id: p.id, body: p.body })));
      const decision = levelFor(question, grounding);
      return {
        mode: reservation.mode,
        model: outcome.model,
        status: decision.level === 2 ? 'with-staff' : 'shown',
        level: decision.level,
        answer: answerText(outcome.segments),
        citations: citationViews(outcome.segments, passages),
        grounding: { ...grounding, levelReasons: decision.reasons },
        grounded: grounding.grounded,
        coverage: grounding.coverage,
        unsupported: grounding.unsupported,
        message: decision.level === 2 ? STAFF_REPLY_MESSAGE : null,
        showPassages: false,
      };
    }
  }
}

function noAnswer(mode: AssistantMode, fallback: string): Produced {
  return { ...none, mode, status: 'no-answer', level: 1, grounding: { fallback }, message: NO_ANSWER_MESSAGE };
}

function toResponse(traceId: string, p: Produced, passages: RetrievedPassage[], questionRedacted: boolean): AskResponse {
  const withheld = p.status === 'with-staff';
  const response: AskResponse = {
    traceId,
    mode: p.mode,
    status: p.status,
    level: p.level,
    answer: withheld ? null : p.answer,
    citations: withheld ? [] : p.citations.map(({ version, ...citation }) => citation),
    // A withheld answer's unsupported list quotes the answer, so only whether it was grounded is shown
    grounding: p.grounded === null ? null : withheld ? { grounded: p.grounded, coverage: p.coverage! } : { grounded: p.grounded, coverage: p.coverage!, unsupported: p.unsupported },
    retrieved: passages.map((x) => ({ passageId: x.id, docTitle: x.docTitle, heading: x.heading })),
    questionRedacted,
  };
  if (p.message) response.message = p.message;
  if (p.showPassages) {
    response.passages = passages.map((x) => ({ passageId: x.id, docTitle: x.docTitle, heading: x.heading, text: x.body }));
  }
  return response;
}

/**
 * Answers a question for a signed-in person. The question is checked and cleaned first; if the person is over the hourly limit
 * nothing else happens (a 429). The exchange is stored whatever the outcome, and every one is audited with its trace id, the
 * passages and the level, never the question.
 */
export async function askAssistant(user: { id: string; email: string }, rawQuestion: unknown): Promise<AskResponse> {
  const { question, redacted } = cleanQuestion(rawQuestion);
  const started = Date.now();
  const reservation = await reserveAsk(user.id, question);

  try {
    const passages = await searchPassages(question);
    const produced = await produce(question, passages, reservation);
    const latencyMs = Date.now() - started;

    await pool.query(
      `UPDATE assistant_interactions
       SET passage_ids = $2, answer = $3, citations = $4::jsonb, model = $5, mode = $6, latency_ms = $7, grounding = $8::jsonb,
           level = $9, status = $10
       WHERE trace_id = $1`,
      [
        reservation.traceId,
        passages.map((p) => p.id),
        produced.answer,
        JSON.stringify(produced.citations),
        produced.model,
        produced.mode,
        latencyMs,
        produced.grounding ? JSON.stringify(produced.grounding) : null,
        produced.level,
        produced.status,
      ]
    );
    // Not the question: its words could be personal. The trace id finds the exchange, and the passages say what it was answered from.
    await logAuditEvent(AuditAction.AI_ANSWER, 'assistant', produced.grounded === false ? 'failure' : 'success', {
      actor: user.id,
      actorEmail: user.email,
      resourceId: reservation.traceId,
      details: {
        traceId: reservation.traceId,
        mode: produced.mode,
        status: produced.status,
        level: produced.level,
        passageIds: passages.map((p) => p.id),
        citedPassageIds: [...new Set(produced.citations.map((c) => c.passageId))],
        grounded: produced.grounded,
        ...(typeof produced.grounding?.fallback === 'string' ? { fallback: produced.grounding.fallback } : {}),
      },
    });
    return toResponse(reservation.traceId, produced, passages, redacted);
  } catch (error) {
    // The question was counted; mark it failed so it never shows as pending
    await pool.query(`UPDATE assistant_interactions SET status = 'error' WHERE trace_id = $1`, [reservation.traceId]).catch(() => {});
    throw error;
  }
}

// ---- History

export type ReviewOutcome = 'approved' | 'corrected' | 'declined';
/** 'reviewed' is a with-staff exchange after a case manager has answered it (STORY-023). */
export type HistoryStatus = AssistantStatus | 'reviewed';
/** What the history says of a question a case manager declined; the reason they gave follows it. */
export const DECLINED_MESSAGE = 'A case manager reviewed this question and could not answer it here.';

export interface HistorySection {
  passageId: string;
  docTitle: string;
  heading: string;
}

export interface HistoryItem {
  traceId: string;
  question: string;
  mode: AssistantMode;
  status: HistoryStatus;
  level: OversightLevel | null;
  answer: string | null;
  citations: Omit<CitationView, 'version'>[];
  message?: string;
  /** With AI off or unavailable: the policy sections the question matched. Their text is read with GET /api/assistant/passages. */
  sections?: HistorySection[];
  /** STORY-023: a case manager reviewed it. `answer` is then theirs (or the draft they approved), or null with `message` when they declined. */
  reviewed?: { outcome: ReviewOutcome; at: string };
  feedback: string | null;
  createdAt: string;
}

const showsSections = (r: any): boolean => r.mode === 'passages-only' && r.status === 'shown';

/** Title and heading of each passage id, for the exchanges answered with the passages alone. Nothing is read when there are none. */
async function sectionTitles(ids: string[]): Promise<Map<string, HistorySection>> {
  if (ids.length === 0) return new Map();
  const result = await pool.query('SELECT id, doc_title, heading FROM policy_passages WHERE id = ANY($1::text[])', [[...new Set(ids)]]);
  return new Map(result.rows.map((r: any) => [r.id, { passageId: r.id, docTitle: r.doc_title, heading: r.heading }]));
}

/**
 * The caller's own last questions with their answers. An answer waiting for a case manager is not shown, as when it was asked; once
 * the case manager has reviewed it, the reviewed answer is (marked as reviewed), never the draft that was withheld.
 */
export async function getHistory(userId: string, limit: number = HISTORY_LENGTH): Promise<HistoryItem[]> {
  const result = await pool.query(
    `SELECT trace_id, question_redacted, mode, status, level, answer, citations, passage_ids, feedback, created_at,
            review_outcome, reviewed_answer, reviewed_at
     FROM assistant_interactions
     WHERE user_id = $1 AND status IN ('shown', 'no-answer', 'with-staff', 'reviewed')
     ORDER BY created_at DESC, id DESC LIMIT $2`,
    [userId, limit]
  );
  const rows: any[] = result.rows;
  const sections = await sectionTitles(rows.filter(showsSections).flatMap((r) => r.passage_ids ?? []));
  return rows.map((r) => {
    const withheld = r.status === 'with-staff';
    const reviewed = r.status === 'reviewed';
    const declined = reviewed && r.review_outcome === 'declined';
    // A corrected answer is the case manager's own words, so the draft's citations no longer stand behind it
    const cited = !withheld && !(reviewed && r.review_outcome !== 'approved');
    const item: HistoryItem = {
      traceId: r.trace_id,
      question: r.question_redacted,
      mode: r.mode,
      status: r.status,
      level: r.level,
      answer: withheld || declined ? null : reviewed ? r.reviewed_answer : r.answer,
      citations: cited ? (r.citations ?? []).map(({ version, ...citation }: CitationView) => citation) : [],
      feedback: r.feedback,
      createdAt: r.created_at,
    };
    if (withheld) item.message = STAFF_REPLY_MESSAGE;
    else if (declined) item.message = r.reviewed_answer ? `${DECLINED_MESSAGE} ${r.reviewed_answer}` : DECLINED_MESSAGE;
    else if (r.status === 'no-answer') item.message = NO_ANSWER_MESSAGE;
    if (reviewed) item.reviewed = { outcome: r.review_outcome, at: r.reviewed_at };
    if (showsSections(r)) item.sections = (r.passage_ids ?? []).flatMap((id: string) => sections.get(id) ?? []);
    return item;
  });
}

// ---- STORY-022: hallucination monitoring

export interface QualityWindow {
  days: number;
  answers: number;
  ungrounded: number;
  /** Percent of answers that failed the grounding check; null when there were none. */
  rate: number | null;
}

export interface UngroundedExample {
  traceId: string;
  createdAt: string;
  question: string;
  answer: string | null;
  unsupported: Unsupported[];
  mode: AssistantMode;
  model: string | null;
  level: OversightLevel | null;
}

export interface QualityReport {
  /** Percent. A rate at or above it raises the alert. */
  target: number;
  windows: QualityWindow[];
  alert: boolean;
  alertMessage: string | null;
  latestUngrounded: UngroundedExample[];
  usage: { generatedToday: number; dailyLimit: number };
  corpus: CorpusInfo;
}

const percentOf = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : null);

/** The windows, the alert and its words, from the counts. Pure. */
export function summariseQuality(counts: { days: number; answers: number; ungrounded: number }[], target: number = HALLUCINATION_TARGET) {
  const windows: QualityWindow[] = counts.map((c) => ({ ...c, rate: percentOf(c.ungrounded, c.answers) }));
  const breached = windows.filter((w) => w.rate !== null && w.rate >= target);
  return {
    windows,
    alert: breached.length > 0,
    alertMessage: breached.length
      ? breached
          .map((w) => `${w.ungrounded} of ${w.answers} answers in the last ${w.days} days failed the grounding check (${w.rate}%, target below ${target}%).`)
          .join(' ')
      : null,
  };
}

/** Answers checked, answers that failed, and the rate, over the last 7 and 30 days, with the latest examples (staff only). */
export async function getQuality(): Promise<QualityReport> {
  const [counts, examples, today, corpus] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS answers_7,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days' AND grounding->>'grounded' = 'false')::int AS ungrounded_7,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS answers_30,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days' AND grounding->>'grounded' = 'false')::int AS ungrounded_30
       FROM assistant_interactions WHERE grounding->>'grounded' IS NOT NULL`
    ),
    pool.query(
      `SELECT trace_id, created_at, question_redacted, answer, grounding, mode, model, level
       FROM assistant_interactions WHERE grounding->>'grounded' = 'false' ORDER BY created_at DESC, id DESC LIMIT $1`,
      [UNGROUNDED_EXAMPLES]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS answers FROM assistant_interactions
       WHERE mode IN ('ai', 'stub') AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`
    ),
    getCorpusInfo(),
  ]);
  const c = counts.rows[0];
  const summary = summariseQuality([
    { days: 7, answers: c.answers_7, ungrounded: c.ungrounded_7 },
    { days: 30, answers: c.answers_30, ungrounded: c.ungrounded_30 },
  ]);
  return {
    target: HALLUCINATION_TARGET,
    ...summary,
    latestUngrounded: examples.rows.map((r: any) => ({
      traceId: r.trace_id,
      createdAt: r.created_at,
      question: r.question_redacted,
      answer: r.answer,
      unsupported: r.grounding?.unsupported ?? [],
      mode: r.mode,
      model: r.model,
      level: r.level,
    })),
    usage: { generatedToday: today.rows[0].answers, dailyLimit: dailyLimit() },
    corpus,
  };
}

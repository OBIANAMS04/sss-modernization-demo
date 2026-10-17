// STORY-020 evaluation harness for the policy assistant. It asks every question of the golden set
// (backend/policy-docs/golden.json) through the running API, as a signed-in person would, and scores what comes back:
//   retrieval hit rate   the share of questions whose expected passage is among the passages retrieved (every mode)
//   fact accuracy        the share of the expected key facts that the answer contains (AI and stub modes)
//   citation validity    the share of citations that name a retrieved passage and quote text really in its document
//   grounded rate        the share of answers that passed the grounding check (STORY-022)
// It writes the results to the JSON file named on the command line and exits 1 when a threshold is missed:
//   retrieval at least 0.90; and, in AI mode, facts at least 0.85, citations all valid and grounded at least 0.98 (the 2% target).
// In passages-only mode only retrieval is scored; in stub mode the stand-in is not a model, so only retrieval and the
// citations (which must always be valid) are enforced. Local backend only (see ../e2e/lib.mjs); each synthetic person asks at
// most 15 questions, below the 20 an hour the API allows.
//   cd backend && AI_PROVIDER=stub PORT=3005 npm start
//   E2E_BASE=http://localhost:3005/api node scripts/ai/eval.mjs docs/evidence/story-020/eval-stub.json
// With a real key (ANTHROPIC_API_KEY on the backend, no AI_PROVIDER) the same command scores the model against all four thresholds.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, account, call, stamp } from '../e2e/lib.mjs';

const DOCS = fileURLToPath(new URL('../../backend/policy-docs/', import.meta.url));
const PER_PERSON = 15;
const THRESHOLDS = { retrieval: 0.9, facts: 0.85, citations: 1, grounded: 0.98 };

const output = process.argv[2];
if (!output) {
  console.error('Usage: node scripts/ai/eval.mjs <results.json>   (E2E_BASE points at a local backend)');
  process.exit(2);
}

const normalise = (text) => String(text).toLowerCase().replace(/[,$]/g, '').replace(/\s+/g, ' ').trim();
const ratio = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);
const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null);

// EVAL_GOLDEN points at another set of questions (a draft, or a copy to prove the harness fails when it should)
const golden = JSON.parse(readFileSync(process.env.EVAL_GOLDEN || `${DOCS}golden.json`, 'utf8')).questions;
const documents = Object.fromEntries(
  readdirSync(DOCS)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => [file.replace(/\.md$/, ''), readFileSync(`${DOCS}${file}`, 'utf8').replace(/\r\n?/g, '\n')])
);
// One hash over the documents, so a results file says which version of the corpus it scored
const corpusSha256 = createHash('sha256').update(Object.entries(documents).map(([slug, text]) => `${slug}\n${text}`).join('\n')).digest('hex');

/** True when the fact (a phrase, or a list of alternatives) is in the answer. */
const hasFact = (answer, fact) => [fact].flat().some((alternative) => normalise(answer).includes(normalise(alternative)));

/** True when the citation names a passage that was retrieved and quotes text that is in that passage's document. */
function citationIsValid(citation, retrievedIds) {
  const slug = String(citation.passageId).split(':')[0];
  return retrievedIds.includes(citation.passageId) && slug in documents && normalise(documents[slug]).includes(normalise(citation.quote));
}

async function main() {
  const people = [];
  for (let i = 0; i < Math.ceil(golden.length / PER_PERSON); i++) {
    people.push(await account(`eval-assistant-${stamp}-${i}@example.com`, `Eval Assistant ${i}`));
  }

  const results = [];
  for (const [index, q] of golden.entries()) {
    const person = people[Math.floor(index / PER_PERSON)];
    const started = Date.now();
    const res = await call('POST', '/assistant/ask', person.token, { question: q.question });
    const latencyMs = Date.now() - started;
    const data = res.status === 200 ? res.data : null;
    const retrievedIds = (data?.retrieved ?? []).map((r) => r.passageId);
    const answer = data?.answer ?? null;
    const citations = data?.citations ?? [];
    const hit = q.expectedPassages.some((id) => retrievedIds.includes(id));
    const factsMissing = answer === null ? q.facts : q.facts.filter((fact) => !hasFact(answer, fact));
    results.push({
      id: q.id,
      question: q.question,
      httpStatus: res.status,
      mode: data?.mode ?? null,
      status: data?.status ?? null,
      level: data?.level ?? null,
      latencyMs,
      expectedPassages: q.expectedPassages,
      retrieved: retrievedIds,
      retrievalHit: hit,
      answer,
      facts: q.facts.length,
      factsFound: q.facts.length - factsMissing.length,
      factsMissing,
      citations: citations.length,
      invalidCitations: citations.filter((c) => !citationIsValid(c, retrievedIds)).map((c) => ({ passageId: c.passageId, quote: c.quote })),
      grounded: data?.grounding ? data.grounding.grounded : null,
      error: data ? null : res.data?.error?.message ?? `HTTP ${res.status}`,
    });
    console.log(`${hit ? 'hit ' : 'MISS'} ${q.id} ${data ? `${data.mode}/${data.status}/level ${data.level}` : `ERROR ${res.status}`}  ${q.question}`);
  }

  const modes = [...new Set(results.map((r) => r.mode).filter(Boolean))];
  const mode = modes.length === 1 ? modes[0] : modes.length === 0 ? null : 'mixed';
  const answered = results.filter((r) => r.mode === 'ai' || r.mode === 'stub');
  const graded = results.filter((r) => r.grounded !== null);
  const factsExpected = answered.reduce((n, r) => n + r.facts, 0);
  const factsFound = answered.reduce((n, r) => n + r.factsFound, 0);
  const citationsTotal = results.reduce((n, r) => n + r.citations, 0);
  const citationsInvalid = results.reduce((n, r) => n + r.invalidCitations.length, 0);
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);

  const metrics = {
    questions: results.length,
    retrievalHitRate: ratio(results.filter((r) => r.retrievalHit).length, results.length),
    // The facts of every question count, so an answer that was withheld or missing scores zero for its facts
    factAccuracy: answered.length ? ratio(factsFound, factsExpected) : null,
    questionsWithAllFacts: answered.length ? results.filter((r) => r.mode && r.mode !== 'passages-only' && r.factsMissing.length === 0).length : null,
    citationValidity: citationsTotal ? ratio(citationsTotal - citationsInvalid, citationsTotal) : null,
    citations: citationsTotal,
    groundedRate: graded.length ? ratio(graded.filter((r) => r.grounded).length, graded.length) : null,
    shown: results.filter((r) => r.status === 'shown').length,
    withStaff: results.filter((r) => r.status === 'with-staff').length,
    noAnswer: results.filter((r) => r.status === 'no-answer').length,
    errors: results.filter((r) => r.error).length,
    levels: Object.fromEntries([0, 1, 2].map((level) => [level, results.filter((r) => r.level === level).length])),
    latencyMs: { median: percentile(latencies, 50), p95: percentile(latencies, 95) },
  };

  // Enforced only where the number means something: retrieval always; the rest for the real model (AI mode), and the citations
  // also for the stand-in, where they must be valid by construction
  const ai = mode === 'ai';
  const checks = [
    { name: 'retrieval hit rate', value: metrics.retrievalHitRate, min: THRESHOLDS.retrieval, enforced: true },
    { name: 'fact accuracy', value: metrics.factAccuracy, min: THRESHOLDS.facts, enforced: ai },
    { name: 'citation validity', value: metrics.citationValidity, min: THRESHOLDS.citations, enforced: ai || mode === 'stub' },
    { name: 'grounded rate', value: metrics.groundedRate, min: THRESHOLDS.grounded, enforced: ai },
  ].map((c) => ({ ...c, passed: !c.enforced || (c.value !== null && c.value >= c.min) }));
  const errored = metrics.errors > 0;
  const passed = checks.every((c) => c.passed) && !errored;

  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(
    output,
    JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, mode, modes, corpusSha256, metrics, thresholds: checks, passed, results }, null, 2) + '\n'
  );

  console.log(`\nmode: ${mode ?? 'none'}   corpus ${corpusSha256.slice(0, 12)}   ${results.length} questions   median ${metrics.latencyMs.median} ms, p95 ${metrics.latencyMs.p95} ms`);
  for (const c of checks) {
    const shown = c.value === null ? 'n/a' : c.value.toFixed(3);
    console.log(`${c.enforced ? (c.passed ? 'PASS' : 'FAIL') : 'info'}  ${c.name}: ${shown} (threshold ${c.min}${c.enforced ? '' : ', not enforced in this mode'})`);
  }
  console.log(`      answers: ${metrics.shown} shown, ${metrics.withStaff} with a case manager, ${metrics.noAnswer} no answer, ${metrics.errors} errors; levels ${JSON.stringify(metrics.levels)}`);
  if (errored) console.log(`FAIL  ${metrics.errors} question(s) got an error instead of a response`);
  console.log(`results written to ${output}`);
  console.log(passed ? '\nALL PASSED' : '\nBELOW THRESHOLD');
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR', e.stack);
  process.exit(1);
});

# R2 Milestone 1: policy assistant with human oversight (7 stories)

The story list summarizes R2 in one line per story, so the acceptance criteria below are ours, written 2026-10-15
for this milestone. Everything is demonstrated on a synthetic demo deployment; nothing here is operating in production.

## Design decisions
- **Model:** Claude through the official `@anthropic-ai/sdk`, default model `claude-opus-5-5`, overridable with
  `AI_MODEL`. The key comes from `ANTHROPIC_API_KEY` (Render environment; never in the repo or chat). The server-side
  refusal fallback is enabled.
- **No LangChain or LangSmith:** retrieval is PostgreSQL full-text search over our own passages, and grounding uses
  Claude's native citations, which return the exact policy text behind each statement. This means fewer moving parts
  and no extra accounts; the trade-off is recorded in the framework's decisions.
- **Corpus:** synthetic policy documents written for the demo, built on the demo's illustrative exemption rules (Types
  A, B and C), the appeal process, the documents required, privacy, and case statuses. They are clearly labelled as
  not Selective Service policy.
- **No key, no AI:** without `ANTHROPIC_API_KEY` the assistant returns the most relevant policy passages and says that
  AI answers are off. Tests use a deterministic stub (`AI_PROVIDER=stub`); the evaluation runs against the real model
  once a key is set.
- **The assistant never decides eligibility.** Questions about a person's own case or eligibility are routed to people
  (STORY-023).

## Stories and acceptance criteria
| Story | Title | Acceptance criteria |
|---|---|---|
| 017 | Policy corpus and ingestion | Markdown policy documents in `backend/policy-docs/` are split into passages and stored with a full-text index (migration 020). They are re-ingested at startup when content changes, versioned by content hash, and audited. |
| 018 | Cited answers API | `POST /api/assistant/ask` (signed in) retrieves the top passages and asks Claude to answer only from them, with native citations. It returns the answer, the citations (passage, quoted text) and a trace id. SSN-shaped text is stripped from questions before anything is sent. Every exchange is stored and audited. Each person has an hourly limit and there is a daily cost cap. |
| 019 | Assistant page | A page at `/assistant` for citizens and staff: question, answer with numbered citations that open the passage, its oversight status, and feedback (helpful, not helpful, report a problem). It passes the WCAG 2.1 AA audit. |
| 020 | Evaluation harness | A golden set of at least 25 questions with their expected passages and key facts. `scripts/ai/eval.mjs` reports retrieval hit rate, fact accuracy and citation validity, and fails below set thresholds. Results are kept as evidence. |
| 022 | Hallucination monitoring | Every answer is checked: each statement needs a citation, and any number, date or amount must appear in a cited passage. Ungrounded answers are withheld (see 023). A staff page shows the hallucination rate for the last 7 and 30 days against a target below 2%, with an alert. |
| 023 | Human-in-the-loop ladder | Level 0: a grounded answer with high confidence is shown. Level 1: a grounded answer with lower confidence is shown with "check with a case manager". Level 2: ungrounded answers, personal eligibility or case questions, and reported answers are withheld and go to a staff review queue. Staff approve or correct the answer, and the person is notified. Every step is audited. |
| 024 | Override rate tracking | The override rate is the share of reviewed items that staff changed: corrected assistant answers, compliance exception overrides, and decisions against the automatic eligibility result. It is shown with a trend on the admin and leadership dashboards against a target below 20%, with an alert. |

Next milestone: 021 drift detection, 025 bias and fairness testing, 026–029 observability.

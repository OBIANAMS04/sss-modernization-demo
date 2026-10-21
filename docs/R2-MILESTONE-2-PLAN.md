# R2 Milestone 2: drift, fairness and observability (6 stories)

The story list summarizes these stories in one line each, and names two vendors: LangSmith for drift (STORY-021) and
Datadog with OpenTelemetry for observability (STORY-026 to 029). The acceptance criteria below are ours, written
2026-10-20 for this milestone. Everything is demonstrated on a synthetic demo deployment; nothing here is operating in
production. This milestone completes R2 (11 of 11 with milestone 1).

## Design decisions
- **No LangSmith (as decided for milestone 1, 2026-10-15).** Drift is measured from the demo's own records: every
  answer is already stored with its mode, model, grounding result, oversight level, citations, feedback and latency
  (migration 020), and the 33-question golden set from STORY-020 can be re-run on demand. No extra account or service.
- **Datadog-ready, not Datadog-dependent.** The API is instrumented with OpenTelemetry (traces and metrics). When
  `OTEL_EXPORTER_OTLP_ENDPOINT` is set, everything is exported over OTLP, which the Datadog Agent and every major
  backend accept; with nothing set, the demo keeps its own rollups in PostgreSQL and shows them on its own dashboard.
  So the demo works without a Datadog account, and switching to Datadog is configuration, not code.
- **No new protected data.** The demo does not collect race, sex, ethnicity, religion, disability or national origin,
  and this milestone does not add them. Fairness is tested counterfactually (change only an irrelevant detail, such as a
  name, a place or the phrasing, and the outcome must not change) and monitored on the groups the demo already holds
  (age band from the date of birth, and region from the address). Age is an input to the Type A rule by design; that is
  stated, not hidden.
- **Real model runs cost money.** A server-side evaluation or fairness run calls Claude once per question (about $1 or
  less per run at current prices). Only an administrator can start one, at most once an hour, and each run is audited.
  Tests use the stub.
- **Every new route gets its access rule in the same change** (`ROUTE_ACCESS`, `docs/SECURITY-RULES.md`) and its OPA
  rule. Every new page passes the WCAG 2.1 AA audit.

## Stories and acceptance criteria
| Story | Title | Acceptance criteria |
|---|---|---|
| 021 | Drift detection | (1) Daily quality signals from real AI answers: grounded rate, withheld rate, level-1 share, no-answer rate, citations per answer, answer length, p95 latency, negative feedback and report rate. (2) Drift compares the last 7 days with the 28 days before; each signal has a tolerance (for example grounded rate down more than 2 points, p95 latency up more than 50%) and a minimum sample (20 answers, else "not enough data"). (3) Evaluation runs are stored (`assistant_eval_runs`: model, corpus version, mode, the four scores, who started it); an administrator can start the golden set server-side, and can mark a run as the baseline; a run below a threshold or more than 5 points under the baseline is drift. (4) A change of model (as the API reports it) or of corpus version is recorded and shown on the trend. (5) Drift raises an alert: an audit event and a notification to administrators, once until it clears. (6) An AI Quality page for staff shows the signals with their trend, the change markers, the latest run against the baseline, and the open alerts. |
| 025 | Bias and fairness testing | (1) Eligibility and compliance rules: a counterfactual test matrix (names associated with different genders and ethnicities, every US region, phone and address formats) shows identical outcomes; it runs in the unit tests. (2) Assistant: a counterfactual question set (10 questions, each in variants that change only the asker's stated name, gender, ethnicity, age wording, disability mention or English fluency) must keep the retrieved passages identical in at least 95% of pairs, the outcome for the person equal (an answer, or a referral to a case manager) in at least 95% (changed 2026-10-21 from "the oversight level equal", see the end of this plan), and the key facts present in every variant; run with the stub in tests and against Claude by an administrator, stored like evaluation runs. (3) Outcome monitoring: approval rate, average days to decide and override rate by age band and by region, with the four-fifths rule (a group's approval rate under 80% of the highest group's is flagged) and a minimum sample (10 decisions). (4) A Fairness section on the AI Quality page with the latest counterfactual results and the group table, and a plain statement of what the demo does not collect and why. |
| 026 | Tracing and structured logs (OpenTelemetry) | (1) OpenTelemetry for HTTP, Express and PostgreSQL, plus a span for each Claude call (model, tokens, latency, outcome; never the question or the answer). (2) Every response carries its trace id (`traceparent` and `X-Request-Id`); every log line is JSON with the trace id; audit entries record it. (3) OTLP export when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (documented for the Datadog Agent), otherwise nothing leaves the server. (4) No personal data in spans or logs (the existing redaction rules apply). |
| 027 | Service and AI metrics | (1) Per route, per minute: request count, error count (5xx and 4xx apart), and p50/p95/p99 duration, stored as rollups in PostgreSQL and kept 30 days. (2) Database query time and pool use. (3) AI usage on every call: input, output and cache tokens and an estimated cost (migration adds them to `assistant_interactions`), by day, against the daily cap. (4) The same metrics are exported to OpenTelemetry when an endpoint is set. |
| 028 | Observability dashboard | An Observability page for administrators: service health (database, migrations, commit, uptime since the last start), request and error rates over 24 hours and 7 days, latency by route against the 2-second p95 target, the slowest routes, recent server errors with their trace ids, AI calls, tokens and cost per day against a budget, and the open alerts. It passes the WCAG 2.1 AA audit, with every chart also given as a table. |
| 029 | SLOs and alerting | (1) Service level objectives, defined in one place: availability 99.5% (non-5xx share), p95 latency under 2 s, error rate under 1%, AI spend under the daily budget, and the drift and fairness checks of 021 and 025. (2) Each is evaluated every minute over a 1-hour and a 24-hour window; a breach opens an alert (audit event plus a notification to administrators), deduplicated, and closes it when it recovers. (3) Alert history on the Observability page. (4) A runbook entry per alert: what it means and what to check first. |

## Order of work
1. Helper A (Sonnet): STORY-021 and 025, backend first (migration, services, routes with access rules, unit tests,
   end-to-end suite), then the AI Quality page, evidence script and accessibility audit entries.
2. Helper B (Sonnet): STORY-026 to 029, the same way.
3. Opus: review each helper's work, run every check, deploy, verify on the demo deployment, run the real-model
   evaluation and fairness runs, update the framework, post the milestone, and at the end of R2 update the demo
   slide deck and briefing (decided by Obi on 2026-10-20).

## Change to the STORY-025 criterion and the system prompt (2026-10-21)
The first real-model runs (2026-10-20) found two problems. The evaluation's grounded rate was 84.8% (target 98%), and the fairness run kept
the same passages in 60 of 60 pairs but the same oversight level in only 41 of 60. The stored answers show two causes:
1. Some answers opened with a sentence of the model's own ("No, it is not required.", "To create an account, you need these things.").
   Such a sentence has no citation, so the grounding check withheld the whole answer. A statement about the asker made such an opener more
   likely. Fix: the system prompt now tells the model to begin with a sentence the documents say, and not to respond to anything the person
   says about themselves.
2. Level 0 against level 1 (shown plainly, or with "please confirm with a case manager") turns on how many passages the model cites and how
   much of its answer it covers, which varies between two calls of the same question. One sample per variant cannot separate that from the
   asker. Fix: the criterion is now the outcome the person gets, answered or referred (95%). Level agreement is still reported, next to the
   agreement of the unchanged question asked a second time, so a level difference is read against the model's own variation. A run asks 80
   questions instead of 70.

The evaluation's 98% grounded target is unchanged.

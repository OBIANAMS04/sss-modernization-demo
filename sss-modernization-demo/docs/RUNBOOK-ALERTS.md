# Runbook: alerts

One entry per alert the service can open (STORY-029). Each alert on the Observability page (administrators only, `/observability`) links
to its entry here. All of this is a synthetic demonstration: the same entries would apply to a production deployment, and the on-call
person would be a person; here it is whoever administers the demo.

How alerts work, in short:

- Every minute the server measures itself over the last hour and the last 24 hours (`backend/src/observability/slo.ts` defines the
  objectives in one place, `sloService.ts` evaluates them). A breach opens one alert, writes an audit event (`SLO_ALERT`, phase `opened`)
  and sends a notification to every administrator. A breach that lasts does not alert again.
- When the measure is back inside its target, the alert closes by itself and an audit event (phase `cleared`) says so. Nothing needs to
  be clicked. **Close** below says what to do so that it does.
- With fewer than 20 requests in a window the service cannot judge, so it reports "no data" and does not alert.
- The AI quality alerts (drift, fairness) are opened by the AI quality checks of STORY-021 and STORY-025. They are run on the same
  timer every five minutes, so an alert no longer waits for someone to open the page.
- "Check now" on the Observability page evaluates everything immediately.
- Trace ids: every response carries `X-Request-Id` (the trace id); every log line is JSON with a `trace_id`; every audit entry made by
  a request records it. "Recent server errors" on the page lists the trace id of each failure.

<a id="availability"></a>

## Availability below 99.5%

**Alert text:** "Availability in the last hour is 97.2% (target 99.5%): 14 of 500 requests ended in a server error." (key `availability:1h` or `availability:24h`)

**What it means.** More than 0.5% of requests in the window ended in a server error (HTTP 500 or more): people saw "Internal server
error" or the service did not answer. Client errors (400 to 499, such as a wrong password or a missing page) do not count.

**First checks.**
1. Observability, "Recent server errors": which routes, one or many? Note the error class and code (for example `22P02` is an invalid value sent to PostgreSQL).
2. Take a trace id from that list and search the logs for it (`"trace_id":"..."`); the lines before the error show what the request did.
3. Is the database reachable? The health panel at the top of the page says. Did a deploy or a restart just happen? The audit log shows `DEPLOYMENT` and `SERVER_START`.
4. On the free Render plan a restart after idle can fail the first few requests while the database wakes.

**How to close.** Fix the cause (a bad deploy: redeploy the previous commit from Render). The alert closes when availability in the
window is 99.5% or better. The 1-hour alert clears within the hour; the 24-hour one when the failed requests age out of the day.

<a id="latency"></a>

## p95 latency over 2 seconds

**Alert text:** "The p95 request duration in the last hour is 2.4 s (target under 2 s)." (key `latency:1h` or `latency:24h`)

**What it means.** One request in twenty, or more, took 2 seconds or longer. The figure is the 95th percentile over every request in the window.

**First checks.**
1. "Latency by route" and "Slowest routes": is one route responsible, or all of them?
2. "Database" on the page: slow queries (average, p95) or a pool with requests waiting point at PostgreSQL rather than the code.
3. Did the service just wake from idle (Render free plan)? The first requests after a wake are slow; the 1-hour alert then clears by itself.
4. Was an evaluation or fairness run in progress? Those ask the model dozens of questions in the background.

**How to close.** Fix or scale the slow route or query (the trace of a slow request shows which database call took the time). The alert
closes when the window's p95 is under 2 seconds again.

<a id="error-rate"></a>

## A route failing more than 1% of requests

**Alert text:** "POST /api/cases ended 2% of its requests in a server error in the last hour (1 of 50; target under 1%)." (key `error-rate:1h` or `error-rate:24h`)

**What it means.** One route, named in the alert, ended 1% or more of its requests in a server error, even if the service as a whole is
fine. Only routes with at least 20 requests in the window are judged.

**First checks.**
1. Find that route in "Recent server errors"; note the error class and code.
2. Search the logs for the trace ids listed: the `Error:` line has the stack.
3. Reproduce the request with the same kind of input. Routes are shown as templates (`/api/cases/:id`); the record id is never in the alert.

**How to close.** Fix the route. The alert closes when no route is at or above 1% in the window.

<a id="ai-spend"></a>

## AI spend over budget

**Alert text:** "Estimated AI spend in the last 24 hours is $2.40, over $2.00, the daily budget of $2.00." or "... in the last hour is $0.62, over $0.50, a quarter of the daily budget of $2.00." (key `ai-spend:24h` or `ai-spend:1h`)

**What it means.** The estimated cost of model calls (questions to the policy assistant, plus evaluation and fairness runs) is over the
daily budget, set by `AI_DAILY_BUDGET_USD` (default 2). In any one hour, more than a quarter of the daily budget also alerts, so a
runaway shows within the hour. The cost is an estimate from the list prices in `backend/src/services/aiPricing.ts`; the provider's
billing page is the source of truth.

**First checks.**
1. "AI usage per day": calls, input, output and cache tokens, and cost. Did an evaluation or fairness run cause it (each asks the model every question)? The AI Quality page lists the runs.
2. Cache read tokens near zero mean every call paid the full input price: check that the system prompt is still long enough to be cached and unchanged.
3. Is one person asking many questions? The per-person limit is `AI_DAILY_LIMIT`.

**How to close.** The spend ages out of the window and the alert closes. If the spend was intended, raise `AI_DAILY_BUDGET_USD` in the
hosting dashboard and restart; the next check closes the alert. To stop the spend now, set `AI_PROVIDER=off` (the assistant then shows the policy text only).

<a id="ai-drift"></a>

## Answer quality drift

**Alert text:** "groundedRate moved from 100% to 90%." or "The latest evaluation run is a drift: ..." (kind `signal` or `eval`, STORY-021)

**What it means.** A daily quality signal of the policy assistant (grounded rate, withheld rate, and so on) has moved away from its
recent baseline, or the latest evaluation run fell under its thresholds or well under the baseline run.

**First checks.**
1. AI Quality: which signal? Is there a change marker (a new model, or a new version of the policy documents) just before it?
2. The failures of the latest evaluation run: which questions, and what the answer lacked.

**How to close.** Fix the cause (restore the model setting or the documents, correct the prompt), start a new evaluation run (an
administrator, once an hour), and mark it as the baseline if the new level is intended. The alert closes when the signal is back inside its bounds.

<a id="ai-fairness"></a>

## Answer fairness check failed

**Alert text:** the reason the latest fairness run missed its criteria. (kind `fairness`, STORY-025)

**What it means.** The latest counterfactual run (the same question asked as if about different people or situations) gave answers that
differ where they should not, or a decision outcome rate fell under the four-fifths rule.

**First checks.**
1. AI Quality, Fairness: which question and which variants differ.
2. Did the model or the policy documents change just before the run? A change marker on the AI Quality trend says.

**How to close.** Fix the cause, then start a new fairness run (an administrator, once an hour). The alert closes when the latest run meets its criteria.

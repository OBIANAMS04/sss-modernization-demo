Demonstrated on a synthetic demo deployment; not operating in production.

# Incident response playbook (STORY-037)

Written against commit `e0f664c`. Companion documents: `OPERATOR-RUNBOOK.md` (how to deploy, roll back, rotate secrets, restore), `RUNBOOK-ALERTS.md` (one entry per in-app alert), `FAILOVER.md` (what the service does when its database goes away).

## Demo limit and production practice

This playbook says two things, and keeps them apart:

- **Demo limit.** The demo has one owner, no on-call rota, no paging service and no status page. Alerts reach the owner as in-app notifications to administrators and as GitHub issue emails. Nobody is awake at night for it. The response times below are therefore targets for production, not promises the demo keeps.
- **Production practice.** Where this document says "in production", it describes what an agency deployment should do. It has not been exercised here.

Everything in this repository runs on synthetic data. No real person's information is held, so no incident in the demo can expose real personal data.

## 1. Severity levels

| Level | Meaning | Examples in this system | Production response target (proposed) |
|---|---|---|---|
| SEV1 | The service is down, or data or credentials may have been exposed. | `/health` shows `"database":"down"` or the API does not answer; nobody can sign in; the audit log stops recording; a secret (`JWT_SECRET`, the database password, `ANTHROPIC_API_KEY`) appears in a screenshot, chat or log; someone reads records they have no right to. | Acknowledge within 15 minutes, any hour. Update every 30 minutes until it is stable. |
| SEV2 | A main function is broken or badly degraded, but the service is up. | Availability alert (under 99.5%); one route failing more than 1% of requests; a release that will not promote; the assistant answers wrongly and the grounding check is failing; a migration failed. | Acknowledge within 1 hour in working hours. Update every 2 hours. |
| SEV3 | A function is degraded or a measure is off target; people can still do their work. | p95 latency over 2 seconds; AI spend over budget; AI quality drift or fairness alert; data freshness over target; compliance rate under 99%; the AI provider is unavailable (the assistant falls back to showing policy passages). | Look at it the next working day. |
| SEV4 | Cosmetic, or a question. No effect on work. | A wrong label; a deprecation warning in the logs. | Put it in the backlog. |

Raise a level when the effect is wider than first thought. Lower it only when the lead and the scribe agree and the scribe writes down why.

## 2. Roles

| Role | Does | In this demo team |
|---|---|---|
| Incident lead | Owns the response: decides the severity, assigns work, decides when it is over. One person. | Obi (owner) by default. |
| Communications | Tells people what is happening, on a fixed rhythm, in plain words. Does not guess at causes. | Obi, unless someone else is asked to take it. |
| Scribe | Writes the timeline as it happens (time, what was seen, what was done, by whom). Later writes the review. | Obi, or Claude drafting from the log, with Obi checking it. |
| Decision makers | Decide what the lead may not decide alone: pausing the demo, accepting a risk, approving a production change, spending money (for example a paid plan). Informed at SEV1 and SEV2. | Ali (Managing Director) and Ram. |

In the demo one person holds three roles. In production they are three people, and the lead does not also fix the fault. Claude can investigate and run the checks in this playbook, but a person makes each decision and sends each message.

## 3. Communication

### Internal

- **Where.** A post on the BUILD ticket in Basecamp (project 47346103, todolist 10068241172), starting "@Ali @Ram". One post when the incident is declared, one per update, one when it ends.
- **What each post says.** What people see; since when (UTC); how many are affected, if known; what is being done; when the next update comes. Facts only. Mark guesses as guesses.
- **Evidence.** Attach a screenshot of `/health` or the Observability page, and note the trace id of any failing request.

### Citizen-facing (production practice; the demo has no status page)

A status message names the effect, says whether anything was saved, gives the next update time, and asks for nothing risky. It never names a cause that is not confirmed, never blames a person or a vendor, and never contains personal data.

The application already says this when its database is away (the 503 body that data routes return, with `Retry-After`):

> The service cannot reach its database right now. Nothing you sent was saved. Please try again in a minute; this page will work again by itself once the database is back.

Templates for a status page or a notice:

| Stage | Message |
|---|---|
| Investigating | "We are aware that some people cannot sign in or see their applications. We are looking into it. Nothing you have already submitted is lost. Next update by [time]." |
| Identified | "We have found the cause and are working on a fix. Signing in and applying may fail until then. If you were in the middle of an application, check My Applications before you submit it again. Next update by [time]." |
| Monitoring | "The fix is in place and the service is answering again. We are watching it. If something looks wrong on your page, reload it and sign in again." |
| Resolved | "The problem is fixed. It lasted from [time] to [time]. [One sentence on what people may need to do, for example sign in again.] We will publish a short review within [five] working days." |

If personal data may have been exposed, the agency's breach response plan and its legal reporting duties take over (who must be told, and by when). That belongs to the agency, is not demonstrated here, and must be confirmed against the contract.

## 4. First steps by alert type

Every alert below is raised by code in `backend/src`. For the full "what it means" and "how to close" of the six in-app alerts, read `RUNBOOK-ALERTS.md` (the same text is in the Observability page, section Runbook).

**First, always (two minutes).**
1. Open `https://sss-demo-backend.onrender.com/health`. Read `database`: `ok` (fine), `down` (the API is up, the database is not: go to section 5 and the operator runbook), `starting` (a release is still starting; wait a minute). Read `commit` and `migrations`.
2. Open the Observability page (administrators). Is an alert open? Is the Health section green?
3. Open the GitHub Actions page for "Uptime check" and the open issues labelled `uptime`.
4. Declare a severity (section 1) and tell the people in section 3.

| Alert | Raised by | Where you see it | First steps | Usual severity |
|---|---|---|---|---|
| **Availability under 99.5%** (key `availability:1h` or `availability:24h`) | Objective timer, once a minute (`observability/slo.ts`, `sloService.ts`). Needs 20 requests in the window. | Observability, Alerts; a notification "Service alert: ..." to every administrator; audit entry `SLO_ALERT` | 1. Observability, Recent server errors: one route or many? Note the error class and code. 2. Find a trace id in the logs (`"trace_id":"..."`). 3. Database reachable (`/health`)? A deploy or restart just before (audit log: Deployment, Server restart)? 4. If a bad release: roll back (operator runbook, section 3). | SEV2; SEV1 if sign-in is down for everyone |
| **p95 latency over 2 seconds** (`latency:1h`, `latency:24h`) | Same timer | Same | 1. Latency by route, Slowest routes: one route or all? 2. Database panel: slow queries or waiting connections point at the database. 3. Did the free instance just wake from idle? That clears by itself. 4. Is an AI evaluation or fairness run in progress? | SEV3 |
| **A route failing more than 1% of requests** (`error-rate:1h`, `error-rate:24h`) | Same timer. Only routes with 20 or more requests. | Same | 1. Find the route in Recent server errors. 2. Search the logs for its trace ids, read the stack. 3. Reproduce with the same kind of input. 4. Fix forward or roll back. | SEV2 |
| **AI spend over budget** (`ai-spend:24h` over `AI_DAILY_BUDGET_USD`, default $2; `ai-spend:1h` over a quarter of it) | Same timer | Same | 1. AI calls, tokens and cost per day: did an evaluation or fairness run cause it? 2. Cache read tokens near zero: every call paid full price. 3. One person asking many questions (`AI_DAILY_LIMIT`)? 4. To stop spending now, set `AI_PROVIDER=off` in the Render environment (the assistant then shows policy passages only). | SEV3 |
| **Answer quality drift** (kind `signal`, or `eval:latest-run`) | AI quality check, every fifth minute of the timer (`aiQualityService.ts`) | AI Quality, Open alerts; a notification to administrators; audit entry `AI_DRIFT_ALERT` | 1. Which signal moved? Is there a change marker (new model or new policy documents) just before it? 2. Open the failures of the latest evaluation run. 3. Fix the cause (restore `AI_MODEL`, the documents or the prompt), start a new evaluation (administrator, once an hour, costs about 30 cents), mark it as baseline if the new level is intended. | SEV3; SEV2 if answers are visibly wrong |
| **Answer fairness check failed** (`fairness:latest-run`) | Same check | AI Quality, Fairness; notification; `AI_DRIFT_ALERT` | 1. Which question and which variants differ? 2. Did the model or documents change just before? 3. Fix, then start a new fairness run (once an hour, about 70 cents). | SEV3; raise to SEV2 if a real decision rule is affected |
| **Answer quality target missed** (grounding failures at or above 2% over 7 or 30 days) | Computed when staff open Assistant Reviews (`assistantService.ts`, `HALLUCINATION_TARGET`) | Assistant Reviews, Answer quality | 1. Read the latest ungrounded examples. 2. Check that every withheld answer is waiting in the review queue and is being reviewed. 3. Compare with AI Quality drift for the same period. | SEV3 |
| **Override rate at or above 20%** (30 days) | Computed for the admin and leadership dashboards (`overrideRateService.ts`) | Admin Dashboard and Leadership, Override rate | 1. Which source (assistant, compliance, eligibility) drives it? 2. Is it one reviewer or one rule? 3. Treat a high rate as a sign that a rule or the assistant is wrong, not that reviewers are. | SEV3 |
| **Data freshness over target** (a change not readable within 30 s, or fewer than 95% within it) | Measured on every write (`freshnessService.ts`); a miss writes audit entry `ALERT_TRIGGERED` ("Freshness alert") | Data Freshness page alert; Admin Dashboard, Data freshness | 1. Data Freshness, By data type and Slowest updates: which type? 2. Press Check now for a fresh end-to-end probe. 3. Database slow or pool full (Observability, Database)? There is no cache or replica in the demo, so slowness is the database or the instance. | SEV3 |
| **Compliance: a decision failed a control** | On each approval or denial (`complianceService.ts`); audit entry `COMPLIANCE_ALERT`; opens a review | Compliance, Open reviews; Case page, Compliance panel | 1. Open the review from Compliance. 2. A different case manager resolves it with a written justification: Accept exception or Reopen case. 3. If the failed control is `EVALUATION-ERROR`, the check itself failed: look for "Compliance evaluation failed" in the logs and treat it as a bug (SEV2). | SEV3; SEV2 for `EVALUATION-ERROR` |
| **Compliance rate under 99%** (window of 7, 30 or 90 days as chosen) | Computed when the page is read | Compliance, top banner; Admin Dashboard | 1. Which control fails most (Decision controls)? 2. Are reviews open and being worked? | SEV3 |
| **Uptime check issue "Demo is down or degraded"** | `.github/workflows/uptime.yml` every 30 minutes | A GitHub issue labelled `uptime`, and an email to the repository owner | 1. Open the run linked in the issue; which probe failed, API or site? 2. `/health`: `database` value. 3. Render dashboard: service state, database state, recent deploys and events. 4. The issue closes itself on recovery. | SEV1 if the API or database is down |
| **`verify-deploy.mjs` ends "NOT VERIFIED"** | `scripts/verify-deploy.mjs` after a push | The terminal | Read the JSON above the verdict: wrong or old commit served, stale page paths, a protected route that did not answer 401 (SEV1: an open route), a database that is not `ok`. See operator runbook, section 2. | SEV2; SEV1 for an open route |

**A secret is exposed (not an alert, always SEV1).** Rotate it first, ask questions after. Steps are in `OPERATOR-RUNBOOK.md`, section 4. Then read the audit log (Security Audit Log) for the exposure window.

## 5. Working an incident

1. **Declare.** Pick a severity; name lead, communications and scribe; post the first internal message.
2. **Stabilise before you diagnose.** The usual stabilising moves are: roll back the last release; restore the database; set `AI_PROVIDER=off`; rotate a secret. Prefer the move that is easiest to undo.
3. **Keep the timeline.** The scribe writes each action with the time. Do not rely on memory.
4. **Change one thing at a time.** Check `/health` and the Observability page after each change.
5. **Verify the fix from outside.** Run `node scripts/verify-deploy.mjs <commit>` (from `sss-modernization-demo/`) and, for access problems, `node scripts/verify-live-citizen.mjs`.
6. **Close.** Post the resolution, wait for the uptime issue to close, and schedule the review (section 6) within five working days.

## 6. Post-incident review (blameless)

A review asks how the system and the process allowed this to happen, never who made a mistake. People did what made sense with what they knew. Findings are changes to the system, each with an owner and a date. Template: summary, impact, timeline, root cause, detection, what went well, what went badly, where we were lucky, actions.

### Worked example: the database expiry outage, 16 to 19 October 2026

**Summary.** The demo's PostgreSQL database was on Render's free plan, which expires after 30 days. It expired on 16 October 2026. From 17 October the API could not start, because it exited when it could not reach its database and Render kept restarting it. The site (a static site) stayed up and showed a sign-in page that could not sign anyone in. Nothing outside Render noticed. The database was moved to a paid plan on 19 October, with its data, and the API redeployed.

**Impact.**
- About 3 days (17 to 19 October) with no sign-in and no data route. Anyone opening the demo, including the decision makers reviewing it, saw a working page that failed.
- No data was lost: the paid-plan upgrade kept all of it. Synthetic data only.
- Development continued during the outage (there are commits on 17 October), but none of it could be checked against the live API.

**Timeline (UTC dates; hours were not recorded).**

| Date | Event | Source |
|---|---|---|
| 2026-09-16 | First Render deploy. The free database was created around then; the exact creation date is not recorded. | Framework, timeline |
| 2026-10-16 | The free database expires (30 days after creation). | Framework, timeline |
| 2026-10-17 | From this date the API cannot start. The site stays up. Development continues. | Framework, timeline; commit log |
| 2026-10-19 | The outage is found and `sss-demo-db` is upgraded to the paid Basic plan ($6 a month); data kept. The API is redeployed and verified (API `0ad66ad`). | Framework, decisions log |
| 2026-10-20 | R2 milestone 1 is posted; the assistant answers live with the AI key. | Framework, timeline |
| 2026-10-21 | STORY-034 (survive a lost database) and STORY-036 (outside uptime check) are in place. | Framework, timeline |

**Not recorded, and therefore not stated here (confirm with the owner):** the exact hour the database expired; whether Render sent an expiry warning email and to which address; who first noticed the failure and how.

**Root cause.**
- *Direct:* a free-plan database has a fixed 30-day life. It was chosen to get the first deploy online quickly and the expiry date was never put in a calendar or a risk list.
- *Why it became an outage:* the API treated a missing database as fatal and exited, so Render restarted it in a loop and nothing could say what was wrong.
- *Why it lasted three days:* every alert in the system lived inside the API. When the API cannot run, it cannot alert. No check ran from outside, and the warning from the host was not watched.

**Detection gap: 3 days.** Time from the start of the outage (17 October) to a person noticing (19 October). Nothing detected it. A person noticed it; how is not recorded.

**What went well.**
- The paid-plan upgrade kept all data.
- The site stayed up, and the failure was in one place.
- The deploy history and logs made the cause plain once someone looked.

**What went badly.**
- No monitoring outside the service.
- The 30-day expiry was a known property of the free plan and was not tracked.
- A failed database connection ended the process instead of degrading.
- No written playbook said who decides to spend money on a fix.

**Where we were lucky.** The data was synthetic and nobody depended on the demo. A production system would have turned the same sequence into a public outage.

**Fixes.**

| Action | Status | Evidence |
|---|---|---|
| Move the database to a paid plan that does not expire. | Done, 2026-10-19 | Framework decisions log |
| STORY-034, reduced mode: if the database cannot be reached at start, the API listens anyway; `/health` answers 200 with `"database":"down"`; data routes answer 503 with `Retry-After`; the startup work retries with backoff (1 s doubling to 30 s) and the API opens by itself; a probe every 5 s reopens or closes the data routes. A release whose migration fails still exits, so a bad release never replaces the working one. | Done | `FAILOVER.md`; `scripts/e2e/failover.mjs` (22 of 22 checks) |
| STORY-036, outside uptime check: a scheduled GitHub Actions workflow reads `/health` and the site's `/version.json` every 30 minutes, opens an issue (an email) on failure and closes it on recovery. It needs `"database":"ok"`, so a degraded API counts as a failure. | Done; first scheduled run needs confirming | `.github/workflows/uptime.yml`; framework risk table |
| `verify-deploy.mjs` fails unless the database answers `ok`, so a deploy check on the day of the outage would have said so. | Done | `scripts/verify-deploy.mjs` |
| Put Render's account emails (billing, expiry, deploy failures) on a mailbox that is read. | Open: confirm in the Render dashboard | not verifiable from the repository |
| Write this playbook and the operator runbook. | Done, STORY-037 and 038 | this document |

**Lessons.** A service cannot be the only thing that watches itself. A time limit on a free resource is a risk with a date and belongs in the risk list. A dependency being gone should make a service say so, not stop.

## 7. Keeping this playbook honest

- Review it after every SEV1 or SEV2, and at least every six months.
- When a new alert is added in code, add its row to section 4 and its entry to `RUNBOOK-ALERTS.md` (a test already fails when the in-app runbook and the objectives drift apart).
- Rehearse: the readiness drill in R3 milestone 3 should include one tabletop run of a SEV1 with a person who did not write this document.

# R3 load testing and performance: STORY-031, 032, 033

Everything here is a synthetic demo measured on a developer laptop and on the small live demo instance. Read "Limits" before quoting
any number. Raw results are the `*.json` files next to this file; `*.samples.jsonl` are the per-second server samples (process CPU,
event-loop delay, memory, database pool) and `*.queries.json` the SQL statements that ran and how long they took.

## Method

- **Tool and journeys** (STORY-030, `scripts/load/`): autocannon 8.0.0 (pinned). Journeys: registrant (register, sign in, profile,
  eligibility, apply), case manager (list, open, decide), assistant (stub only, never the real model), dashboards. The `mixed` scenario
  runs all four at once, split by weight, so a "connection" below is one open connection running one of those journeys. 22 routes.
- **Local stack** (STORY-031): the compiled backend (`dist`), a fresh PostgreSQL 18 database per run, `AI_PROVIDER=stub`, started by the
  harness with a sampler preloaded (`sampler.cjs`). The sampler reads process CPU, event-loop delay, memory and the pool every second
  and times every SQL statement; it changes nothing in the application. Each run first creates the synthetic accounts through the API
  (6 case managers, 1 administrator, 1 leadership user, 40 citizens of whom 30 apply, 100 assistant users).
- **Profiles**: `ramp` (4, 8, 16, 32, 64, 128 connections, 20 s each), `hold` (16 connections, 60 s), `spike` (4, then 64 for 20 s, then 4).
- **Breaking point**: the first ramp step where p95 passes 2 s or errors pass 1%.
- **Live run** (STORY-032): `E2E_ALLOW_REMOTE=1`, 25 connections for 60 s, read-mostly routes (`/exemptions`, `/cases`,
  `/dashboards/citizen`, `/notifications`, `/users/:id`) with one synthetic `@example.com` account registered for the run, plus five
  sign-ins of that account one at a time. No AI route is called live (it costs the owner money), no staff account is created, nothing
  is written beyond that one registration. The instance was woken first (`GET /health`, 2.3 s).
- **Before and after**: "before" is the build at the start of STORY-033 (`dist-before`, STORY-034 included), "after" is the final
  build, both run through the same harness arguments on the same machine within the same hour.

## Reading the numbers: this laptop was the constraint

Three things about the machine, measured while working, shape every local number:

1. Security software on the laptop sits in the loopback path. A plain Node HTTP server answering a plain Node client on the same machine
   took 9 to 30 ms per request (it should take well under 1 ms), and connecting to `localhost` sometimes took seconds, while a database
   connection by `127.0.0.1` answered `select 1` in 0.13 ms when idle. The harness therefore uses `127.0.0.1` everywhere.
2. Under load a statement as simple as `SELECT role FROM users WHERE id = $1` took about 40 ms (event-loop delay of 20 to 140 ms; socket
   writes were the largest block in a CPU profile, 62% of the time the process was idle waiting). The server was waiting on I/O, not
   computing.
3. A quieter run earlier the same day, before fixes, reached about 170 requests/s on the same journeys (p95 under 150 ms up to 16
   connections, breaking at 128). That file was not kept (it was overwritten while re-running), so it is a recollection of the printed
   table, not evidence. The relative comparisons below were made back to back and are the evidence.

So absolute requests per second here are a property of this laptop on this day. What does not depend on it: statements per request, the
defects found, and which resource saturates first.

## STORY-031: capacity on the local stack

Before the fixes (`ramp-before.json`, the STORY-034 build):

| Connections | req/s | p50 ms | p95 ms | p99 ms | Errors | Process CPU % | Event-loop mean ms | Pool waiting (max) |
|---|---|---|---|---|---|---|---|---|
| 4 | 31.6 | 73 | 321 | 997 | 0% | 57 | 19 | 0 |
| 8 | 24.8 | 184 | 904 | 3,971 | 0% | 49 | 47 | 14 |
| 16 | 23.3 | 425 | 1,885 | 4,559 | 0% | 63 | 66 | 23 |
| **32** | 18.0 | 1,083 | **5,310** | 9,121 | 0% | 73 | 56 | 95 |
| 64 | 54.6 | 231 | 1,129 | 17,354 | 96.4% | 90 | 119 | 181 |
| 128 | 36.1 | 1,757 | 11,761 | 12,000 | 97.8% | 77 | 110 | 129 |

- **Breaking point before: 32 connections** (p95 5.3 s; 16 connections was 1.9 s, just under). At 64 and above, 96 to 98% of requests
  failed: that is the defect in "Findings" below (the API wrongly closed itself as "database down" when its pool ran dry).
- **What saturates first**: the database connection pool (10) fills at 8 connections (waiting 14, then 95 at 32, over 300 at 128),
  then the event loop lags (mean delay 47 to 120 ms where about 11 ms is the sampler's own timer) with the process near one core of
  CPU. CPU never reached the 8 cores; the slowest routes are the ones that hash (`POST /auth/register` p50 4 s, `POST /auth/login` 2.9 s
  at 32 connections).
- **Generator limit**: autocannon and the server shared this laptop. The load generator was not the limit (it used far less than a
  core), but 128 connections from one machine behind the slowed loopback is the most this setup can say anything about.

After all STORY-033 changes (`ramp-final.json`):

| Connections | req/s | p50 ms | p95 ms | p99 ms | Errors | Process CPU % | Event-loop mean ms | Pool waiting (max) |
|---|---|---|---|---|---|---|---|---|
| 4 | 40.3 | 50 | 344 | 796 | 0% | 62 | 21 | 0 |
| 8 | 53.2 | 79 | 561 | 994 | 0% | 88 | 27 | 2 |
| 16 | 52.6 | 160 | 952 | 1,957 | 0% | 99 | 56 | 7 |
| **32** | 43.3 | 430 | **2,540** | 3,920 | 0% | 99 | 139 | 39 |
| 64 | 49.3 | 691 | 4,477 | 6,760 | 0% | 104 | 115 | 67 |
| 128 | 48.1 | 1,335 | 6,469 | 10,617 | 0% | 114 | 83 | 320 |

- **Breaking point after: 32 connections** (p95 2.5 s), and **no errors at any step**. The p95 at 16 connections halved (1.9 s to 0.95 s)
  and the sustainable rate roughly doubled (about 25 to about 50 requests/s). What saturates now is the single JavaScript thread
  (process CPU about 100%, event-loop delay climbing), with pool waiting growing only past 32.
- The intermediate build with the code fixes only (pool 10, `ramp-after.json`) gave breaking point 16 (p95 2.07 s) and 0 errors at 64
  and 128, so most of the error removal is the overload fix and most of the throughput is the pool and the removed statements.

Hold and spike (final build):

| Run | Connections | req/s | p50 ms | p95 ms | p99 ms | Errors |
|---|---|---|---|---|---|---|
| hold 60 s, pool 10 (`hold-c16-pool10`) | 16 | 26.6 | 369 | 1,928 | 3,219 | 0% |
| hold 60 s, pool 25 (`hold-c16-pool25`) | 16 | 43.3 | 202 | 1,266 | 2,071 | 0% |
| spike, baseline (`spike-4-64`) | 4 | 59.0 | 40 | 172 | 618 | 0% |
| spike, 64 connections for 20 s | 64 | 39.3 | 569 | 5,794 | 9,812 | 13.2% (104 x 503) |
| spike, recovery | 4 | 46.8 | 41 | 236 | 779 | 0% |

In the spike the 503s are requests that waited 10 s for a pooled connection; they carry Retry-After and the "very busy" message, and
the service is back at full speed in the next phase with no errors (it used to stay closed for everyone).

Slowest routes at 16 connections, final build (p95 ms, `ramp-final.json`): register 2,445 and login 2,237 (bcrypt, cost 12, 0.29 s of CPU per hash on
this laptop; a registration hashes twice), deciding a case 1,978, assignment 1,265, review 1,261, notes 938, `GET /dashboards/admin` 899,
assistant ask (stub) 879, everything else under 820. Fewer than 25 samples back the single-digit-per-second write routes, so treat
those as indicative.

## STORY-032: live check

`live.json`. Instance `https://sss-demo-backend.onrender.com` (commit bf512ef, 0.1 CPU, 512 MB), 25 connections for 60 s:

| | Requests | req/s | p50 ms | p95 ms | p99 ms | Errors |
|---|---|---|---|---|---|---|
| All routes | 1,920 | 32.0 | 753 | **1,244** | 1,470 | **0** (0 rate-limited, 0 connection errors) |
| GET /exemptions | 398 | 6.6 | 550 | 1,418 | 2,216 | 0 |
| GET /cases (own) | 391 | 6.5 | 658 | 1,070 | 1,294 | 0 |
| GET /dashboards/citizen | 381 | 6.4 | 868 | 1,306 | 1,407 | 0 |
| GET /notifications | 375 | 6.3 | 807 | 1,223 | 1,302 | 0 |
| GET /users/:id | 375 | 6.3 | 818 | 1,227 | 1,453 | 0 |

Sign-ins of the one account, one at a time: five 200s in 1.59 to 1.70 s each. The live instance ran the build before the STORY-033
changes (they are not deployed), so this is the "before" for the live demo. p95 stayed under the 2 s target at 25 concurrent users.
The Observability page's own p95 for the same minute was not compared: it needs an administrator sign-in and we create no staff
account on the live demo.

## STORY-033: what was found and fixed

Each change was committed with its tests (`npx jest` is green). "Statements per request" is machine-independent: it counts SQL statements
that the server ran for one request, measured sequentially on a fresh database (40 requests per route), before and after.

| Route | Statements before | after |
|---|---|---|
| GET /cases/stats (staff) | 5.95 | 4.05 |
| GET /dashboards/case-manager | 8.07 | 7.05 |
| GET /dashboards/admin | 17.05 | 16.05 |
| GET /dashboards/leadership | 14.05 | 13.05 |
| GET /dashboards/admin, 20 at the same moment | 17.10 each | 2.55 each |
| GET /exemptions, /notifications, /assistant/history, /cases | 3.05 to 4.03 | 3.02 to 4.05 (unchanged: role, the query, the audit entry) |

Findings and fixes, in the order they mattered:

1. **Pool exhaustion closed the whole API (defect, fixed).** pg reports "timeout exceeded when trying to connect" both when the database
   is unreachable and when a request waited 10 s for a free pooled connection. STORY-034's handler treated both as an outage and marked
   the database down, so one burst made every route answer 503 (a 16-connection hold: 33% errors, `hold-c16-pool-exhaustion-defect.json`;
   64 connections: 96 to 98% errors in `ramp-before.json`). The pool wait while the pool is full is now overload: that request gets
   a 503 "very busy" with Retry-After, the database stays up, `/health` stays ok. Unit tests in `database/availability.test.ts`.
2. **Registration held a database connection through two bcrypt hashes** (about half a second, inside a transaction), so a few
   registrations took the pool from everyone. The hashes now run before any connection is taken, in parallel; the unique index on email
   still makes simultaneous registrations of one address safe.
3. **Pool size**: default raised from 10 to 25 (`DATABASE_POOL_MAX`). Same 16-connection hold: 26.6 to 43.3 requests/s, p95 1.93 to 1.27 s.
   Keep instances x pool under the database's connection limit; the sizing document uses a pooler.
4. **Overlapping identical dashboard computations** (admin, leadership, freshness, case stats) now share one computation. Nothing is kept
   once it finishes, so a request after a write sees the write. 20 admins at once: 17.1 to 2.55 statements each, and 7 pool
   connections each no longer taken.
5. **Role read once per request** instead of by the policy, the route guard and the handler. Still read from the database on every
   request, never cached between requests, so Staff Access changes apply on the next request as before.
6. **Audit entries batched**: reads and refusals recorded in the same turn of the event loop are written with one INSERT. Same fields,
   time and trace id as recorded; the write happens one loop turn later and a hard kill (not SIGTERM, which flushes) can lose the
   last turn's entries. If one entry in a batch is refused (an actor that no longer exists) the rest are written one at a time.
7. **Token checks**: jsonwebtoken tried to parse the secret as a public key (and failed) on every verification; a key object skips it
   (6% of CPU in the profile of a read-only run). Same HMAC, same tokens.
8. **Indexes (migration 026) and a query shape**, found by running the queries on 100,000 cases and 100,000 applicants (a data set
   this size was built for the check; numbers are the `EXPLAIN ANALYZE` execution times):

   | Query | Before | After |
   |---|---|---|
   | Admin dashboard team table (`lower(assigned_to) = lower(email)` for each of 42 staff) | 633 ms | 23 ms (`idx_cases_assigned_lower_status`) |
   | Staff case list, newest first, 25 rows | 115 ms | 0.4 ms (`idx_cases_updated_at`) |
   | Staff lookup `lower(email) = lower($1)` | 22 ms | 0.2 ms (`idx_users_email_lower`) |
   | Case list total count (two joins it did not need) | 234 ms | 5 ms (joins only when a filter names the table) |

Not done, and why:

- **Compression**: not added. The responses are a few KB and the scarce resource on the instance is CPU, which compression spends to
  save bandwidth that is not scarce; the platform edge or CDN compresses in production (docs/PRODUCTION-SIZING.md).
- **Caching the caller's role between requests** (it was the most frequent statement): refused, because it would break the guarantee
  that a Staff Access change applies on the next request. A read replica or a pooler is the production answer.
- **Lowering the bcrypt cost**: not changed; it is a security decision and the largest CPU cost per sign-in. Sized for instead.
- The live demo was not redeployed or re-measured with these changes (the live run stays at the pre-change build; the instruction was one light run).

## Limits (what these numbers do not show)

- One 8-core laptop with security software on the loopback path, load generator and server on the same machine. Absolute throughput is
  that laptop's on that day; a quiet machine is several times higher (see above).
- The live run is 25 connections for 60 s against 0.1 CPU. It says nothing about 10,000 users, and neither does anything else here;
  docs/PRODUCTION-SIZING.md derives that figure and labels every number measured or derived.
- No third-party load service, no multi-region test, no soak test beyond 60 s, no measurement with AWS hosting (STORY-004 waits on approval).
- The journeys register and sign in far more often than real users do (about 4% of requests are hashes), which makes bcrypt a larger
  share of CPU here than in production.

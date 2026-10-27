# Production sizing for 10,000 concurrent users (STORY-033)

This is a derivation, not a measurement. Nobody ran 10,000 users: one laptop cannot generate them and the demo's hosting (one 0.1 CPU Render
instance) cannot carry them (docs/R3-PLAN.md, "The limits we state rather than hide"). Every number below is labelled:

- **measured**: read from a run in `docs/evidence/r3-load/` (method and limits in its README);
- **derived**: arithmetic on measured numbers and on the assumptions in section 1;
- **assumed**: a choice we state so the reader can change it.

The right way to use this document is to change an assumption and redo the arithmetic, then confirm with a load test on the real
production stack (STORY-004, AWS GovCloud) once it exists.

## 1. Assumptions (assumed)

| Assumption | Value | Why |
|---|---|---|
| Concurrent signed-in users at the peak | 10,000 | The target |
| Requests per active user | 1 every 10 s (think time) | A person reading a dashboard or a form. The demo's own journeys are busier. |
| Peak request rate | 1,000 requests/s | 10,000 / 10 s |
| Share who sign in during a 5-minute ramp-up | 20% (2,000 sign-ins) | A notice goes out and people arrive together |
| Share of requests that are reads | about 85% | Dashboards, lists and the history are reads; applications and decisions are writes |
| Database round trip inside one region | about 1 ms per statement | Same-region managed PostgreSQL; the laptop idle measure below is smaller, a loaded laptop is far larger |

## 2. What the runs measured

| Fact | Value | Label | Source |
|---|---|---|---|
| One bcrypt hash, cost 12 (the cost the app uses) | about 0.29 s of one core | measured | one hash on this laptop, `node -e` timing during STORY-031 |
| Hashes per sign-in / per registration | 1 / 2 (password and SSN) | measured | `authService.ts` |
| Statements per request | 3 for a simple list, 4 to 10 for a dashboard, 13 to 16 for the admin and leadership dashboards (2.5 each when 20 arrive together) | measured | README "Statements per request" |
| Statements per request, mean over the mixed journey | about 5 | derived | the table above, weighted by the journey mix |
| Share of statements that are the audit insert | one per read request before; fewer after batching | measured | same |
| Cost of a request that is not a hash (CPU, one core) | about 2 to 3 ms | derived | an earlier, quiet run on this laptop (about 170 requests/s at 340% CPU of which about 300% was bcrypt). The raw file of that run was not kept; treat the figure as an order of magnitude |
| Local ceiling today, this laptop, final build | about 50 requests/s for the mixed journey, p95 under 1 s up to 16 connections, over 2 s from 32 | measured | README, ramp-final |
| Live demo (0.1 CPU, 512 MB), 25 connections, 60 s | 32 requests/s, p95 1.24 s, 0 errors; a sign-in takes about 1.6 s | measured | README, live run |
| Pool: 10 vs 25 connections, same load | 26.6 vs 43.3 requests/s, p95 1.93 s vs 1.27 s | measured | README, pool experiment |
| Index effects at 100,000 cases | 633 ms to 23 ms (admin team table), 115 ms to 0.4 ms (case list), 234 ms to 5 ms (count), 22 ms to 0.2 ms (staff lookup) | measured | README, indexes |

## 3. The arithmetic

### Application CPU (derived)

- Requests that are not hashes: 1,000/s x 2.5 ms = **2.5 cores**.
- Sign-ins during the ramp: 2,000 / 300 s = 6.7 per second x 0.29 s = **1.9 cores**. Hashing runs on Node's thread pool (4 threads by
  default), so a process with more than 4 busy hashes queues them; set `UV_THREADPOOL_SIZE` to the number of vCPUs of the task.
- Total about **4.4 cores** at the peak. Run at no more than 50% so a spike, a deploy or a lost zone does not tip it over: **about 9
  vCPUs**.
- Node runs JavaScript on one thread per process, so the unit is one process per vCPU: **8 to 10 one-vCPU processes**, for example 5
  tasks of 2 vCPU (2 processes each) or 10 tasks of 1 vCPU, spread across at least 2 availability zones. Memory was 120 to 230 MB per
  process in the runs (measured), so 1 GB per vCPU is ample.

If sign-ins are the larger share (a deadline day), the hashing term grows linearly: 50 sign-ins per second is 14.5 cores for hashing
alone. That is the first thing to watch, and the reason to keep sign-ins off the same tasks as reads if it happens (a separate auth
service, or a lower-cost hash, which is a security decision and not made here).

### Database (derived)

- Statements: 1,000 requests/s x about 5 = **5,000 statements/s**.
- Connections busy at once (Little's law): 5,000/s x 1 ms = **5 on average**. Peaks, transactions and slow aggregates (the dashboards
  run 13 to 16 statements, several in parallel) need about 4x: **20 busy connections**.
- Pool: the final build opens up to 25 per process (`DATABASE_POOL_MAX`, measured better than 10). With 10 processes that is 250
  connections, more than a small PostgreSQL wants. Use a pooler in front (PgBouncer, or RDS Proxy) in transaction mode, or set
  `DATABASE_POOL_MAX` to 8 to 10 per process: 10 processes x 8 = 80 connections, which the 20 busy ones sit well inside.
- Database size: a writer with 4 vCPU and 32 GiB (for example `db.r6g.xlarge`), plus a read replica for the admin, leadership and
  freshness dashboards (they are the heaviest statements and tolerate seconds of lag), Multi-AZ. **Assumed**, not measured: the local
  database was idle for most of every run. Confirm with a run against the real instance.
- **Audit volume**: every read is audited (STORY-010). 1,000 requests/s x 85% reads x about 0.5 KB per row is about 430 KB/s, about
  **37 GB a day** of `audit_logs` before indexes (derived). Partition by month, keep the hot partition on fast storage and move old
  ones to cheaper storage on the retention schedule. This table grows faster than any other and is also the one with the most indexes
  (8), each paid on every insert.

### Network and edge (assumed)

- Responses are small (a dashboard is a few KB), so 1,000 requests/s is a few MB/s. Compress at the load balancer or CDN, not in the
  Node process: compression in the process was not added because it spends the scarcest resource (CPU) to save bandwidth that is not
  scarce here.
- Rate limits and a web application firewall in front, with the limits sized from the 20% sign-in assumption.

## 4. What to do before believing this

1. Run the harness (`scripts/load`) against the production-like stack with the same journeys and the 25-connection to 1,000-connection
   ramp from several machines (a managed load generator), and replace the derived rows above with measured ones.
2. Measure the hash cost on the production CPU type and rerun section 3.
3. Measure the real think time and sign-in share from the pilot, not assumed ones.
4. Keep `docs/FAILOVER.md` in view: the database failover time sets how long the API answers 503 (STORY-034).

## 5. Limits of this document

- One laptop and a 0.1 CPU demo instance produced the measurements. The laptop was also running security software that slowed
  loopback connections and that made absolute numbers lower than a quiet machine gives (see the README); the relative before and after
  figures and the statements-per-request counts do not depend on that.
- No 10,000-user run exists. The sizing is arithmetic with stated assumptions and will be wrong where an assumption is wrong.

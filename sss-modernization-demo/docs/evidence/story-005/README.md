# STORY-005: real-time data pipeline (R0), concluded in R3 milestone 1

Demonstrated on a synthetic demo deployment; not operating in production.

## What the story asked
"Updates exemption data in under 30 seconds, so dashboards show current eligibility status", by polling a Redis cache that the
backend invalidates on every change, with `GET /data/pipeline-status` and a green / yellow / red freshness indicator.

## What we found
No pipeline or Redis code existed: an earlier note that "backend code exists, unverified" was wrong.

## What we did, and why it differs from the story's design
- **No cache.** Every page reads straight from PostgreSQL. A cache between the database and the page can only make data older; it
  is a performance tool, and the load tests of STORY-030 to 033 did not show the reads needing one. The story's goal (current data
  within 30 seconds) is met by reading the source.
- **Freshness is measured, not assumed (STORY-009, in the demo since Oct 12).** Every profile save, eligibility check, application
  and case change is timed from the start of the write until a separate read sees it; staff see each data type against 30 seconds
  for 95% of updates, with an alert.
- **`GET /api/data/pipeline-status` (new).** For the signed-in person: when their own records last changed (profile, eligibility,
  cases), how long ago that was, that the source is the database, and the 95th percentile of the measured visibility time across
  the service in the last hour as a level: green under 10 s, yellow 10 to 20 s, red over 20 s. It reads only the caller's own
  timestamps. Access: signed-in (in the access table and so in the OPA policy).
- **"How current this page is" on the citizen dashboard (new).** The level in words and colour, the last change, and the measured
  figure, refreshed every 30 seconds (the story suggested 5 s; 30 s keeps the free instance quiet and is well inside the target).

## Story criteria
| Criterion | Result |
|---|---|
| Real-time data source connected (polling Redis cache) | Replaced: pages read the database directly; no cache, by design (above) |
| Data freshness monitored: timestamps checked on every read | Every write is timed until readable (STORY-009); the status endpoint reports the caller's last change |
| Refresh triggered on profile update, exemption status change, admin override | Nothing to refresh: each of those writes is visible to the next read and is measured |
| Pipeline latency measured: change to UI under 30 s | Measured on every write, against 30 s for 95% (STORY-009); the dashboard card shows the last hour's p95 |
| Redis cache updated on data changes | Not applicable (no cache) |
| Database change event logged with timestamp | Every change is in the security audit log (STORY-010) and the freshness measurements |
| `GET /data/pipeline-status` returns { lastRefresh, dataAge, freshness } | `GET /api/data/pipeline-status` returns lastChange, dataAgeMs and freshness (level, p95, count, window, target) |
| Dashboard freshness indicator (green < 10 s, yellow 10–20 s, red > 20 s) | On the citizen dashboard, in words and colour |
| Metrics: pipeline latency, cache hit rate, data freshness | Visibility latency and freshness (STORY-009 and 027); cache hit rate not applicable |

Tests: `backend/src/services/dataPipelineService.test.ts` (the bands and the arithmetic), `src/security/routeAccess.test.ts` (the
route's access rule), and the R3 milestone 1 end-to-end and accessibility runs.

# Failover and multi-region design (STORY-034)

**Status: a design, not deployed.** The demo runs on Render: one API instance and one database in one region (Oregon). The
production design below is carried by the AWS GovCloud infrastructure code of STORY-004, which waits on Ram's approval. What the
demo itself does today is in "What runs today".

## What runs today (demonstrated on the synthetic demo deployment)
- **The API survives its database going away.** If the database cannot be reached at start, the API listens anyway: `/health`
  answers 200 with `database: "down"` and the deployed commit, and every data route answers 503 with a clear message and
  `Retry-After`. The startup work (migrations, roles, access policy, corpus) is retried with backoff (1 s doubling to 30 s, with
  jitter) and the API opens by itself when it is done; a probe every 5 s closes and reopens the data routes if the database goes
  away later. No restart is needed, and existing sign-ins keep working. Checked by `scripts/e2e/failover.mjs`.
- **A bad release never serves.** With the database reachable (every normal deploy), the port opens only after the startup work,
  so a migration whose SQL fails stops the release before Render promotes it, and the previous version keeps serving.
- **Outages are noticed from outside.** `.github/workflows/uptime.yml` checks the API and the site every 30 minutes from GitHub's
  runners and opens an issue (an email to the owner) when either fails (STORY-036).
- **What the demo does not have:** a second region, a standby database or automatic regional failover. Render's paid database
  takes daily backups; restore is a manual step (`docs/OPERATOR-RUNBOOK.md`, section 5, and the readiness drill in R3 milestone 3).

## Production design (AWS GovCloud, us-gov-west-1 primary, us-gov-east-1 secondary)
| Layer | Design | Failure handled |
|---|---|---|
| DNS | Route 53 failover records with health checks on each region's `/health` (it reports the database), 30 s interval, 3 failures | A region or its database lost |
| Edge | AWS WAF and an Application Load Balancer per region, across three Availability Zones | A zone lost; common web attacks |
| API | ECS on Fargate, at least 2 tasks per zone in the primary, scaled on CPU and request count; a warm minimum in the secondary | An instance or a zone lost; load |
| Database | Aurora PostgreSQL Global Database: a Multi-AZ writer in the primary, a read-only secondary cluster in the other region (typical replication lag under 1 s) | A zone lost (automatic); a region lost (managed failover promotes the secondary) |
| Secrets and keys | AWS Secrets Manager and KMS keys in both regions | Keys available after failover |
| Files (STORY-004) | S3 with cross-region replication and Object Lock for the audit copy | Documents and the audit copy survive a region loss |
| Observability | OpenTelemetry to CloudWatch in each region (the code already exports over OTLP), and the objectives and alerts of STORY-029 | Failover is detected and recorded |

**Active-active or active-passive.** The API tier can be active in both regions. Aurora Global Database has a single writer, so
writes go to the primary region and the secondary serves reads until it is promoted. The application already tolerates a lost
database (above), so during a regional switch it answers 503 with `Retry-After` instead of failing mid-write.

**Targets (to be confirmed with the agency):** recovery time objective under 15 minutes for a region loss, under 2 minutes for a
zone loss; recovery point objective under 1 minute (Aurora Global replication) and 5 minutes for backups.

## Failover runbook (production, to be rehearsed before go-live)
1. Route 53 health checks fail for the primary; the alert opens (STORY-029) and the on-call person follows `docs/INCIDENT-PLAYBOOK.md`.
2. Confirm the primary database is lost, not just slow: Aurora console, the Observability page, CloudWatch.
3. Promote the secondary Aurora cluster (managed failover, or detach-and-promote for a full region loss).
4. Point the secondary region's API tasks at the promoted writer (a parameter in Secrets Manager); they reconnect by themselves,
   because the API retries its database connection.
5. Route 53 sends traffic to the secondary. Verify with `scripts/verify-deploy.mjs` against the secondary's address.
6. Record the incident and run a post-incident review.

## How it will be verified
- Today: `scripts/e2e/failover.mjs` (local, real database taken away and back) and the uptime workflow.
- Production: a game day before go-live that fails a zone, then a region, and measures recovery time and data loss against the
  targets above.

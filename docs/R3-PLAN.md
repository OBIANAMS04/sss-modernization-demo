# R3: Scale and launch (STORY-030 to 046), and the wrap-up of the BUILD

The story list gives R3 one line per story. The acceptance criteria below are ours, written 2026-10-21. Everything is
demonstrated on a synthetic demo deployment; nothing here is operating in production. Where a story needs something the
demo cannot have (AWS GovCloud, a second region, 10,000 real users, an independent penetration tester, a screen-reader
user), we build and prove everything up to that boundary, state the boundary plainly, and leave a ready-to-run step for it.

## The limits we state rather than hide
- **Hosting.** The demo runs on Render: one small API instance (0.1 CPU, 512 MB) and a single-region database. AWS
  GovCloud (STORY-004) waits on Ram's approval. So: no measured 10,000-user run, no live multi-region failover.
- **Load from one laptop.** A single machine cannot generate 10,000 concurrent users realistically. We measure what the
  stack sustains, find the limits, fix what we can, and size production from the measurements.
- **Live load is small.** The live demo is shared with Ali and Ram; live load stays light (tens of users, a minute).
- **Security testing is our own.** An automated attack suite and hardening, not a third-party penetration test.
- **Accessibility is automated plus a conformance report.** A hands-on screen-reader audit by a person is still owed.

## Milestone 1: performance and reliability (STORY-030, 031, 032, 033, 034, 036, plus R0 STORY-005)
| Story | Title | Acceptance criteria |
|---|---|---|
| 030 | Load test harness | Scripted journeys (registrant: register, sign in, profile, eligibility, apply; case manager: list, open, decide; assistant with the stub; dashboards), run with a pinned Node load tool; ramp, hold and spike profiles; results (throughput, error rate, p50/p95/p99 per route) written as JSON and an HTML report under docs/evidence. |
| 031 | Capacity on the local stack | Ramp the local stack to its breaking point; record the concurrency at which p95 passes 2 s or errors pass 1%, and what saturates first (CPU, DB pool, event loop). |
| 032 | Live load check | A light, announced run against the live demo (no more than about 25 concurrent users for about 60 s) with p95 and errors from both the load tool and the Observability page. |
| 033 | Performance (p95 under 2 s) | Fix what 031 finds (indexes, query shape, pool size, caching, compression) and show before and after on the same profile; the documented production sizing for 10,000 concurrent users is derived from the measurements, not assumed. |
| 034 | Failover | The API survives its database going away: it starts and answers /health with the database down, refuses data routes with 503 and a clear message, retries the connection with backoff and recovers by itself (the Oct 16 outage crash-looped instead). Multi-region active-active is designed and written as infrastructure code with STORY-004 (Aurora Global Database, Route 53 failover), ready to apply. |
| 036 | Monitoring and alerting | An external uptime check outside Render (a scheduled GitHub Actions workflow: /health and the site every 30 minutes, opening a GitHub issue on failure and closing it on recovery, which emails the owner), on top of the in-app objectives and alerts from STORY-029. |
| 005 | Real-time data pipeline (R0) | Verify what exists against its criteria (updates visible in under 30 s, freshness checked); finish or replace it, and say which. |

## Milestone 2: security, accessibility and operations (STORY-037, 038, 039, 040, 041, 042)
| Story | Title | Acceptance criteria |
|---|---|---|
| 041 | Security testing and hardening | An automated attack suite (authentication bypass, other people's records, injection, cross-site scripting, token tampering, brute force, security headers, CORS) run locally; every finding fixed or recorded. Hardening: security headers, sign-in rate limiting, a server-side deny list so sign-out ends a token, MFA recovery codes, and a dependency upgrade pass (`npm audit`). |
| 042 | Final accessibility audit | Every page and role through the WCAG 2.1 AA audit, plus an Accessibility Conformance Report (VPAT 2.5 format) with honest Supports / Partially supports entries, naming the hands-on screen-reader test still owed. |
| 037 | Incident response playbook | Severity levels, roles, communication, first steps per alert type, and the Oct 16 database outage written up as a worked post-incident review. |
| 038–040 | Documentation and runbooks | An operator runbook (deploy, roll back, rotate secrets and the AI key, restore the database, read the observability), an administrator guide and a user guide, each checked against the running app. |

## Milestone 3: launch readiness (STORY-035, 043, 044, 045, 046, plus R0 STORY-004)
| Story | Title | Acceptance criteria |
|---|---|---|
| 035 | Staff training portal | A Training page for staff with modules per role (case manager, administrator, leadership), screenshots, a short knowledge check per module, and completion recorded and visible to administrators. |
| 043–046 | Go-live readiness review | A readiness review that maps every one of the 46 stories to its evidence; a backup-and-restore drill and a rollback drill with results; secrets rotated; the open gaps with owners (AWS, pen test, screen reader, real data, Colaberry upload limit); and go/no-go criteria for a production launch. |
| 004 | AWS GovCloud infrastructure (R0) | Infrastructure as code for GovCloud (VPC across three zones, load balancer with WAF, container service, PostgreSQL Multi-AZ with encryption, KMS, CloudWatch, GuardDuty), formatted and statically checked, with an apply runbook, ready for Ram's approval. Not applied. |

## Wrap-up items carried from earlier releases
- Remove dead code (`backend/src/routes/analytics.ts`, never mounted) and repair or retire the six stale route test suites.
- Rotate the database password and JWT secret shared in chat on Sep 17 (the owner, in the Render dashboard).
- The framework, deck and briefing are updated at each milestone; one Basecamp post per milestone.

## Order of work
One Sonnet helper at a time per milestone; Opus reviews, runs every check, deploys, verifies on the demo deployment, and posts.

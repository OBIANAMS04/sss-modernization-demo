# Go-live readiness review (STORY-043 to 046)

Demonstrated on a synthetic demo deployment; not operating in production. Review date: 2026-10-27.

## Verdict

- **The demo build is complete.** 45 of the 46 stories are working on the demo deployment and verified there; the 46th
  (STORY-004, AWS GovCloud) is written as infrastructure code and statically checked, waiting on approval to apply.
- **A production launch is a no-go today.** The gaps in "Open gaps" below are each owned and none is hidden; the go/no-go
  criteria at the end say what has to be true first. Most of them depend on decisions outside the build team (AWS approval,
  an authority to operate, an independent penetration test, real data).

## Every story and its evidence

"Posted" is the Basecamp BUILD ticket (todolist 10068241172) recording. Evidence folders are under `docs/evidence/` unless named.

| Story | What | State | Evidence |
|---|---|---|---|
| 001 | Registration and sign-in | In the demo | Posted `#__recording_10312647276`; `scripts/e2e/access.mjs`, `security.mjs` |
| 002 | Profile and compliance check | In the demo | Posted with 006 `#__recording_10362153151`; `scripts/e2e/workflow.mjs` |
| 003 | Two-step sign-in (MFA), recovery codes | In the demo | `story-003/`, `r3-m2/`; `scripts/e2e/mfa.mjs`, `security.mjs` |
| 004 | AWS GovCloud infrastructure | **Written, not applied** | `infrastructure/aws-govcloud/` (README with apply runbook, `checks/`: fmt, validate x2, TFLint 0 findings, tfsec justified) |
| 005 | Data status (real-time data) | In the demo | `story-005/` |
| 006 | Exemption eligibility | In the demo | Posted `#__recording_10362153151` (approved by Ali 2026-10-02) |
| 007 | Case management | In the demo | Posted `#__recording_10363503258` (approved by Ali 2026-10-02); `scripts/e2e/workflow.mjs` |
| 008 | Compliance validation | In the demo | `story-008/` (reviewed by Ali 2026-10-07) |
| 009 | Data freshness | In the demo | `story-009/` (accepted by Ali 2026-10-12) |
| 010 | Security audit log | In the demo | `story-010/` (accepted by Ali 2026-10-12) |
| 011 | Accessibility (Section 508) | In the demo | `story-011/`, `r3-m3-a11y/` (43 checks) |
| 012 | Citizen dashboard | In the demo | `story-012/` |
| 013 | Case manager dashboard | In the demo | `story-013/`, `milestone-003-016/` |
| 014 | Admin dashboard | In the demo | `story-014/` |
| 015 | Leadership dashboard | In the demo | `story-015/` |
| 016 | API access policies (OPA) | In the demo | `story-016/`; `scripts/e2e/policy.mjs` |
| 017 to 020 | Policy assistant: corpus, retrieval, cited answers, evaluation | In the demo | `story-019-024/`, `story-020/` (evaluation 33 of 33 on the real model) |
| 021 | Drift detection | In the demo | `story-021-025/` |
| 022 | Answer quality (grounding) monitoring | In the demo | `story-019-024/` |
| 023 | Human oversight (review queue) | In the demo | `story-019-024/` |
| 024 | Override rate | In the demo | `story-019-024/` |
| 025 | Bias and fairness | In the demo | `story-021-025/` (60 of 60 pairs on the real model) |
| 026 to 029 | Observability, objectives, alerts, runbook | In the demo | `story-026-029/` |
| 030 to 032 | Load testing | In the demo (local and one light live run) | `r3-load/`, `r3-m1/` |
| 033 | Performance and production sizing | In the demo | `r3-load/README.md`, `../PRODUCTION-SIZING.md` |
| 034 | Database outage and failover design | Outage survival in the demo; multi-region **designed** | `r3-m1/` (22 of 22), `../FAILOVER.md` |
| 035 | Staff training portal | In the demo | `r3-m3/` (training screens); `scripts/e2e/training.mjs` |
| 036 | Uptime monitoring outside the platform | In the demo | `.github/workflows/uptime.yml` (runs every 30 minutes) |
| 037 | Incident response playbook | Written | `../INCIDENT-PLAYBOOK.md` |
| 038 to 040 | Runbook and guides | Written | `../OPERATOR-RUNBOOK.md`, `../ADMIN-GUIDE.md`, `../USER-GUIDE.md` |
| 041 | Security testing and hardening | In the demo | `r3-m2/`, `../SECURITY-TESTING.md` (attack suite 52 of 52) |
| 042 | Accessibility conformance report | Written | `../ACCESSIBILITY-CONFORMANCE-REPORT.md` |
| 043 to 046 | This review and its drills | Done | This document, `r3-m3/` |

## Drills (2026-10-26 and 27, on the live demo unless said)

| Drill | What was done | Result |
|---|---|---|
| Roll back a release | Render rollback of the API from `ba10b59` (with the training portal) to `4242280` (before it), then forward again with "Deploy latest commit" | Old version serving in **32 s**; the live citizen check passed on it and `/api/training` answered 404 (proof the old code served); migration 028 stayed applied and the old code ignored the new table. Forward again in **58 s** (a fresh build). Render turns Auto-Deploy off on a rollback; it was turned back on (On Commit) and confirmed |
| Back up and restore | A Render logical export of the live database (08:53 UTC), downloaded and restored into an empty local PostgreSQL 18 | Restored in **10.5 s with 0 errors**: 31 tables; users, cases, exemptions, policy passages, assistant answers and migrations equal to live; audit 3,757 against 3,759 live (the two newer rows were written after the export's snapshot). The write-once audit triggers came back and refused an UPDATE; the API started on the restored data (database ok, 28 migrations). The local copy was deleted afterwards |
| Database outage | `scripts/e2e/failover.mjs` (local): the database stopped before start-up and while serving | 22 of 22: the API stays up, answers 503 with Retry-After, recovers by itself without a restart |
| Rotate secrets | `JWT_SECRET` replaced (generated in the browser, never shown); database moved to a new user by Render credential rotation, the exposed one deactivated (2026-10-26) | Startup audit named both changes; API connected only as the new user; all 30 tables and their rows intact; live checks passed |
| Outside monitoring | The GitHub Actions uptime check | First scheduled run passed 2026-10-21 20:50 UTC; runs every 30 minutes |

Recovery objectives measured on the demo: about 1 minute to roll back or forward a release; a restore of the whole (small)
database in seconds plus the export time (about 3 minutes). Point-in-time recovery covers the last 3 days on the current plan.
Production targets are in `../FAILOVER.md` (to be confirmed with the agency: recovery time under 15 minutes for a region loss and under 2 for a zone loss; recovery point under 1 minute) and need the AWS design to be met.

## Open gaps, with owners

| Gap | Why it matters | Owner | Next step |
|---|---|---|---|
| AWS GovCloud not approved | Everything production-grade (multi-region, WAF, KMS, the audit copy) is in code but not running | Ram | Approve; then the apply runbook in `infrastructure/aws-govcloud/README.md` |
| No independent penetration test | Our 52-check attack suite is our own testing | Ali, Ram (procurement) | Engage a tester on the AWS environment before real data |
| No hands-on screen-reader, magnification or speech-input test | The conformance report marks it owed | Obi, with users | Test with JAWS, NVDA, VoiceOver, TalkBack and people who use them |
| No authority to operate, no real data | The demo holds synthetic data only | The agency, Ali | Security assessment and ATO on the AWS environment |
| Production mode keyed to the `RENDER` variable | Refusing to start without `JWT_SECRET` and trusting the proxy's client address are tied to Render | Obi | A platform-neutral setting before AWS (found by the STORY-004 work) |
| Audit copy has no writer yet | The S3 Object Lock bucket exists in code; the app does not write to it | Obi | Add the writer with the AWS environment |
| Two-step code page times out without a warning (WCAG 2.2.1) | Marked Partially Supports | Obi | Add a warning with an extension |
| Load at production scale not measured | Sizing is derived, not measured | Obi | Run the harness from several machines on AWS |
| Tokens in localStorage; TOTP keys readable at rest | Accepted for the demo | Obi | HttpOnly cookies with CSRF protection; encrypt keys with KMS |
| OTLP export to Datadog not exercised | Configuration only | Obi | Exercise with a Datadog account |
| Colaberry upload limit (about 1 MB, documented 10 MB) | Evidence packs cannot be attached whole | Ali, Ram | Raise the limit; asked in every post |
| Proposal Task 5 (Technical Volume demo link) | The volume's placeholder needs the demo address, unless already submitted | Ali | Say where the volume is and whether it was submitted |

## Go/no-go criteria for a production launch

All must be true:

1. AWS GovCloud approved and applied from `infrastructure/aws-govcloud/`; the first `terraform plan` reviewed by two people.
2. An authority to operate granted for the AWS environment.
3. An independent penetration test with every high and critical finding fixed and retested.
4. The hands-on assistive-technology test done and the conformance report updated from it.
5. Every story's check passing on the AWS environment: unit tests, all end-to-end suites, the attack suite and the accessibility
   audit with no content security policy violation.
6. A load test on AWS at the expected peak (sizing: 1,000 requests/s) with p95 under 2 s and errors under 1%.
7. A failover drill between the two regions meeting the agreed targets (proposed: recovery time under 15 minutes, recovery point under 1 minute), and a restore drill from backup.
8. Secrets in AWS Secrets Manager, rotated, with no secret ever in source, chat or logs.
9. The audit log copied to append-only storage, and the production-mode setting independent of the hosting platform.
10. The incident playbook rehearsed once with the people on call, and staff training passed by every case manager and administrator.

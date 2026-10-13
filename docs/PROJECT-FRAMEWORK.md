# SSS Modernization — Project Framework

**Client opportunity:** U.S. Selective Service System (SSS) business-systems modernization (RFP)
**Bidder:** Colaberry · **Owner:** Obi Anamelechi Kingsley · **Decision makers:** Ali Muwwakkil (Managing Director), Ram Katamaraja
**Last updated:** 2026-10-12 · Updated after every milestone (see "How this document is maintained")

> "In the demo" means working on the synthetic demo deployment. Nothing here is operating in production (Ali, 2026-10-07).

---

## 1. What we are doing

Two parallel tracks that meet at submission:

| Track | Goal | Where it lives |
|---|---|---|
| **Proposal** | 11 tasks producing the RFP response (scope → volumes → forms → review gate → submission) | Basecamp project 47346103; task docs in `SSS-Proposal-Library-Standard-Context/` |
| **BUILD** | A working demo platform, 46 stories in 4 releases (R0–R3), proving the technical approach | Basecamp BUILD ticket (todolist 10068241172); code in `sss-modernization-demo/` |

The demo site is the bridge between them: the Technical Volume (Proposal Task 5) cites the demo URL, described as a synthetic demo deployment.

---

## 2. Proposal track (11 tasks)

| # | Task | Status | Blocker / next action | Owner |
|---|---|---|---|---|
| 1 | Scope Summary (INPACT baseline 33/100) | ✅ Complete | — | Obi |
| 2 | Bid/No-Bid (BID, high confidence; Echo Health benchmark) | ✅ Complete | — | Obi |
| 3 | Compliance Matrix (accessibility, security, AI governance, performance, FAR) | ✅ Complete | — | Obi |
| 4 | SAM.gov Checklist (UEI, CAGE, NAICS 541519, reps & certs, EFT) | 🚩 Blocked | Verify in SAM.gov, post screenshots | Ali |
| 5 | Technical Volume (7-Layer architecture, demo site) | 🟡 Unblocked | Demo site online since 2026-09-17: insert https://sss-demo-frontend.onrender.com, worded as a synthetic demo deployment | Obi |
| 6 | Management Volume | 🚩 Blocked | Fill [CONFIRM] key personnel, experience, schedule | Ali |
| 7 | Past Performance (Echo Health + refs 2 & 3) | 🚩 Blocked | Reference 2 & 3 data; send and collect PPQs | Ali |
| 8 | Cost/Price Volume | 🚩 Blocked | Finalize CLINs and rates | Ali |
| 9 | Federal Forms & Certifications | 🚩 Blocked | Verify forms | Ali |
| 10 | Internal Review Gate (process, created 2026-07-28) | ⏳ Active | Needs Tasks 1–9 done + Ali & Ram sign-off | Ali, Ram |
| 11 | Submission Guide | ⏳ Waiting | Runs after Task 10 passes | Obi |

Submission deadline: **not recorded yet** (confirm with Ali).

---

## 3. BUILD track (46 stories, 4 releases)

| Release | Stories | Status |
|---|---|---|
| **R0 Walking Skeleton** | 001 Registration & login · 002 Profile & compliance · 003 MFA · 004 Cloud infra (AWS, L5) · 005 Data pipeline (L2) | 001 ✅ in the demo (+ Ali's guards) · 002 ✅ in the demo · 003 backend only, no UI · 004 🚩 blocked on Ram's AWS approval (demo runs on Render) · 005 backend only, unverified |
| **R1 Core** | 006 Exemption eligibility · 007 Case management · 008 Compliance validation · 009 Data freshness · 010 Audit logging · 011 Section 508 · 012–015 Role dashboards · 016 API governance (OPA) | 006 ✅ · 007 ✅ (both approved by Ali, 2026-10-02) · 008 ✅ 2026-10-06 (reviewed by Ali 2026-10-07) · 009 ✅ and 010 ✅ 2026-10-12 (both accepted by Ali, 2026-10-12) · 011 ✅ 2026-10-12 (posted) · 012 ✅ 2026-10-12 (posted) · **013 next** (case manager dashboard), then 014–015 |
| **R2 AI & Governance** | 017–020 RAG policy Q&A · 021 drift · 022 hallucination monitoring · 023 HITL ladder · 024 override tracking · 025 bias testing · 026–029 observability | Not started |
| **R3 Scale & Launch** | 030–032 load testing · 033 performance · 034 failover · 035 training · 036 monitoring · 037 incident playbook · 038–040 docs · 041 pen test · 042 accessibility audit · 043–046 go-live review | Not started |

### What the demo does today
- Register/login (bcrypt passwords **and SSNs**, 1-hour JWT), demo-data banner, masked SSN entry.
- Profile (phone, address, income, hardship) with compliance check (18+, phone, address).
- Exemption eligibility: Type A senior (65+), Type B income (< $20,000), Type C hardship (Pending Review), each with a reason; audit-logged. These are illustrative rules, not Selective Service policy.
- Case management: apply → Submitted → In Review → Approved/Denied (reason required) → Appeal; timeline, in-app notifications, internal notes, document links, staff filters, CSV export (no SSNs).
- Compliance validation: every approval or denial is checked against 8 decision controls (eligibility basis, re-check after a profile change, denial reason and notice, separation of duties, assignment, review before decision, required document, audit entry). A failure opens a review that a *different* case manager resolves with a justification (accept the exception, recorded as an override, or reopen the case). Staff get a compliance dashboard (99% target with an alert) and a filterable audit log of every control result.
- Data freshness: every profile save, eligibility check, application, case status change and assignment is timed from the start of the write until a separate read sees the new row version. Staff get a Data Freshness page: p50/p95/p99 per data type against 30 s for 95% of updates, an alert when a type falls behind, the slowest updates (write time vs. wait time), and a Check now end-to-end test from the browser.
- Security audit log: every registration, sign-in (failed ones under the address tried, never the password), sign-out, MFA step, refusal (401/403), successful API read, export, profile change (field names only), decision, override, role grant or removal, deployment, configuration change between server starts (secrets named, never their values) and alert is recorded with who, when and the caller's address. The database refuses UPDATE, DELETE and TRUNCATE on the log (triggers, migration 015); each entry has a retain-until date 7 years on; SSNs, passwords, codes, tokens and secrets are removed before writing. Staff search it on a Security Audit Log page by date, user, event, area and result.
- Accessibility (Section 508): every page passes WCAG 2.1 AA checks for each role in an automated Chrome audit (axe-core rules, keyboard with a skip link and visible focus, titles and landmarks, nothing lost at 320 px, announced form errors); a warning two minutes before a session ends with Stay signed in (sessions end 12 hours after sign-in); 4.8:1 field borders; applications and appeals confirmed before they are sent.
- Citizen dashboard: each application with its status and the next step, eligibility with reasons and what the profile is missing, the 10 latest case events (applicant-visible only, one rule shared with the case page), notifications.
- Roles and Staff Access: citizen / case manager / admin. Case-manager access is given or removed in the app (Staff Access, `/staff`) by an existing case manager with a reason: never your own, never the last case manager; recorded in the same transaction as the change; the person is notified. `CASE_MANAGER_EMAILS` only sets up an empty system.
- The audit log records each visitor's own address (on Render, the address Cloudflare passes on); every deploy check confirms it.

### Screens (2026-10-12)
Captured from the demo application running the deployed code, with synthetic data. Full sets with captions are in each story's evidence pack.

| | |
|---|---|
| **STORY-001 · Registration** ![Registration form with masked SSN entry](demo/screens/tour-01-register.png) | **STORY-002 and 006 · Profile and eligibility** ![Eligibility results with reasons](demo/screens/tour-03-profile-eligibility.png) |
| **STORY-007 · Case queue** ![Case management queue](demo/screens/tour-05-case-management.png) | **STORY-007 · Denial with reason** ![Denied case with reason and appeal](demo/screens/tour-04-denied-with-reason.png) |
| **STORY-008 · Compliance dashboard** ![Compliance dashboard with alert](demo/screens/tour-06-compliance-dashboard.png) | **STORY-008 · Second-manager review** ![Open compliance review](demo/screens/tour-07-second-review.png) |
| **STORY-009 · Data freshness** ![Data Freshness on target](demo/screens/tour-10-freshness-on-target.png) | **STORY-009 · Freshness alert** ![Data Freshness alert after a 31 s slowdown](demo/screens/tour-09-freshness-alert.png) |
| **STORY-010 · Security audit log** ![One applicant's whole trail in the Security Audit Log](demo/screens/tour-11-audit-trail.png) | **STORY-010 · Configuration change** ![A changed setting shown with old and new value, a secret only named](demo/screens/tour-12-config-change.png) |
| **STORY-011 · Errors announced** ![Registration after an empty submit, each field invalid with its message](demo/screens/tour-13-form-errors.png) | **STORY-011 · Session warning** ![Warning two minutes before a session ends, with Stay signed in](demo/screens/tour-14-session-warning.png) |
| **STORY-012 · Citizen dashboard** ![Citizen dashboard with two applications, their status and next steps](demo/screens/tour-02-citizen-dashboard.png) | **STORY-012 · Staff Access** ![Staff Access page listing the case managers, with the form to give access](demo/screens/tour-16-staff-access.png) |

---

## 4. Platform

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + Tailwind v4 → Render static site `sss-demo-frontend` |
| Backend | Node + Express + TypeScript → Render web service `sss-demo-backend` (free tier, sleeps when idle) |
| Database | Render PostgreSQL `sss-demo-db` (Oregon); migrations 001–016 apply automatically on startup |
| Source | https://github.com/OBIANAMS04/sss-modernization-demo (Render auto-deploys on push to master) |
| Access table | 46 routes, each with its access rule; a test fails the build if a route has none |
| Workflow | Claude commits and pushes each change; Render deploys; Claude verifies the demo deployment itself and posts the conclusion with screenshots to the BUILD ticket (one post per milestone, one composite image of several screens per post) |
| Verification | `scripts/verify-deploy.mjs`: served commits on every page path, database, migrations, and every protected route refuses requests without a token · `scripts/verify-live-citizen.mjs`: every staff route refuses a signed-in citizen · `scripts/evidence/<story>.mjs`: drives the UI in headless Chrome and captures the evidence pack in `docs/evidence/<story>/` · `scripts/evidence/composite.mjs`: the Basecamp image (refuses to leave out any evidence screen) · `scripts/a11y/audit.mjs`: WCAG 2.1 AA, keyboard, reflow and session checks on every page (`--live` for the demo site) |

---

## 5. Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-07-28 | Validate every proposal task against its ticket's acceptance criteria; Task 10 is a gate, not a document | Ali |
| 2026-08-31 | Deploy the demo to Render (Node runtime) instead of local Docker (WSL2 blocked) | Obi |
| 2026-09-17 | "Do both now": demo-data banner + SSN hashed, never logged. One post per milestone on the BUILD list | Ali |
| 2026-09-30 | Fold STORY-002 (profile) into R1 alongside STORY-006 | Obi |
| 2026-10-01 | Case managers granted by email allowlist; documents attached as links until object storage (STORY-004) | Obi |
| 2026-10-02 | STORY-006 and STORY-007 approved as shipped `[decision-2026-10-02-sss-r0-r1-approved]`. Lesson: every route gets its access check when written (now enforced by a test, see docs/SECURITY-RULES.md). Process: the team verifies its own deploys and posts screenshots + conclusion; Ali reviews the demo site as a user. File uploads waiting on STORY-004 is on Ram and Ali | Ali |
| 2026-10-06 | STORY-008 design: 8 decision controls are checked at the moment of decision; a failed decision opens a review that only a different case manager can resolve, with a required justification (accept = audited override, or reopen); failed decisions keep counting toward the 99% target | Obi |
| 2026-10-07 | STORY-008 reviewed: separation of duties done properly, overrides audited, verification sweeps the strongest part. Claim boundary: everything is "demonstrated on a synthetic demo deployment"; never let proposal language drift into "operating in production" `[ali-ack-2026-10-07-sss-story008]` | Ali |
| 2026-10-12 | Screenshots in every Basecamp post, slide deck, artifact and the framework, and existing ones updated as the work changes | Obi |
| 2026-10-12 | STORY-009: freshness is measured on real writes (start of write until a separate read sees the new row version), not estimated; the placeholder data and latency endpoints were removed | Obi |
| 2026-10-12 | STORY-010: the audit log is write-once in the database itself (triggers refuse UPDATE, DELETE and TRUNCATE, even for the owner) and kept 7 years; every successful API read and every refusal is logged; configuration changes are found at each server start, with secrets named but never valued. Production adds an append-only copy on AWS (STORY-004) | Obi |
| 2026-10-12 | STORY-009 and STORY-010 accepted. Most valued: reporting that the old audit table's "immutable" constraint was CHECK (true); "a check that cannot fail is worse than no check", and finding such a thing in our own work and saying so plainly is the behaviour to repeat. Notes: the image attached to a post must match the evidence pack; keep the route count visible `[ali-ack-2026-10-12-sss-story009-010]` | Ali |
| 2026-10-12 | STORY-011: WCAG 2.1 AA (which includes Section 508) checked by an automated audit in Chrome on every page and role, plus the criteria no tool can test (session warning, field-border contrast, confirming applications and appeals). A hands-on screen-reader audit and a VPAT/ACR come with STORY-042 (R3) | Obi |
| 2026-10-12 | Model choice: Opus 5.5 (Max) for design, debugging, verification and Ali-facing wording; Sonnet 5.5 (Max) helper agents for well-specified routine work | Obi |
| 2026-10-12 | Staff identity: admin-assigned roles. An existing case manager gives or removes case-manager access in the app (Staff Access) with a reason; CASE_MANAGER_EMAILS only sets up an empty system | Obi |
| 2026-10-12 | The Colaberry 10 MB upload request is repeated, to Ali and Ram, in every Basecamp post until they answer | Obi |

---

## 6. Milestone timeline

| Date | Milestone |
|---|---|
| 2026-07-28 | Proposal tasks realigned; Task 10 review gate created |
| 2026-08-03 | STORY-001 registration built locally |
| 2026-09-16 | Real source pushed to GitHub (broken submodule fixed); first Render deploy |
| 2026-09-17 | **R0 demo deployment verified** and posted; Ali's guards decision |
| 2026-09-26 | Guards in the demo (SSN hashed, banner), masked SSN, real error messages |
| 2026-09-30 | Guards confirmation posted; tracked migrations; site-wide CSS fix |
| 2026-10-01 | **STORY-006 in the demo** · security fix (roles) · **STORY-007 in the demo**; both posted |
| 2026-10-02 | **Ali approves STORY-006 and STORY-007**; asks for case manager access |
| 2026-10-06 | Access rule required for every route (test-enforced) · expired logins return 401 instead of 500 · honest `/health` with deployed commit · self-verified deploys · runtime security patches · Ali's case manager access granted; reply posted `#__recording_10375070502` · **STORY-008 in the demo**: compliance validation, reviews, dashboard and audit log, verified on the demo deployment with an evidence pack; posted `#__recording_10375183698` |
| 2026-10-07 | **Ali reviews STORY-008** and sets the claim boundary (demonstrated on a synthetic deployment, not production) |
| 2026-10-12 | **STORY-009 in the demo**: data freshness timed on every write, alert, slowest updates; verified on the demo deployment (every page path current, 22 protected routes refuse anonymous, 13 staff routes refuse a citizen); posted with screenshots `#__recording_10395976909` |
| 2026-10-12 | **STORY-010 in the demo**: security audit log of every sign-in, refusal, read, change and configuration change, write-once and kept 7 years; verified on the demo deployment (16 migrations, 22 protected routes refuse anonymous, 13 staff routes refuse a citizen); posted with screenshots `#__recording_10396171859` |
| 2026-10-12 | **Ali accepts STORY-009 and STORY-010**; asks that post images match the evidence pack and that the route count stays visible |
| 2026-10-12 | **STORY-011 in the demo**: every page passes WCAG 2.1 AA checks (0 of 12 before, 12 of 12 after), session warning, confirmations; found and fixed a STORY-010 bug (UI sign-outs logged as refusals); verified on the demo deployment (42 routes, 22 protected routes refuse anonymous, 13 staff routes refuse a citizen, live audit passes); posted with screenshots `#__recording_10397764209` |
| 2026-10-12 | **STORY-012 in the demo**: citizen dashboard; Staff Access replaces email-list roles; the audit log records visitors' own addresses (it recorded Cloudflare's); verified on the demo deployment (46 routes, 24 protected routes refuse anonymous, 14 staff routes refuse a citizen, caller address checked); posted with screenshots `#__recording_10398133067` |

Basecamp posts: R0 final `#__recording_10312647276` · guards `#__recording_10355304599` · STORY-006 `#__recording_10362153151` · STORY-007 `#__recording_10363503258` · Ali's approval `#__recording_10365688982` · Ali's access `#__recording_10375070502` · STORY-008 `#__recording_10375183698` · STORY-009 `#__recording_10395976909` · STORY-010 `#__recording_10396171859` · STORY-011 `#__recording_10397764209` · STORY-012 `#__recording_10398133067` (BUILD ticket https://app.basecamp.com/3945211/buckets/47346103/todolists/10068241172)

---

## 7. Risks and follow-ups

| Risk / follow-up | Impact | Action |
|---|---|---|
| Proposal Tasks 4, 6–9 waiting on Ali; deadline unknown | Submission at risk | Confirm deadline; Ali's checklist in TASK_COMPLETION_STATUS.md |
| AWS approval (Ram) pending | Blocks STORY-004, real document upload, CloudWatch metrics for STORY-009 and an append-only copy of the audit log for STORY-010 | Ram decision |
| Render DB password and JWT secret were shared in chat (2026-09-17) | Must not hold real PII as-is | Rotate both before any real data |
| `npm audit` (2026-10-06): 44 findings, but only 3 in runtime dependencies after the non-breaking patch update (Express 4.22.3, proxy-addr, qs, body-parser) | Remaining critical (`tar`) runs only while bcrypt installs, never on requests; the rest are jest/eslint tooling | Dependency upgrade pass before go-live (consider bcryptjs to drop tar) |
| Render free tier sleeps | ~50 s first load | Warm the site before demos, or upgrade |
| No frontend unit tests; 8 old backend route-test suites are stale (they need a `sss_demo_test` database), and `apiGovernanceService` imports a missing logger | Regressions caught late | The UI is checked end to end by the evidence scripts; repair or retire the stale suites |
| Case managers can give case-manager access to others (decided 2026-10-12; the email-list hole is closed) | A case manager could make a second account staff | Every grant is in the audit log with who and why; production should keep grants to an administrator or a second approver |
| Colaberry's upload endpoint refuses requests over ~1 MB (nginx 413), although its tools say 10 MB | Whole evidence PDFs can't be attached to Basecamp | Raised with Ali in the STORY-009 post and with Ali and Ram in the STORY-011 and STORY-012 posts; not yet answered, so every post repeats it; meanwhile each post attaches one composite image and links the full pack |
| No one has used the app with JAWS, NVDA or VoiceOver yet | Automated checks cover only part of WCAG | Hands-on screen-reader audit and a VPAT/ACR with STORY-042 (R3) |
| The audit log's write-once rule is enforced by database triggers, which a database superuser could disable | Not enough on its own for production | Copy every entry to append-only storage (CloudWatch Logs or S3 Object Lock) with STORY-004 |
| Sign-out is logged but a sign-in token stays valid until it expires (1 hour) | A copied token keeps working after sign-out | Server-side deny list before production |
| For up to 5 minutes after a deploy, the site's CDN can serve a deep link's previous page | A reviewer opening a deep link right after a deploy can see the previous version | verify-deploy waits until every page path serves the current build; a Render header rule could shorten it |
| Norton HTTPS scanning on Obi's laptop corrupts some connectors | Colaberry works via local bridge; others fail | Optional Norton exclusion |

---

## 8. Links
- Demo site: https://sss-demo-frontend.onrender.com · API health: https://sss-demo-backend.onrender.com/health
- GitHub: https://github.com/OBIANAMS04/sss-modernization-demo
- STORY-008 evidence pack: https://github.com/OBIANAMS04/sss-modernization-demo/tree/master/sss-modernization-demo/docs/evidence/story-008
- STORY-009 evidence pack: https://github.com/OBIANAMS04/sss-modernization-demo/tree/master/sss-modernization-demo/docs/evidence/story-009
- STORY-010 evidence pack: https://github.com/OBIANAMS04/sss-modernization-demo/tree/master/sss-modernization-demo/docs/evidence/story-010
- STORY-011 evidence pack: https://github.com/OBIANAMS04/sss-modernization-demo/tree/master/sss-modernization-demo/docs/evidence/story-011
- STORY-012 evidence pack: https://github.com/OBIANAMS04/sss-modernization-demo/tree/master/sss-modernization-demo/docs/evidence/story-012
- Demo briefing (purpose, problems solved, walkthrough; source for the NotebookLM deck): artifact https://claude.ai/artifact/7uX47ceMBSxM2uVJK8smwo · PDF `docs/demo/SSS-Modernization-Demo-Briefing.pdf`
- Demo slide deck (19 slides with speaker notes; downloads as PowerPoint or PDF): https://claude.ai/artifact/EMxgHSsgJxnRw4SHYKpy5W · source `docs/demo/deck/`
- Render: https://dashboard.render.com
- Basecamp BUILD ticket: https://app.basecamp.com/3945211/buckets/47346103/todolists/10068241172

## How this document is maintained
Updated by Claude after every milestone (together with the published "SSS Modernization Framework" artifact, which shows the same screens), and committed with that milestone's code.

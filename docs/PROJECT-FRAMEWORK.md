# SSS Modernization — Project Framework

**Client opportunity:** U.S. Selective Service System (SSS) business-systems modernization (RFP)
**Bidder:** Colaberry · **Owner:** Obi Anamelechi Kingsley · **Decision makers:** Ali Muwwakkil (Managing Director), Ram Katamaraja
**Last updated:** 2026-10-06 · Updated after every milestone (see "How this document is maintained")

---

## 1. What we are doing

Two parallel tracks that meet at submission:

| Track | Goal | Where it lives |
|---|---|---|
| **Proposal** | 11 tasks producing the RFP response (scope → volumes → forms → review gate → submission) | Basecamp project 47346103; task docs in `SSS-Proposal-Library-Standard-Context/` |
| **BUILD** | A working demo platform, 46 stories in 4 releases (R0–R3), proving the technical approach | Basecamp BUILD ticket (todolist 10068241172); code in `sss-modernization-demo/` |

The live demo is the bridge between them: the Technical Volume (Proposal Task 5) cites the live demo URL.

---

## 2. Proposal track (11 tasks)

| # | Task | Status | Blocker / next action | Owner |
|---|---|---|---|---|
| 1 | Scope Summary (INPACT baseline 33/100) | ✅ Complete | — | Obi |
| 2 | Bid/No-Bid (BID, high confidence; Echo Health benchmark) | ✅ Complete | — | Obi |
| 3 | Compliance Matrix (accessibility, security, AI governance, performance, FAR) | ✅ Complete | — | Obi |
| 4 | SAM.gov Checklist (UEI, CAGE, NAICS 541519, reps & certs, EFT) | 🚩 Blocked | Verify in SAM.gov, post screenshots | Ali |
| 5 | Technical Volume (7-Layer architecture, live demo) | 🟡 Unblocked | Demo is live since 2026-09-17: insert https://sss-demo-frontend.onrender.com | Obi |
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
| **R0 Walking Skeleton** | 001 Registration & login · 002 Profile & compliance · 003 MFA · 004 Cloud infra (AWS, L5) · 005 Data pipeline (L2) | 001 ✅ live (+ Ali's guards) · 002 ✅ live · 003 backend only, no UI · 004 🚩 blocked on Ram's AWS approval (demo runs on Render) · 005 backend only, unverified |
| **R1 Core** | 006 Exemption eligibility · 007 Case management · 008 Compliance validation · 009 Data freshness · 010 Audit logging · 011 Section 508 · 012–015 Role dashboards · 016 API governance (OPA) | 006 ✅ live · 007 ✅ live (both approved by Ali, 2026-10-02) · 008 ✅ live 2026-10-06 (posted; awaiting Ali's review) · **009 next** · roles foundation in place for 012–015 · audit logging partly in place |
| **R2 AI & Governance** | 017–020 RAG policy Q&A · 021 drift · 022 hallucination monitoring · 023 HITL ladder · 024 override tracking · 025 bias testing · 026–029 observability | Not started |
| **R3 Scale & Launch** | 030–032 load testing · 033 performance · 034 failover · 035 training · 036 monitoring · 037 incident playbook · 038–040 docs · 041 pen test · 042 accessibility audit · 043–046 go-live review | Not started |

### What the live demo does today
- Register/login (bcrypt passwords **and SSNs**, 1-hour JWT), demo-data banner, masked SSN entry.
- Profile (phone, address, income, hardship) with compliance check (18+, phone, address).
- Exemption eligibility: Type A senior (65+), Type B income (< $20,000), Type C hardship (Pending Review), each with a reason; audit-logged.
- Case management: apply → Submitted → In Review → Approved/Denied (reason required) → Appeal; timeline, in-app notifications, internal notes, document links, staff filters, CSV export (no SSNs).
- Compliance validation: every approval or denial is checked against 8 decision controls (eligibility basis, re-check after a profile change, denial reason and notice, separation of duties, assignment, review before decision, required document, audit entry). A failure opens a review that a *different* case manager resolves with a justification (accept the exception, recorded as an override, or reopen the case). Staff get a compliance dashboard (99% target with an alert) and a filterable audit log of every control result.
- Roles: citizen / case manager / admin. Case managers come from Render env `CASE_MANAGER_EMAILS`.

---

## 4. Platform

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + Tailwind v4 → Render static site `sss-demo-frontend` |
| Backend | Node + Express + TypeScript → Render web service `sss-demo-backend` (free tier, sleeps when idle) |
| Database | Render PostgreSQL `sss-demo-db` (Oregon); migrations 001–013 apply automatically on startup |
| Source | https://github.com/OBIANAMS04/sss-modernization-demo (Render auto-deploys on push to master) |
| Workflow | Claude commits and pushes each change; Render deploys; Claude verifies the live deploy itself and posts the conclusion with screenshots to the BUILD ticket (one post per milestone) |
| Verification | `scripts/verify-deploy.mjs`: served commits, database, migrations, and every protected route refuses requests without a token (live) · `scripts/verify-live-citizen.mjs`: every staff route refuses a signed-in citizen (live) · `scripts/evidence/<story>.mjs`: drives the UI in headless Chrome and captures the evidence pack in `docs/evidence/<story>/` |

---

## 5. Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-07-28 | Validate every proposal task against its ticket's acceptance criteria; Task 10 is a gate, not a document | Ali |
| 2026-08-31 | Deploy the demo to Render (Node runtime) instead of local Docker (WSL2 blocked) | Obi |
| 2026-09-17 | "Do both now": demo-data banner + SSN hashed, never logged. One post per milestone on the BUILD list | Ali |
| 2026-09-30 | Fold STORY-002 (profile) into R1 alongside STORY-006 | Obi |
| 2026-10-01 | Case managers granted by email allowlist; documents attached as links until object storage (STORY-004) | Obi |
| 2026-10-06 | STORY-008 design: 8 decision controls are checked at the moment of decision; a failed decision opens a review that only a different case manager can resolve, with a required justification (accept = audited override, or reopen); failed decisions keep counting toward the 99% target | Obi |
| 2026-10-02 | STORY-006 and STORY-007 approved as shipped `[decision-2026-10-02-sss-r0-r1-approved]`. Lesson: every route gets its access check when written (now enforced by a test, see docs/SECURITY-RULES.md). Process: the team verifies its own deploys and posts screenshots + conclusion; Ali reviews the live site as a user. File uploads waiting on STORY-004 is on Ram and Ali | Ali |

---

## 6. Milestone timeline

| Date | Milestone |
|---|---|
| 2026-07-28 | Proposal tasks realigned; Task 10 review gate created |
| 2026-08-03 | STORY-001 registration built locally |
| 2026-09-16 | Real source pushed to GitHub (broken submodule fixed); first Render deploy |
| 2026-09-17 | **R0 live demo verified** and posted; Ali's guards decision |
| 2026-09-26 | Guards live (SSN hashed, banner), masked SSN, real error messages |
| 2026-09-30 | Guards confirmation posted; tracked migrations; site-wide CSS fix |
| 2026-10-01 | **STORY-006 live** · security fix (roles) · **STORY-007 live**; both posted |
| 2026-10-02 | **Ali approves STORY-006 and STORY-007**; asks for case manager access |
| 2026-10-06 | Access rule required for every route (test-enforced) · expired logins return 401 instead of 500 · honest `/health` with deployed commit · self-verified deploys · runtime security patches · Ali's case manager access live; reply posted `#__recording_10375070502` · **STORY-008 live**: compliance validation, reviews, dashboard and audit log, verified on the live site with an evidence pack; posted `#__recording_10375183698` |

Basecamp posts: R0 final `#__recording_10312647276` · guards `#__recording_10355304599` · STORY-006 `#__recording_10362153151` · STORY-007 `#__recording_10363503258` · Ali's approval `#__recording_10365688982` · Ali's access `#__recording_10375070502` · STORY-008 `#__recording_10375183698` (BUILD ticket https://app.basecamp.com/3945211/buckets/47346103/todolists/10068241172)

---

## 7. Risks and follow-ups

| Risk / follow-up | Impact | Action |
|---|---|---|
| Proposal Tasks 4, 6–9 waiting on Ali; deadline unknown | Submission at risk | Confirm deadline; Ali's checklist in TASK_COMPLETION_STATUS.md |
| AWS approval (Ram) pending | Blocks STORY-004 and real document upload | Ram decision |
| Render DB password and JWT secret were shared in chat (2026-09-17) | Must not hold real PII as-is | Rotate both before any real data |
| `npm audit` (2026-10-06): 44 findings, but only 3 in runtime dependencies after the non-breaking patch update (Express 4.22.3, proxy-addr, qs, body-parser) | Remaining critical (`tar`) runs only while bcrypt installs, never on requests; the rest are jest/eslint tooling | Dependency upgrade pass before go-live (consider bcryptjs to drop tar) |
| Render free tier sleeps | ~50 s first load | Warm the site before demos, or upgrade |
| No frontend unit tests; 10 old backend route-test suites are stale (they need a `sss_demo_test` database), and `apiGovernanceService` imports a missing logger | Regressions caught late | The UI is now checked end to end by the evidence scripts; repair or retire the stale suites |
| The case-manager role is granted from an email list without verifying that the person owns the address | Whoever registers a listed address first gets staff access | Email verification or admin-assigned roles before any real data |
| Colaberry's upload endpoint refuses requests over ~1 MB (nginx 413), although its tools say 10 MB | Whole evidence PDFs can't be attached to Basecamp | Colaberry admin to raise `client_max_body_size`; meanwhile attach the key screenshot and link the full pack on GitHub |
| Norton HTTPS scanning on Obi's laptop corrupts some connectors | Colaberry works via local bridge; others fail | Optional Norton exclusion |

---

## 8. Links
- Live demo: https://sss-demo-frontend.onrender.com · API health: https://sss-demo-backend.onrender.com/health
- GitHub: https://github.com/OBIANAMS04/sss-modernization-demo
- STORY-008 evidence pack: https://github.com/OBIANAMS04/sss-modernization-demo/tree/master/sss-modernization-demo/docs/evidence/story-008
- Demo briefing (purpose, problems solved, walkthrough; source for the NotebookLM deck): artifact https://claude.ai/artifact/7uX47ceMBSxM2uVJK8smwo · PDF `docs/demo/SSS-Modernization-Demo-Briefing.pdf`
- Demo slide deck (15 slides with speaker notes; downloads as PowerPoint or PDF): https://claude.ai/artifact/EMxgHSsgJxnRw4SHYKpy5W · source `docs/demo/deck/`
- Render: https://dashboard.render.com
- Basecamp BUILD ticket: https://app.basecamp.com/3945211/buckets/47346103/todolists/10068241172

## How this document is maintained
Updated by Claude after every milestone (together with the published "SSS Modernization Framework" artifact), and committed with that milestone's code.

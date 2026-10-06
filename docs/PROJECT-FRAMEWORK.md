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
| **R1 Core** | 006 Exemption eligibility · 007 Case management · 008 Compliance validation · 009 Data freshness · 010 Audit logging · 011 Section 508 · 012–015 Role dashboards · 016 API governance (OPA) | 006 ✅ live · 007 ✅ live (both approved by Ali, 2026-10-02) · **008 next** · roles foundation in place for 012–015 · audit logging partly in place |
| **R2 AI & Governance** | 017–020 RAG policy Q&A · 021 drift · 022 hallucination monitoring · 023 HITL ladder · 024 override tracking · 025 bias testing · 026–029 observability | Not started |
| **R3 Scale & Launch** | 030–032 load testing · 033 performance · 034 failover · 035 training · 036 monitoring · 037 incident playbook · 038–040 docs · 041 pen test · 042 accessibility audit · 043–046 go-live review | Not started |

### What the live demo does today
- Register/login (bcrypt passwords **and SSNs**, 1-hour JWT), demo-data banner, masked SSN entry.
- Profile (phone, address, income, hardship) with compliance check (18+, phone, address).
- Exemption eligibility: Type A senior (65+), Type B income (< $20,000), Type C hardship (Pending Review), each with a reason; audit-logged.
- Case management: apply → Submitted → In Review → Approved/Denied (reason required) → Appeal; timeline, in-app notifications, internal notes, document links, staff filters, CSV export (no SSNs).
- Roles: citizen / case manager / admin. Case managers come from Render env `CASE_MANAGER_EMAILS`.

---

## 4. Platform

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + Tailwind v4 → Render static site `sss-demo-frontend` |
| Backend | Node + Express + TypeScript → Render web service `sss-demo-backend` (free tier, sleeps when idle) |
| Database | Render PostgreSQL `sss-demo-db` (Oregon); migrations 001–012 apply automatically on startup |
| Source | https://github.com/OBIANAMS04/sss-modernization-demo (Render auto-deploys on push to master) |
| Workflow | Claude commits each completed phase; Obi runs `git push deploy master`; Render deploys; milestone posted to the BUILD ticket (one post per milestone) |

---

## 5. Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-07-28 | Validate every proposal task against its ticket's acceptance criteria; Task 10 is a gate, not a document | Ali |
| 2026-08-31 | Deploy the demo to Render (Node runtime) instead of local Docker (WSL2 blocked) | Obi |
| 2026-09-17 | "Do both now": demo-data banner + SSN hashed, never logged. One post per milestone on the BUILD list | Ali |
| 2026-09-30 | Fold STORY-002 (profile) into R1 alongside STORY-006 | Obi |
| 2026-10-01 | Case managers granted by email allowlist; documents attached as links until object storage (STORY-004) | Obi |
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
| 2026-10-06 | Access rule required for every route (test-enforced) · expired logins return 401 instead of 500 · honest `/health` with deployed commit · self-verified deploys |

Basecamp posts: R0 final `#__recording_10312647276` · guards `#__recording_10355304599` · STORY-006 `#__recording_10362153151` · STORY-007 `#__recording_10363503258` · Ali's approval `#__recording_10365688982` (BUILD ticket https://app.basecamp.com/3945211/buckets/47346103/todolists/10068241172)

---

## 7. Risks and follow-ups

| Risk / follow-up | Impact | Action |
|---|---|---|
| Proposal Tasks 4, 6–9 waiting on Ali; deadline unknown | Submission at risk | Confirm deadline; Ali's checklist in TASK_COMPLETION_STATUS.md |
| AWS approval (Ram) pending | Blocks STORY-004 and real document upload | Ram decision |
| Render DB password and JWT secret were shared in chat (2026-09-17) | Must not hold real PII as-is | Rotate both before any real data |
| `npm audit`: 8 vulnerabilities (4 moderate, 3 high, 1 critical) on 2026-10-01 | Mostly dev/install-time; `express`/`qs` DoS in request path | Upgrade pass before go-live |
| Render free tier sleeps | ~50 s first load | Warm the site before demos, or upgrade |
| No frontend test framework; old backend route tests stale | Regressions caught late | Add tests as R1 continues |
| Norton HTTPS scanning on Obi's laptop corrupts some connectors | Colaberry works via local bridge; others fail | Optional Norton exclusion |

---

## 8. Links
- Live demo: https://sss-demo-frontend.onrender.com · API health: https://sss-demo-backend.onrender.com/health
- GitHub: https://github.com/OBIANAMS04/sss-modernization-demo
- Render: https://dashboard.render.com
- Basecamp BUILD ticket: https://app.basecamp.com/3945211/buckets/47346103/todolists/10068241172

## How this document is maintained
Updated by Claude after every milestone (together with the published "SSS Modernization Framework" artifact), and committed with that milestone's code.

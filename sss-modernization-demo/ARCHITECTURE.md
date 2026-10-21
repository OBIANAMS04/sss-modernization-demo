# SSS Modernization Platform - Architecture

## System Overview

The SSS Modernization Platform uses a modern, cloud-native microservices architecture designed for scalability, security, and federal compliance (NIST 800-53, FedRAMP).

**Release Zero (R0)** focuses on core functionality: user authentication, profile management, and MFA setup.

---

## High-Level Architecture

```
┌─ React 18 Frontend (Vite on 5173)
│  ├─ Login / Register Pages
│  ├─ Protected Dashboard
│  └─ Profile Management
│
├─ HTTP + JWT Token (HTTPS in prod)
│
├─ Express.js API (Node.js on 3001)
│  ├─ /api/auth (register, login)
│  ├─ /api/users (profile management)
│  ├─ /api/mfa (setup, verify)
│  └─ /health (monitoring)
│
└─ PostgreSQL Database (Port 5432)
   ├─ users table (UUID, email, password_hash, full_name)
   └─ mfa_devices table (user_id FK, secret)
```

---

## Frontend Architecture

**Components:**
- Login, Register, Dashboard pages
- ProtectedRoute wrapper (auth guard)
- UserProfile card component

**Services:**
- `api.js` - Axios HTTP client with JWT interceptors
- `authService.js` - register(), login(), getProfile()

**Hooks:**
- `useAuth()` - Authentication state (isAuthenticated, user, loading)
- `useApi()` - API call hook (data, loading, error)

**Utils:**
- `tokenManager.js` - JWT persistence (localStorage)
- `validators.js` - Form validation (email, password, username, fullName)

**Styling:**
- Tailwind CSS 4 (utility-first)
- Responsive grid layout
- Dark mode support

---

## Backend Architecture

**Routes:**
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Authenticate user
- `GET /api/users/:id` - Get profile
- `PUT /api/users/:id` - Update profile
- `/api/mfa/*` - MFA setup, confirm, turn off (signed in); `POST /api/auth/mfa/verify` - the code step of sign-in
- `GET /health` - Health check

**Middleware Stack:**
- CORS (restricted origins)
- JSON body parser
- Request logging
- Access policy (OPA), before every router (see Access policies below)
- JWT authentication (on protected routes)
- Error handler (centralized)

**Services Layer:**
- `authService.ts` - User registration & login
- `userService.ts` - Profile management
- `mfaService.ts` - TOTP keys, code checks (one-step window, a code works once, 5 tries)

**Utilities:**
- `jwt.ts` - generateToken(), verifyToken()
- `validators.ts` - Input validation (server-side)
- `errors.ts` - Custom error classes (AppError, ValidationError)

**Database Layer:**
- Connection pooling (10-20 connections)
- Parameterized queries (prevent SQL injection)
- PostgreSQL 18.6

---

## Database Schema

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,  -- bcryptjs 12 rounds
  full_name VARCHAR(255),
  mfa_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  secret VARCHAR(32) NOT NULL,
  enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_mfa_user_id ON mfa_devices(user_id);
```

---

## Security Architecture

### Authentication Flow

1. User submits email + password
2. Backend validates input (server-side)
3. Query: `SELECT * FROM users WHERE email = $1`
4. bcrypt.compare(input_password, stored_hash)
5. If match: generate JWT (HS256, 1-hour TTL)
6. Return JWT to client
7. Client stores in localStorage
8. Subsequent requests include: `Authorization: Bearer <token>`
9. Backend verifies JWT signature & expiry

### Password Security

- **Algorithm**: bcryptjs
- **Rounds**: 12 (OWASP recommended)
- **Comparison**: Timing-safe (prevents brute force)
- **Transmission**: HTTPS only in production

### JWT Security

- **Algorithm**: HS256 (HMAC-SHA256)
- **Secret**: Environment variable (never in code)
- **TTL**: 1 hour
- **Payload**: `{ sub: userId, email, iat, exp }`
- **Stateless**: No database query needed to verify

### Input Validation

- **Email**: RFC 5322 compliant
- **Password**: 6+ characters
- **Username**: 3+ characters, alphanumeric + underscore
- **Full Name**: 2+ characters
- **Prevention**: Parameterized queries (SQL injection)

---

## Access policies (OPA)

STORY-016, demonstrated on a synthetic demo deployment. Every API request is decided by an access policy written in Rego and
run by the real Open Policy Agent (OPA 1.21.0). The policy checks the caller's role, the kind of record the route is about,
the action (read or write) and who owns or is assigned the record. Example rule: "Case managers can view cases assigned to them".

- **Rego to WebAssembly.** The policy is `backend/policy/sss_authz.rego` (`package sss.authz`, entry point `sss/authz/decision`,
  which answers `{allow, rule, reason}`), tested by `backend/policy/sss_authz_test.rego` (`opa test`). `scripts/opa/build.mjs`
  downloads the OPA tool once to `~/.cache/sss-opa/` (outside the repo, SHA-256 verified before each use), runs `opa check` and
  `opa test`, compiles the policy to WebAssembly, and writes `backend/policy/sss_authz.wasm` and `manifest.json` (OPA version,
  entry point, SHA-256 of the .rego and of the .wasm). Both are committed, because the deployment has no OPA tool. The API loads
  the .wasm in-process with `@open-policy-agent/opa-wasm` (no OPA server to run) and refuses to start if it is not the file the
  manifest names. A jest test fails when the .rego was edited without rebuilding.
- **Data from code and the database.** The policy is given `data.routes` (the roles each route accepts, from the access table
  `security/routeAccess.ts`, and the kind of record it is about) and `data.rules` (the nine attribute rules in
  `security/accessPolicy.ts`). On top, the newest row of `access_policy_versions` (migration 019, write-once like the audit
  log) is applied: which rules are switched off, and which routes are limited to fewer roles. Only those changes are stored, so a
  deploy that adds or changes routes needs no data migration. A limit can only narrow what the code allows, and sign-in, the
  health check and the policy pages themselves are locked, so an administrator cannot be locked out.
- **Every request.** `middleware/enforcePolicy.ts` is mounted before every router. It finds the route Express will serve, reads
  the caller's role from the database on every request (no token, a refused token and a deleted account all count as not signed
  in), and loads the record's attributes for routes about a case, an account or an audit trail. Not signed in is refused with
  401 and the answer the sign-in check gives (an expired session still says so); anyone else is refused with 403
  `POLICY_DENIED`, "Access denied: <reason>". The error handler writes every refusal to the audit log as `ACCESS_DENIED` with the
  rule, the reason and the policy version. A request no route serves (a 404, a preflight) is left alone.
- **Two layers.** The guards on each route (`authenticate`, `requireStaff`, `requireRole`) and the checks in the handlers stay as
  a second layer: the policy can refuse what the code would allow, and never allows what the code refuses. The attribute rules
  cover routes about one record; lists (`GET /api/cases?scope=all`, the export) are scoped by the route's roles and their handlers.
- **Changed without a deploy.** Administrators use `GET`/`PUT /api/policies` or the Access Policies page. A save is a new version
  with a reason, recorded in the audit log as `POLICY_CHANGE` (who, what, why). The process that saved it applies it at once; every
  other process re-reads the newest version number at most every 5 seconds and reloads when it changed.
- **Rebuilding.** After editing the .rego, run `node scripts/opa/build.mjs` and commit the .rego, the .wasm and `manifest.json`
  together (`--check` rebuilds and fails if the committed files differ). To change which rules exist, edit `RULES` in
  `security/accessPolicy.ts`; to add a route, declare it in `security/routeAccess.ts` (a test fails until it is).

---

## Policy assistant (STORY-017 to 024)

A signed-in person asks a question about synthetic policy documents and gets an answer that cites them, or the passages
themselves. Demonstrated on a synthetic demo deployment; the documents are illustrative demo policy, not Selective Service policy.

- **Corpus (`services/policyCorpus.ts`).** `backend/policy-docs/*.md` (each opens with the "illustrative demo policy" line, and a
  document without it is refused) are split at their headings into passages with stable ids (`<document>:<heading>`) and stored in
  `policy_passages` with a weighted full-text index (migration 020). At startup a document is replaced only when its SHA-256
  differs from the stored one, and a change is audited as `AI_CORPUS_UPDATE` in the same transaction. Retrieval is
  `websearch_to_tsquery` with the words joined by OR, ranked by `ts_rank`; no vector store, no LangChain.
- **Answer (`services/assistantModel.ts`).** `@anthropic-ai/sdk` (pinned), model `claude-opus-5-5` or `AI_MODEL`, key from
  `ANTHROPIC_API_KEY` alone. Each retrieved passage is a plain-text `document` block with `citations: { enabled: true }` and the
  passage id as its title, so the citations the API returns name the passage and quote its exact text. The stable instructions are the
  cached system prompt; `output_config.effort` is `low`; thinking is left at its default; the server-side refusal fallback
  (`fallbacks: "default"`) is on; calls time out after 30 seconds and typed SDK errors become a fall back to the passages. With no
  key (or `AI_PROVIDER=off`) only the passages are returned; `AI_PROVIDER=stub` is a deterministic stand-in for tests.
- **Check (`services/groundingCheck.ts`).** A pure function: every sentence covered by a citation, every number, date or amount in a
  cited quote or passage, every cited passage among those retrieved. It decides `grounded`, `unsupported` and `coverage`.
- **Oversight (`services/oversightLevel.ts`).** Level 2 (withheld for a case manager) for an ungrounded answer or a question about
  the asker's own eligibility or case; level 1 for fewer than two cited passages or coverage under 0.9; otherwise level 0.
- **Page and feedback (`components/Assistant/`, `services/assistantReviewService.ts`).** `/assistant` is for everyone signed in: a labelled
  question field with a character count, the answer with its oversight status in plain words, numbered citations that open the passage
  (a disclosure; `GET /api/assistant/passages`), Helpful / Not helpful / Report a problem, and the person's recent questions. A report
  withholds the answer again and sends the exchange to the review queue at level 2.
- **Review queue (STORY-023).** `/assistant/reviews` (staff) lists the withheld and reported exchanges, oldest first, with the question, the
  draft, its citations, the grounding result and why it is there. A case manager approves the draft, corrects it or declines, with a note;
  the exchange row is locked, the person is notified through the existing notifications and sees the reviewed answer in their history marked
  as reviewed, and the review is audited as `AI_REVIEW` (never the question or the answer). Nobody reviews a question they asked.
- **Override rate (STORY-024, `services/overrideRateService.ts`).** Overrides divided by reviewed items over 30 days, against a target below
  20%, on the admin and leadership dashboards with a weekly trend, a breakdown by source and an alert. The denominator and numerator are
  defined in the comment at the top of the service and in `API-SPECIFICATION.md`; each case decision keeps the eligibility result it was
  made against (`case_events.eligibility_status`, migration 021), since exemption rows are updated in place.
- **Drift and fairness (STORY-021, 025; `/ai-quality`).** `services/driftSignals.ts` (pure) defines the nine daily signals of real AI answers and drift (last 7 days against the 28 before, a tolerance per signal, 20-answer minimum); `aiQualityService.ts` reads them, keeps alerts (audit event plus a notification to administrators, once until cleared) and change markers (`changeMarkers.ts`: model and corpus version). `evalRunService.ts` and `counterfactualService.ts` run the golden set and the counterfactual set on the server through `answerFor()` (the path a real question takes), stored in `assistant_eval_runs` (migration 022), once an hour per kind, admin only. `outcomeMonitoring.ts` watches approval rate, days to decide and override rate by age band and region with the four-fifths rule. Retrieval searches only from the question onward (`retrievalText`), because what people say about themselves must not change which passages are found.
- **Limits and privacy (`services/assistantService.ts`).** SSN-shaped text is removed from the question before it is searched,
  stored, sent or audited. Each person may ask 20 questions per hour (429 with `Retry-After`) and `AI_DAILY_LIMIT` (300) answers
  may be generated per UTC day; both are counted under one advisory lock when the question is accepted, so parallel requests cannot
  slip past. Every exchange is stored in `assistant_interactions` and audited as `AI_ANSWER` without the question.
- **Evaluation.** `scripts/ai/eval.mjs` scores the 33 golden questions against the running API (retrieval, facts, citation
  validity, grounded rate) and exits 1 below its thresholds.

---

## Docker Architecture

**Frontend Container:**
- Base: node:26.7-alpine
- Build stage: npm ci + npm run build
- Runtime: serve package on 5173
- Health check: HTTP GET 5173

**Backend Container:**
- Base: node:26.7-alpine
- Build stage: npm ci + TypeScript compile
- Runtime: Non-root nodejs user on 3001
- Health check: HTTP GET 3001/health

**Database Container:**
- Image: postgres:18.6-alpine
- Port: 5432
- Volume: postgres_data (persistent)
- Health check: pg_isready

**Docker Compose:**
- Orchestrates 3 services
- Bridge network (sss-network)
- Service dependencies (backend depends_on postgres, frontend depends_on backend)
- Named volume for database persistence

---

## Data Flows

### Registration Flow

```
1. User enters: email, username, password, full_name
2. Frontend validation
3. POST /api/auth/register
4. Backend validation
5. Check: user already exists?
6. Hash password (bcryptjs 12 rounds)
7. INSERT INTO users
8. Generate JWT
9. Return { token, user }
10. Client saves token to localStorage
11. Redirect to /dashboard
12. Dashboard shows welcome message + user profile
```

### Login Flow

```
1. User enters: email, password
2. POST /api/auth/login
3. SELECT * FROM users WHERE email = $1
4. bcrypt.compare(password, password_hash)
5. If match: generate JWT
6. Return { token, user }
7. Client saves token, redirect to /dashboard
8. Subsequent requests: Authorization: Bearer <token>
```

### Protected Request Flow

```
1. Client: GET /api/users/:id Authorization: Bearer <token>
2. Middleware: verifyToken(token)
3. Extract userId from JWT payload
4. Proceed with request (no DB query for auth)
5. Execute business logic
6. Return response (200 OK)
```

---

## Scalability

### Horizontal Scaling (R1+)

**Frontend:**
- CDN for static assets (CloudFront, CloudFlare)
- Load balancer distributes traffic
- Stateless (no session affinity needed)

**Backend:**
- Multiple Node.js instances
- Load balancer (round-robin)
- Stateless (JWT contains all auth info)
- Shared PostgreSQL connection pool

**Database:**
- Connection pooling (pgBouncer)
- Read replicas (future)
- Sharding (future, Phase 3+)

---

## Monitoring & Logging

**Health Checks:**
- Frontend: HTTP 200 on 5173
- Backend: HTTP 200 on 3001/health
- Database: pg_isready

**Logging:**
- Request logs (timestamp, method, URL, status, duration)
- Error logs (stack trace, context)
- Centralized: AWS CloudWatch (Phase 2+)

**Metrics (Phase 2+):**
- Request rate, latency (p50, p95, p99)
- Error rate (4xx, 5xx)
- DB connection pool usage
- Container CPU, memory

---

**Last Updated:** August 31, 2026  
**Version:** R0.1  
**Status:** Production-Ready

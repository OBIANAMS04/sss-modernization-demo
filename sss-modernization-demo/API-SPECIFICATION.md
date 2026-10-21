# SSS Modernization Platform - API Specification

## Base URL

Development: http://localhost:3001/api
Production: https://api.yourdomain.com/api

## Authentication

All protected endpoints require:
Authorization: Bearer <JWT_TOKEN>

JWT Expiry: 1 hour

---

## Auth Endpoints

### POST /api/auth/register

Create new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "username": "john_doe",
  "password": "SecurePass123",
  "full_name": "John Doe"
}
```

**Success (201):**
```json
{
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": "uuid", "email": "...", "username": "...", "full_name": "..." }
}
```

**Error (400):**
```json
{ "error": { "message": "Validation failed", "code": "VALIDATION_ERROR" } }
```

**Error (409):**
```json
{ "error": { "message": "Email already exists", "code": "DUPLICATE_EMAIL" } }
```

---

### POST /api/auth/login

Authenticate user and get JWT token.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

**Success (200):**
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": "uuid", "email": "...", "username": "..." }
}
```

**Error (401):**
```json
{ "error": { "message": "Invalid email or password", "code": "INVALID_CREDENTIALS" } }
```

**Success when the account has two-step verification (200):** the password was right, but there is no session yet.
```json
{ "mfaRequired": true, "pendingToken": "eyJhbGciOiJIUzI1NiIs...", "expiresIn": 300 }
```
The pending token lasts 5 minutes and carries `purpose: "mfa"`. It is not a session: every endpoint that takes
`Authorization: Bearer` (including `POST /api/auth/refresh`) answers 401 to it. Its only use is the next endpoint.

---

### POST /api/auth/mfa/verify

The second step of sign-in. No `Authorization` header: the pending token goes in the body.

**Request:**
```json
{ "pendingToken": "eyJhbGciOiJIUzI1NiIs...", "code": "123456" }
```

**Success (200):** the same shape as a password login, with a new session token.
```json
{ "user": { "id": "uuid", "email": "...", "fullName": "...", "createdAt": "...", "role": "citizen" }, "token": "eyJhbGciOiJIUzI1NiIs..." }
```

**Errors:** 400 `VALIDATION_ERROR` (no token, or a code that is not 6 digits; not counted as a try); 400 `INVALID_CODE`
(wrong code; the message says how many of the 5 tries are left); 400 `CODE_ALREADY_USED` (a code is accepted once);
401 `UNAUTHORIZED` (pending token expired, invalid, or not a pending token); 429 `TOO_MANY_ATTEMPTS` (5 tries used up:
the pending token is finished and the person signs in again). Codes are accepted one 30-second step either side of now.

---

## User Endpoints

### GET /api/users/:id

Get user profile (requires authentication).

**Headers:** Authorization: Bearer <token>

**Success (200):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "john_doe",
  "full_name": "John Doe",
  "mfa_enabled": false,
  "created_at": "2026-08-31T12:00:00Z"
}
```

---

### PUT /api/users/:id

Update user profile (requires authentication).

**Request:**
```json
{ "full_name": "John Smith" }
```

**Success (200):**
```json
{
  "message": "Profile updated successfully",
  "user": { "id": "uuid", "full_name": "John Smith", "updated_at": "..." }
}
```

---

## MFA Endpoints (STORY-003)

Time-based one-time codes (RFC 6238: 6 digits, 30 seconds) for an authenticator app such as Google Authenticator, Authy or
Microsoft Authenticator. These endpoints need a session token. Wrong codes are counted per signed-in session (5 tries,
then 429 `TOO_MANY_ATTEMPTS`; signing in again starts a new count).

### POST /api/mfa/setup

Starts a setup and returns the key. The response is the only time the key is sent, and is not cached.

**Success (200):**
```json
{ "secret": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "otpauthUrl": "otpauth://totp/...", "qrCode": "data:image/png;base64,..." }
```
409 `CONFLICT` while two-step verification is already on.

### POST /api/mfa/verify

Confirms the setup with a code from the app; this stores the device as verified and turns two-step verification on.
The key is the one stored at setup (a key in the request is ignored).

**Request:** `{ "totpCode": "123456" }` **Success (200):** `{ "success": true, "message": "..." }`

### POST /api/mfa/disable

Turns two-step verification off. Needs a current code. **Request:** `{ "totpCode": "123456" }`. 409 if it is not on.

### GET /api/mfa/status

**Success (200):** `{ "mfaEnabled": true }`

Every setup, enabling, code request, accepted code, refused code (with its reason and try number, never the code) and turning
off is written to the audit log as `MFA_SETUP`, `MFA_ENABLE`, `MFA_CHALLENGE`, `MFA_VERIFIED`, `MFA_VERIFY_FAILED` or `MFA_DISABLE`.

---

## Access Policy (STORY-016)

Every request is decided by an access policy (Open Policy Agent, compiled to WebAssembly) before any route runs: by the
caller's role, the route, the action (GET is a read, anything else a write) and, for routes about one case, account or audit
trail, who owns or is assigned the record. The checks on each route stay behind it. Demonstrated on a synthetic demo deployment.

**What a refusal looks like.**

| Caller | Status | Body |
|--------|--------|------|
| Not signed in (no token, a refused token, or an account that no longer exists) | 401 | `{ "error": { "message": "Missing or invalid authorization header", "code": "UNAUTHORIZED" } }`; a token that was refused keeps its own message, such as `Your session has expired. Please sign in again.` |
| Signed in, refused by the policy | 403 | `{ "error": { "message": "Access denied: No rule lets a case manager work a case assigned to someone else", "code": "POLICY_DENIED" } }` |

Every refusal is written to the audit log as `ACCESS_DENIED` with `rule` (a rule id, or `no-route`, `route-roles`,
`no-matching-rule`), `reason` and `policyVersion` beside the method, path and status. A record that does not exist is not refused:
the route answers 404 as usual.

### GET /api/policies

Admins only. The policy engine, the version in force, every rule and route with its state, and the last 20 versions.

**Success (200):**
```json
{
  "engine": { "name": "Open Policy Agent", "version": "1.21.0", "format": "WebAssembly", "wasmSha256": "3ad8ff8be8434daee3b94be3200732bde6f375ff9547b0a78408208366220807" },
  "current": { "version": 2, "summary": "case-manager-team turned off", "reason": "Case managers work their own caseload", "changedBy": "morgan.lee@example.com", "changedAt": "2026-10-14T09:12:41.000Z" },
  "rules": [
    {
      "id": "case-manager-assigned",
      "description": "Case managers can view and work cases assigned to them",
      "resource": "case", "roles": ["case_manager"], "actions": ["read", "write"], "when": "assignee",
      "enabled": true, "defaultEnabled": true
    }
  ],
  "routes": [
    { "key": "GET /api/cases/export", "method": "GET", "path": "/api/cases/export", "resource": null,
      "baselineRoles": ["case_manager", "admin"], "roles": ["case_manager", "admin"], "locked": false }
  ],
  "history": [
    { "version": 2, "summary": "case-manager-team turned off", "reason": "Case managers work their own caseload", "changedBy": "morgan.lee@example.com", "changedAt": "2026-10-14T09:12:41.000Z" }
  ]
}
```
Before anything is changed, `current` is `{ "version": 0, "summary": "The defaults that come with the code", "reason": null, "changedBy": null, "changedAt": null }`.
A rule's `when` is `any`, `owner`, `assignee`, `unassigned` or `under_review`. `baselineRoles` are the roles the route's code allows;
`roles` are the roles it allows now. A locked route (sign-in, `GET /health`, and these two endpoints) cannot be limited.
403 `POLICY_DENIED` for anyone who is not an admin; 401 when not signed in.

### PUT /api/policies

Admins only. Saves a new version, audited as `POLICY_CHANGE` (who, what, why), and applies it at once; every other instance applies it
within 5 seconds. Returns what `GET /api/policies` returns.

**Request:** `rules` and `routes` are both optional, and `reason` is required (up to 500 characters).
```json
{
  "rules": { "case-manager-team": false },
  "routes": { "GET /api/cases/export": ["admin"] },
  "reason": "Case managers work their own caseload; only admins export"
}
```
A route sent all the roles its code allows is no longer limited. Roles can only be taken away from a route, never added beyond what the
code allows.

**Error (400 `VALIDATION_ERROR`):** no reason or one over 500 characters; an unknown rule or route; a rule not set to `true` or
`false`; a route given no role, or a role its code does not allow; a locked route; or a change that changes nothing. Nothing is saved.

---

## Policy Assistant (STORY-017 to 024)

A signed-in person asks a question about the synthetic policy documents in `backend/policy-docs` (illustrative demo policy, not
Selective Service policy). The most relevant passages are found with PostgreSQL full-text search (`websearch_to_tsquery`,
`ts_rank`; the five best). With AI on, Claude answers only from them and cites them with its native citations; every answer is
then checked (a sentence without a citation, a number no cited text contains, or a citation to a passage that was not retrieved
fails the check) and given an oversight level. Social Security number-shaped text is removed from the question before anything is
searched, stored, sent to the model or logged. Demonstrated on a synthetic demo deployment.

**Settings (environment).** `ANTHROPIC_API_KEY` switches AI on; without it, or with `AI_PROVIDER=off`, the assistant returns the
policy passages alone (`mode: "passages-only"`). `AI_PROVIDER=stub` is a deterministic stand-in for tests that needs no key.
`AI_MODEL` names the model (default `claude-opus-5-5`). `AI_DAILY_LIMIT` (default 300) caps the answers generated per UTC day across
everyone; past it, questions get the passages alone. These settings are part of the audited configuration (STORY-010): turning AI on
or changing the provider, the model or the limit is recorded at the next start as `CONFIG_CHANGE` with the old and new values, and
`ANTHROPIC_API_KEY` by a fingerprint only, never its value.

### POST /api/assistant/ask

Anyone signed in. **Request:** `{ "question": "What is the income limit for the Type B exemption?" }`, 3 to 500 characters.

**Response (200):**
```json
{
  "traceId": "4bc727fb-eaad-459a-a522-4f5ecc937372",
  "mode": "ai",
  "status": "shown",
  "level": 0,
  "answer": "A registrant qualifies for Type B when the annual income on the profile is below $20,000.",
  "citations": [
    { "passageId": "exemption-type-b:who-qualifies-the-income-limit", "docTitle": "Exemption Type B: income under $20,000",
      "heading": "Who qualifies: the income limit",
      "quote": "A registrant qualifies for Type B when the annual income on the profile is below $20,000." }
  ],
  "grounding": { "grounded": true, "coverage": 1, "unsupported": [] },
  "retrieved": [ { "passageId": "exemption-type-b:who-qualifies-the-income-limit", "docTitle": "...", "heading": "..." } ],
  "questionRedacted": false
}
```
`mode` is `ai`, `stub` or `passages-only`. `status` and `level` say how much oversight the answer got:

| level | status | What the person gets |
|-------|--------|----------------------|
| 0 | `shown` | A grounded answer citing at least two passages, with at least 90% of it under a citation |
| 1 | `shown` | A grounded answer on thinner ground (one passage, or less of it cited): "check with a case manager". Also `no-answer`: the documents do not cover the question (`message` says so) |
| 2 | `with-staff` | Nothing of the answer: `answer` is null, `citations` is empty and `message` is "A case manager will review this question and reply." Used when the answer failed the grounding check, and for a question about the person's own eligibility or case ("am I", "my case", "will I be approved") |

With AI off, at the daily cap, or when the model is unavailable, refuses or runs out of room, `mode` is `passages-only` (or keeps
`ai` after a refusal), `answer` is null and `passages` holds the policy text (`passageId`, `docTitle`, `heading`, `text`) with a plain
`message` that says why. `grounding` is null when no answer was made; for a withheld answer it holds only `grounded` and
`coverage`. `questionRedacted` is true when something shaped like an SSN was removed from the question.

Every exchange is stored and audited as `AI_ANSWER` (the trace id, mode, status, level and passage ids, never the question).
Policy documents re-ingested at startup are audited as `AI_CORPUS_UPDATE`.

**Errors:** 400 `VALIDATION_ERROR` (not text, under 3 or over 500 characters, or nothing but a Social Security number); 401 when not
signed in; 429 `RATE_LIMITED` after 20 questions in an hour ("You have reached the limit of 20 questions per hour. Please try again
in about 30 minutes."), with a `Retry-After` header in seconds.

### GET /api/assistant/history

Anyone signed in. The caller's own last 20 exchanges, newest first: `{ "history": [ { traceId, question, mode, status, level, answer,
citations, feedback, createdAt, message?, sections?, reviewed? } ] }`. The question is the cleaned one. A withheld answer is not shown:
`answer` is null and `message` says it is with a case manager; so is an answer the person reported. Once a case manager has reviewed it,
`status` is `reviewed` and `reviewed` is `{ outcome, at }`: `answer` is the reviewed answer (an approved draft with its citations, or the
case manager's correction with none), or null with a `message` when they declined. The withheld draft is never shown. An exchange
answered with the passages alone has `sections` (`[{ passageId, docTitle, heading }]`); their text is read with the next endpoint.
`feedback` is the person's rating, or null.

### GET /api/assistant/passages?id=

Anyone signed in. The title, heading and text of one policy passage, which is what a citation opens on the assistant page:
`{ "passage": { id, docSlug, docTitle, heading, text, version } }` (`version` is the first 12 characters of the document's content hash).
400 `VALIDATION_ERROR` without an id; 404 `NOT_FOUND` for a passage that does not exist; 401 when not signed in.

### POST /api/assistant/:traceId/feedback

Anyone signed in, on their own exchange only. **Request:** `{ "rating": "helpful" | "not-helpful" | "problem", "comment": "optional, up to 500 characters" }`.
SSN-shaped text is removed from the comment. A `problem` is a report: the answer is withheld again and the exchange goes to the review
queue at level 2. A rating can be changed until then. **Response (200):** `{ traceId, feedback, status, queued, message }`, where `status` is
`with-staff` after a report.

**Errors:** 400 for an unknown rating or a comment over 500 characters; 403 `FORBIDDEN` for another person's exchange (audited as
`ACCESS_DENIED`); 404 for a question that does not exist; 409 `CONFLICT` once the exchange is with a case manager or reviewed, since there is
nothing to rate. Audited as `AI_FEEDBACK`: the trace id, the rating, whether it was queued and whether there was a comment, never the comment.

### GET /api/assistant/quality

Staff only (case managers and admins); 403 for anyone else, 401 when not signed in. How often answers fail the grounding check:

```json
{
  "target": 2,
  "windows": [ { "days": 7, "answers": 40, "ungrounded": 1, "rate": 2.5 }, { "days": 30, "answers": 120, "ungrounded": 4, "rate": 3.33 } ],
  "alert": true,
  "alertMessage": "1 of 40 answers in the last 7 days failed the grounding check (2.5%, target below 2%).",
  "latestUngrounded": [ { "traceId": "...", "createdAt": "...", "question": "...", "answer": "...", "unsupported": [ { "type": "unsupported-number", "text": "45" } ], "mode": "ai", "model": "claude-opus-5-5", "level": 2 } ],
  "usage": { "generatedToday": 12, "dailyLimit": 300 },
  "corpus": { "documents": 8, "passages": 43, "version": "5b92e5985e22", "ingestedAt": "2026-10-15T22:38:52.830Z" }
}
```
`rate` is the percent of answers that failed the check (null when there were none); `alert` is true when a window is at or over the
2% target. An exchange that made no answer (AI off, no match, a failed call) is not an answer and is not counted.

### GET /api/assistant/reviews

Staff only (STORY-023); 403 for anyone else, 401 when not signed in. The review queue: every exchange with `status` `with-staff` (answers that
failed the grounding check, questions about the person's own eligibility or case, and answers the person reported), oldest first by when each
entered the queue (when it was asked or, for a report, when it was reported), up to 100; and the 10 latest reviews.

```json
{
  "waiting": 2,
  "items": [ {
    "traceId": "4bc727fb-eaad-459a-a522-4f5ecc937372",
    "question": "Am I eligible for the senior exemption?",
    "askedAt": "2026-10-16T08:00:00.000Z", "queuedAt": "2026-10-16T08:00:00.000Z",
    "askedBy": { "name": "Avery Lane", "email": "avery@example.com" },
    "own": false,
    "reasons": [ { "code": "personal-question", "text": "The question is about the person's own eligibility or case. The assistant never decides those." } ],
    "reportComment": null,
    "draft": { "answer": "A registrant qualifies for Type A when ...", "note": null, "citations": [ { "passageId": "...", "docTitle": "...", "heading": "...", "quote": "..." } ], "mode": "ai", "model": "claude-opus-5-5" },
    "grounding": { "grounded": true, "coverage": 1, "unsupported": [] }
  } ],
  "recentlyReviewed": [ { "traceId": "...", "question": "...", "outcome": "corrected", "reviewedBy": "casey@example.com", "reviewedAt": "2026-10-16T13:00:00.000Z", "reported": true } ]
}
```
`reasons` are `reported`, `ungrounded` and `personal-question` (or `held`). `own` is true for a question the caller asked, which another case manager
must review. `draft.answer` is null when no draft was made, and `draft.note` says why; `grounding` is null then too.

### POST /api/assistant/reviews/:traceId

Staff only. **Request:** `{ "outcome": "approved" | "corrected" | "declined", "answer": "...", "note": "..." }`. `note` (up to 1000 characters) is
required: why the case manager made this choice. It is kept with the exchange and in the audit log, and never shown to the person.
`answer` (up to 2000 characters) is required for `corrected` and replaces the draft; for `declined` it is the reason the person is given (without it
they are told "Please contact a case manager directly about this question."); an `approved` review sends the draft as it is and takes none. An
exchange with no draft cannot be approved. SSN-shaped text is removed from both.

The person is notified through their notifications ("A case manager reviewed your policy question ... and replied: ..."), and sees the result in
their history with `status` `reviewed`. The row is locked while it is reviewed, so two case managers cannot both review it. **Response (200):**
`{ traceId, outcome, status: "reviewed", notified }`.

**Errors:** 400 for an unknown outcome, no note, no answer for a correction, an answer with an approval, or a text over its limit; 403 `FORBIDDEN` for a
question the reviewer asked themselves ("You cannot review a question you asked yourself. Another case manager will review it.", audited as
`ACCESS_DENIED`) and for anyone who is not staff; 404 for a question that does not exist; 409 `CONFLICT` for one already reviewed or not waiting.
Audited as `AI_REVIEW`: the trace id, the outcome, the level, the mode, whether it was reported, and the note; never the question or an answer.

### Override rate on the admin and leadership dashboards (STORY-024)

`GET /api/dashboards/admin` and `GET /api/dashboards/leadership` each carry `overrideRate`, which holds counts and rates only:

```json
{
  "target": 20, "windowDays": 30, "reviewed": 12, "overrides": 3, "rate": 25, "alert": true,
  "alertMessage": "The override rate is 25% for the last 30 days (3 of 12 reviewed items). The target is below 20%.",
  "bySource": [ { "source": "assistant", "label": "Assistant answers", "description": "...", "reviewed": 5, "overrides": 2, "rate": 40 } ],
  "weeks": [ { "weekStart": "2026-10-12", "reviewed": 4, "overrides": 1, "rate": 25 } ]
}
```
The rate is **overrides divided by reviewed items** over the last 30 days, in percent, against a target below 20%; a rate at the target already
raises the alert (as the 2% hallucination target does). A *reviewed item* is something the system decided or drafted that a person then looked at:
an assistant answer a case manager reviewed (approved, corrected or declined); a compliance review a second case manager resolved (exception
accepted, or case reopened); or a case decision made where the automatic eligibility check had said Eligible or Not Eligible. An *override* is
one where the person went against the system: an answer corrected or declined; a compliance exception accepted (the `OVERRIDE` audit action);
a case approved while Not Eligible, or denied while Eligible. A decision made while the check said Pending Review (the system sent it to a
person), and a decision made before the result was recorded, are not counted. `bySource` has the three sources in a fixed order (`assistant`,
`compliance`, `eligibility`); `weeks` has the last twelve weeks, oldest first, each starting on a Monday, with a null `rate` for a week or a source
in which nothing was reviewed.

---

## AI Quality: drift and fairness (STORY-021, 025)

All under `/api/ai-quality`. Reading is for staff (case managers and admins; 403 for anyone else, 401 when not signed in). Starting a run and marking a
baseline are **admin only** (403 for a case manager): a run calls the model once per question, so it costs money.

### GET /api/ai-quality

Quality signals of the real AI answers (`mode` `ai`; the stand-in and passages-only answers are not counted), with drift, change markers, alerts and the
evaluation runs. Reading it also records any new change marker and opens or clears the alerts, so the alerts are current whenever anyone looks.

```json
{
  "windows": { "recentDays": 7, "baselineDays": 28, "minAnswers": 20 },
  "signals": [ { "key": "groundedRate", "label": "Grounded rate", "unit": "percent", "tolerance": "down more than 2 points", "state": "drift",
                 "recent": 72, "baseline": 100, "change": -28, "message": "Grounded rate moved from 100% to 72% (down more than 2 points is drift)." } ],
  "trend": { "days": ["2026-09-17", "..."], "answers": [0, 3], "series": [ { "key": "groundedRate", "label": "Grounded rate", "unit": "percent", "values": [null, 75] } ] },
  "markers": [ { "id": "...", "kind": "model", "from": "claude-opus-5-5", "to": "claude-sonnet-5-5", "at": "2026-10-20T10:00:00.000Z" } ],
  "alerts": [ { "id": "...", "kind": "signal", "key": "groundedRate", "message": "...", "openedAt": "...", "clearedAt": null } ],
  "evaluation": { "runs": [ "..." ], "latest": { "id": "...", "status": "completed", "mode": "ai", "model": "claude-opus-5-5", "corpusVersion": "5b92e5985e22",
                  "scores": { "retrievalHitRate": 1, "factAccuracy": 0.91, "citationValidity": 1, "groundedRate": 1 }, "passed": true, "isBaseline": false },
                  "baseline": { "...": "..." }, "thresholds": [ "..." ], "belowBaseline": [], "failures": [] }
}
```
Nine signals, each over the completed answers of a day or a window: `groundedRate`, `withheldRate`, `level1Share`, `noAnswerRate`, `citationsPerAnswer`,
`answerLength`, `p95LatencyMs`, `negativeFeedbackRate` and `reportRate`. Drift compares the last 7 days with the 28 days before, each with its own tolerance
(grounded rate down more than 2 points, p95 latency up more than 50%, ...); a window with fewer than 20 answers gives `state` `not-enough-data`.
`trend` has 35 days (UTC), the empty ones with `null` values. A marker is a change of model (as the API reports it) or of the policy documents' version
(`kind` `corpus`); `from` is null for the first one seen. An **alert** (`kind` `signal`, `eval` or `fairness`) opens once: it is audited
(`AI_DRIFT_ALERT`, phase `opened`) and a notification goes to every administrator; it stays open, without repeating, until its cause clears (phase `cleared`).
An evaluation run is drift when it misses a threshold (retrieval 0.90; for the real model also facts 0.85, citations 1 and grounded 0.98) or any score is
more than 5 points under the baseline of the same mode.

### GET /api/ai-quality/fairness

```json
{
  "latest": { "id": "...", "kind": "fairness", "status": "completed", "passed": true, "summary": { "pairs": 60, "samePassages": { "count": 60, "rate": 1, "required": 0.95 },
              "sameLevel": { "count": 60, "rate": 1, "required": 0.95 }, "factsInEveryVariant": { "count": 10, "of": 10, "rate": 1, "required": 1 }, "byAttribute": [ "..." ] } },
  "runs": [ "..." ],
  "outcomes": { "windowDays": 365, "minDecisions": 10, "fourFifths": 0.8, "decisions": 45, "flagged": ["Region West"],
                "byAgeBand": [ { "group": "18 to 24", "decisions": 45, "approvalRate": 80, "avgDaysToDecide": 2.6, "overrideRate": 20, "enough": true, "flagged": false, "ratioToHighest": null } ],
                "byRegion": [ "..." ] },
  "statement": { "heading": "What this demo does not collect, and why", "notCollected": ["Race", "..."], "paragraphs": [ "..." ] }
}
```
`outcomes` groups the approvals and denials of the last year by age band (from the date of birth) and region (from the state in the address; Census regions, or
`Unknown`); no address or date of birth is returned. A group with fewer than 10 decisions has its counts and no rates. The four-fifths rule flags a group whose
approval rate is under 80% of the highest group's (never `Unknown`, never a group under the minimum). The demo holds no race, sex, ethnicity, religion,
disability or national origin, and none was added.

### POST /api/ai-quality/evaluations and POST /api/ai-quality/fairness-runs

Admin only. Each starts a server-side run through the same retrieval and answer path as a real question (`answerFor`), nothing stored in the assistant's history and
nothing counted against the hourly limit or daily cap: the golden set (33 questions) for an evaluation, the counterfactual set (10 questions in 7 forms each, 70
calls) for a fairness run. **Response (202):** `{ "run": { "id", "kind", "status": "running", ... } }`; the run finishes in the background and is read from the
`runs` of the two GET routes (`status` `completed` or `failed`). Each kind can be started **once an hour**: a second start is a `429` `RATE_LIMITED` with
`Retry-After`. Stored in `assistant_eval_runs` (model, corpus version, mode, the four scores, per-question results, who started it). Audited as `AI_EVAL_RUN`
(phases `started`, `finished`, `failed`), never with a question or an answer.

### POST /api/ai-quality/runs/:id/baseline

Admin only. Marks a completed evaluation run as the baseline of its mode (the earlier one of that mode is released). **Response (200):** `{ "run": { ... } }`.
400 for an id that is not a run, a run that is not completed or a fairness run; 404 for no such run. Audited as `AI_EVAL_BASELINE`.

## Health Check

### GET /health

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2026-08-31T12:00:00Z",
  "database": "checking..."
}
```

---

## HTTP Status Codes

| Code | Usage |
|------|-------|
| 200 | Success (GET, PUT, login) |
| 201 | Created (register) |
| 400 | Validation failed |
| 401 | Unauthorized (invalid token/credentials; also anything the access policy refuses to a caller who is not signed in) |
| 403 | Forbidden (cannot update another user; `POLICY_DENIED` when the access policy refuses a signed-in caller) |
| 404 | Not found |
| 409 | Conflict (duplicate email; two-step verification already on) |
| 429 | Too many wrong authentication codes; too many questions to the policy assistant (`RATE_LIMITED`, with `Retry-After`) |
| 500 | Server error |

---

## CORS Configuration

Allowed origins:
- http://localhost:5173 (dev)
- http://localhost:3000 (alt dev)
- Production: specific domain only

---

## Error Format

All errors follow this structure:
```json
{
  "error": {
    "message": "Human-readable message",
    "code": "MACHINE_READABLE_CODE"
  }
}
```

---

## Future Endpoints (R1-R3)

- GET /api/exemptions - List exemptions
- POST /api/exemptions - Create exemption
- GET /api/cases/:id - Get case
- GET /api/compliance/status - Compliance status
- GET /api/data/stats - Statistics
- GET /api/audit/logs - Audit trail

---

Last Updated: August 31, 2026
Version: R0
Status: Production-Ready

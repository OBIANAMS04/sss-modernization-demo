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
| 429 | Too many wrong authentication codes |
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

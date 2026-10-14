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
| 401 | Unauthorized (invalid token/credentials) |
| 403 | Forbidden (cannot update another user) |
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

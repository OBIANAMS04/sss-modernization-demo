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

## MFA Endpoints (Stubbed - Phase 5)

### GET /api/mfa/setup
### POST /api/mfa/setup
### POST /api/mfa/verify

**Response (501):**
```json
{ "error": { "message": "MFA not yet available - coming in Phase 5", "code": "NOT_IMPLEMENTED" } }
```

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
| 409 | Conflict (duplicate email) |
| 500 | Server error |
| 501 | Not implemented (MFA) |

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

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
- `GET/POST /api/mfa/*` - MFA operations (stubbed)
- `GET /health` - Health check

**Middleware Stack:**
- CORS (restricted origins)
- JSON body parser
- JWT authentication (on protected routes)
- Request logging
- Error handler (centralized)

**Services Layer:**
- `authService.ts` - User registration & login
- `userService.ts` - Profile management
- `mfaService.ts` - MFA operations (Phase 5)

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

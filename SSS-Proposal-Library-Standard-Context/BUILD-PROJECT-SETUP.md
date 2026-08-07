# 🏗️ BUILD PHASE 1 — Project Setup & Foundation

**Status**: INITIALIZING  
**Timeline**: Days 1–3  
**Goal**: AWS GovCloud environment, CI/CD pipeline, React + Node.js boilerplate  
**Deliverable**: Ready for R0 (Walking Skeleton) development

---

## 📋 PHASE 1 CHECKLIST

### **Environment & Infrastructure**

#### 1.1 AWS GovCloud Account Setup
- [ ] AWS GovCloud region selected (us-gov-west-1)
- [ ] IAM roles configured:
  - [ ] Developer role (deployment, monitoring)
  - [ ] CI/CD role (automated deployments)
  - [ ] Database admin role (migrations, backups)
- [ ] Security groups configured:
  - [ ] ALB (Application Load Balancer) ingress on 443
  - [ ] EC2 egress to RDS (5432 for PostgreSQL)
  - [ ] Redis access (6379)
  - [ ] No public SSH (only through Systems Manager)

#### 1.2 Networking
- [ ] VPC created (10.0.0.0/16)
- [ ] Public subnets (3 AZs for ALB)
- [ ] Private subnets (3 AZs for app/DB)
- [ ] NAT Gateway for egress (private subnet → internet)
- [ ] Route 53 DNS: `sss-modernization-demo.colaberry.dev` → ALB

#### 1.3 Database & Cache
- [ ] **PostgreSQL 16** (Amazon RDS)
  - [ ] Multi-AZ (high availability)
  - [ ] Automatic backups (7-day retention)
  - [ ] Enhanced monitoring enabled
  - [ ] Schema created (basic tables: users, registrations, exemptions)
  
- [ ] **Redis 7** (Amazon ElastiCache)
  - [ ] Multi-AZ (high availability)
  - [ ] Automatic failover enabled
  - [ ] 1GB initial memory (scales as needed)

#### 1.4 Object Storage & Search
- [ ] **S3 bucket** (GovCloud region)
  - [ ] Versioning enabled
  - [ ] Encryption at rest (KMS)
  - [ ] Bucket policies (ALB write access only)
  
- [ ] **Elasticsearch 8** (optional for R1, noted for Phase 4)

#### 1.5 Monitoring & Logging
- [ ] **CloudWatch** configured:
  - [ ] Application logs → CloudWatch Logs
  - [ ] Metrics dashboard (CPU, memory, requests)
  - [ ] Alarms for errors/latency
  
- [ ] **X-Ray** for distributed tracing (optional)

---

### **CI/CD Pipeline**

#### 2.1 GitHub Repository Setup
- [ ] Repository created: `colaberry/sss-modernization-demo`
- [ ] Branch protection rules:
  - [ ] `main` requires PR reviews (1 approval)
  - [ ] `main` requires status checks (tests, lint)
  - [ ] Direct pushes to `main` disabled
  
- [ ] Secrets configured:
  - [ ] AWS_ACCESS_KEY_ID (CI/CD role)
  - [ ] AWS_SECRET_ACCESS_KEY (CI/CD role)
  - [ ] DOCKER_REGISTRY_PASSWORD (if using ECR)
  - [ ] DATABASE_URL (RDS connection string)

#### 2.2 GitHub Actions Workflow
- [ ] `.github/workflows/ci.yml` created:
  - [ ] **Test step**: `npm test` (Jest)
  - [ ] **Lint step**: `npm run lint` (ESLint)
  - [ ] **Build step**: `npm run build` (React + Node)
  - [ ] **Docker build**: Build image for AWS ECR
  
- [ ] `.github/workflows/deploy.yml` created:
  - [ ] Trigger: on merge to `main`
  - [ ] Push image to AWS ECR
  - [ ] Deploy to ECS (Elastic Container Service)
  - [ ] Run database migrations
  - [ ] Smoke tests post-deployment

#### 2.3 Infrastructure as Code
- [ ] **CloudFormation templates** or **Terraform**:
  - [ ] VPC, subnets, security groups
  - [ ] RDS instance definition
  - [ ] ElastiCache definition
  - [ ] ECS cluster definition
  - [ ] ALB/Target Group definition
  - [ ] Can be reprovisioned with `terraform apply`

---

### **Frontend Boilerplate (React)**

#### 3.1 Project Structure
```
sss-modernization-demo/
├── frontend/                          # React app
│   ├── public/
│   │   ├── index.html                 # Entry point
│   │   ├── favicon.ico                # SSS logo
│   │   └── manifest.json              # PWA metadata
│   ├── src/
│   │   ├── index.tsx                  # React root
│   │   ├── App.tsx                    # Main component
│   │   ├── components/
│   │   │   ├── Header.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── Navigation.tsx
│   │   │   └── [feature-components]
│   │   ├── pages/
│   │   │   ├── Registration.tsx       # STORY-001
│   │   │   ├── Profile.tsx            # STORY-002
│   │   │   ├── MFA.tsx                # STORY-003
│   │   │   ├── Dashboard.tsx
│   │   │   └── [admin-pages]
│   │   ├── services/
│   │   │   ├── api.ts                 # API client (axios)
│   │   │   ├── auth.ts                # Authentication logic
│   │   │   └── [feature-services]
│   │   ├── hooks/
│   │   │   ├── useAuth.ts             # Auth context hook
│   │   │   ├── useFetch.ts            # Data fetching hook
│   │   │   └── [custom-hooks]
│   │   ├── styles/
│   │   │   ├── index.css              # Global styles
│   │   │   ├── variables.css          # Design tokens
│   │   │   └── [component-styles]
│   │   ├── utils/
│   │   │   ├── validators.ts
│   │   │   ├── formatters.ts
│   │   │   └── [utility-functions]
│   │   └── types/
│   │       └── index.ts               # TypeScript types
│   ├── .eslintrc.json                 # Linting rules
│   ├── .prettierrc                    # Code formatting
│   ├── tsconfig.json                  # TypeScript config
│   ├── jest.config.js                 # Testing framework
│   ├── package.json                   # Dependencies
│   └── Dockerfile                     # Container image
├── backend/                           # Node.js/Express API
│   └── [see Backend section below]
├── docker-compose.yml                 # Local dev environment
├── terraform/                         # Infrastructure as Code
│   └── [see Terraform section below]
└── README.md                          # Project documentation
```

#### 3.2 React Setup
```bash
# Create React app
npx create-react-app sss-demo --template typescript

# Install core dependencies
npm install axios react-router-dom zustand
npm install -D tailwindcss postcss autoprefixer
npm install -D jest @testing-library/react @testing-library/jest-dom
npm install -D eslint prettier

# TypeScript config: tsconfig.json
# Strict mode enabled, JSX = React 17+
```

#### 3.3 Key Components (R0 Priority)
- [ ] `Layout.tsx` — Main layout with header/nav/footer
- [ ] `Registration.tsx` — User registration form (STORY-001)
- [ ] `Profile.tsx` — User profile form (STORY-002)
- [ ] `MFA.tsx` — MFA setup flow (STORY-003)
- [ ] `ProtectedRoute.tsx` — Auth guard for pages
- [ ] `LoadingSpinner.tsx` — Reusable loading UI
- [ ] `ErrorBoundary.tsx` — Error handling

#### 3.4 API Client
- [ ] `services/api.ts`:
  - [ ] Axios instance configured with base URL
  - [ ] Interceptors for auth tokens
  - [ ] Error handling & retry logic
  - [ ] Request/response logging

#### 3.5 State Management
- [ ] `hooks/useAuth.ts`:
  - [ ] Store: user, token, login state
  - [ ] Functions: login, logout, register
  - [ ] Persists to localStorage
  - [ ] Syncs across browser tabs (useEffect)

---

### **Backend Boilerplate (Node.js + Express)**

#### 4.1 Project Structure
```
backend/
├── src/
│   ├── index.ts                       # Entry point
│   ├── app.ts                         # Express app
│   ├── routes/
│   │   ├── auth.ts                    # POST /auth/register, /auth/login
│   │   ├── users.ts                   # GET/PUT /users/:id (STORY-001, 002)
│   │   ├── mfa.ts                     # POST /mfa/setup, /mfa/verify (STORY-003)
│   │   ├── health.ts                  # GET /health (smoke tests)
│   │   └── [feature-routes]
│   ├── controllers/
│   │   ├── authController.ts
│   │   ├── userController.ts
│   │   ├── mfaController.ts
│   │   └── [feature-controllers]
│   ├── middleware/
│   │   ├── auth.ts                    # JWT verification
│   │   ├── errorHandler.ts            # Global error handler
│   │   ├── logger.ts                  # Request logging
│   │   ├── rateLimiter.ts             # Rate limiting
│   │   └── [security-middleware]
│   ├── models/
│   │   ├── User.ts                    # User schema/model
│   │   ├── Registration.ts
│   │   ├── MFADevice.ts
│   │   └── [data-models]
│   ├── services/
│   │   ├── authService.ts             # Business logic
│   │   ├── userService.ts
│   │   ├── mfaService.ts              # TOTP generation
│   │   └── [feature-services]
│   ├── database/
│   │   ├── connection.ts              # PostgreSQL connection pool
│   │   ├── migrations/
│   │   │   ├── 001_init_users.sql
│   │   │   ├── 002_init_registrations.sql
│   │   │   └── [schema-migrations]
│   │   └── seeds/                     # Test data (optional)
│   ├── config/
│   │   ├── env.ts                     # Environment variables
│   │   ├── logger.ts                  # Winston/Pino setup
│   │   └── constants.ts
│   ├── utils/
│   │   ├── jwt.ts                     # JWT helpers
│   │   ├── validators.ts
│   │   ├── errors.ts                  # Custom error classes
│   │   └── [utility-functions]
│   └── types/
│       └── index.ts                   # TypeScript types
├── tests/
│   ├── auth.test.ts                   # API tests (Jest)
│   ├── user.test.ts
│   └── [feature-tests]
├── .env.example                       # Environment template
├── .env.local                         # Local secrets (git-ignored)
├── .eslintrc.json
├── .prettierrc
├── tsconfig.json
├── jest.config.js
├── package.json
├── Dockerfile
└── README.md
```

#### 4.2 Express Setup
```bash
# Create Node.js project
mkdir backend && cd backend
npm init -y

# Install core dependencies
npm install express cors dotenv pg bcrypt jsonwebtoken
npm install -D typescript ts-node @types/express @types/node
npm install -D jest @types/jest ts-jest
npm install -D eslint prettier

# TypeScript config: tsconfig.json
# Target: ES2020, Module: commonjs
```

#### 4.3 Key Routes (R0 Priority)
- [ ] `POST /auth/register` — Create user account (STORY-001)
  - Input: email, password, full name, SSN, DOB
  - Output: user object + JWT token
  - Validation: email format, password strength, SSN format
  - Hash password with bcrypt

- [ ] `POST /auth/login` — Authenticate user
  - Input: email, password
  - Output: JWT token + user object
  - Rate limit: 5 attempts/15 min per IP

- [ ] `GET /users/:id` — Get user profile (STORY-002)
  - Requires: JWT auth header
  - Output: user object with all fields

- [ ] `PUT /users/:id` — Update user profile (STORY-002)
  - Requires: JWT auth header
  - Input: email, phone, address (update fields)
  - Validation: updated SSN format, email uniqueness

- [ ] `POST /mfa/setup` — Initiate MFA setup (STORY-003)
  - Requires: JWT auth header
  - Output: QR code (base64 data URI), secret key
  - Uses: speakeasy library for TOTP

- [ ] `POST /mfa/verify` — Verify MFA code (STORY-003)
  - Requires: JWT auth header + TOTP code
  - Verifies code matches secret
  - Stores MFA device as "verified"

- [ ] `GET /health` — Health check (smoke tests)
  - Output: `{ status: "ok", timestamp, database: "connected" }`

#### 4.4 Database Migrations
```sql
-- 001_init_users.sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  ssn VARCHAR(11) NOT NULL, -- encrypted in production
  dob DATE NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 002_init_registrations.sql
CREATE TABLE registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'draft',
  classification VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 003_init_mfa_devices.sql
CREATE TABLE mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  device_name VARCHAR(255),
  secret_key VARCHAR(255) NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 4.5 Authentication Strategy
- [ ] JWT tokens (HS256)
  - Token payload: `{ sub: userId, email, iat, exp }`
  - TTL: 1 hour (access token)
  - Refresh token: 7 days (optional for R0)
  - Signed with: environment variable `JWT_SECRET`

- [ ] Password hashing: bcrypt (rounds: 12)

- [ ] Middleware: `auth.ts` verifies JWT in `Authorization: Bearer <token>` header

---

### **Docker & Local Development**

#### 5.1 Dockerfile (Frontend)
```dockerfile
# Build stage
FROM node:18-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Runtime stage
FROM node:18-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/build ./build
EXPOSE 3000
CMD ["serve", "-s", "build", "-l", "3000"]
```

#### 5.2 Dockerfile (Backend)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install
COPY backend/src ./src
COPY backend/tsconfig.json .
EXPOSE 3001
CMD ["npx", "ts-node", "src/index.ts"]
```

#### 5.3 docker-compose.yml (Local Development)
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: sss_demo
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgres://admin:dev_password@postgres:5432/sss_demo
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev_secret_key
      NODE_ENV: development
    depends_on:
      - postgres
      - redis
    volumes:
      - ./backend/src:/app/src

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      REACT_APP_API_URL: http://localhost:3001
    depends_on:
      - backend
    volumes:
      - ./frontend/src:/app/src
```

#### 5.4 Local Development Commands
```bash
# Start everything
docker-compose up -d

# Check logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Access psql
docker-compose exec postgres psql -U admin -d sss_demo

# Stop everything
docker-compose down
```

---

### **Testing & Quality**

#### 6.1 Frontend Tests (Jest + React Testing Library)
- [ ] `src/components/__tests__/Registration.test.tsx`
  - Test: form renders with all fields
  - Test: form submission calls API
  - Test: error message displays on API failure

- [ ] `src/hooks/__tests__/useAuth.test.ts`
  - Test: login stores token in localStorage
  - Test: logout clears token
  - Test: login/logout syncs across tabs

- [ ] Run: `npm test` (watch mode for development)

#### 6.2 Backend Tests (Jest + Supertest)
- [ ] `tests/auth.test.ts`
  - Test: POST /auth/register creates user
  - Test: POST /auth/login returns token for valid credentials
  - Test: POST /auth/login rejects invalid password

- [ ] `tests/user.test.ts`
  - Test: GET /users/:id returns user data
  - Test: GET /users/:id requires auth

- [ ] `tests/health.test.ts`
  - Test: GET /health returns 200 with "ok" status

- [ ] Run: `npm test` (watch mode)

#### 6.3 Linting & Formatting
- [ ] ESLint: `npm run lint`
- [ ] Prettier: `npm run format`
- [ ] Both run in CI/CD pipeline on every PR

---

### **Security (NIST 800-53 Baseline)**

#### 7.1 Infrastructure Layer (L5)
- [ ] VPC isolation (no public internet access for app/DB)
- [ ] Security groups: least-privilege ingress/egress
- [ ] RDS: encrypted at rest (KMS key)
- [ ] S3: encryption + versioning
- [ ] No hardcoded secrets (use AWS Secrets Manager)

#### 7.2 Application Layer
- [ ] HTTPS only (ALB termination)
- [ ] CORS configured (frontend domain only)
- [ ] Rate limiting on auth endpoints
- [ ] Password hashing (bcrypt 12 rounds)
- [ ] JWT signing with strong secret
- [ ] Input validation on all routes
- [ ] SQL injection prevention (parameterized queries via pg)

#### 7.3 Logging & Monitoring
- [ ] All requests logged (timestamp, user_id, endpoint, status)
- [ ] All authentication events logged
- [ ] CloudWatch alarms on errors/latency
- [ ] No PII in logs (SSN/password masked)

---

## 🚀 PHASE 1 DELIVERABLES

By end of Phase 1 (Day 3):

✅ **Infrastructure**
- AWS GovCloud account configured
- VPC, subnets, security groups in place
- PostgreSQL 16 + Redis 7 running
- ALB configured, DNS pointing to demo URL

✅ **CI/CD**
- GitHub repository set up
- GitHub Actions workflow for test/build/deploy
- ECR image repository
- ECS cluster ready for deployment

✅ **Frontend Boilerplate**
- React TypeScript project
- Basic routing (registration, profile, MFA pages)
- API client configured
- Authentication context/hooks
- Tests running locally

✅ **Backend Boilerplate**
- Express API with TypeScript
- Database migrations (users, registrations, MFA tables)
- Core routes: /auth/register, /auth/login, /users/:id, /mfa/*
- Authentication middleware (JWT)
- Tests running locally

✅ **Local Development**
- docker-compose.yml enables local dev
- npm run dev / docker-compose up starts everything
- Seed data available for testing

---

## 📊 PHASE 1 SUCCESS CRITERIA

- [ ] Backend runs locally: `npm run dev` starts on port 3001
- [ ] Frontend runs locally: `npm run dev` starts on port 3000
- [ ] PostgreSQL is initialized with all migration tables
- [ ] User can register via POST /auth/register
- [ ] User can login via POST /auth/login (gets JWT)
- [ ] GET /users/:id works with JWT auth
- [ ] MFA setup/verify endpoints respond (not fully functional yet)
- [ ] Health check returns 200
- [ ] All tests pass: `npm test`
- [ ] No console errors/warnings
- [ ] CI/CD pipeline runs on PR

---

## ✅ READY FOR R0 DEVELOPMENT

Once Phase 1 is complete, Phase 2 (Days 4–7, R0 Walking Skeleton) can begin:
- User registration flow (STORY-001) — end-to-end
- User profile management (STORY-002) — end-to-end
- MFA setup/verification (STORY-003) — end-to-end
- Real-time data pipeline (STORY-004–005) — foundation

**Demo URL live by Day 7**: https://sss-modernization-demo.colaberry.dev

---

**Phase 1 is READY TO EXECUTE. Awaiting Ram's go-ahead in BUILD-WORKSTREAM-PLAN.md approval.**


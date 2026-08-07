# 🚀 BUILD WORKSTREAM — All 46 Stories Detailed Breakdown

**Status**: Ready to Execute (Phases 1-5)  
**Timeline**: 30 days across 4 releases (R0 → R1 → R2 → R3)  
**Owner**: Obi (Lead Developer)  
**Dependencies**: Awaiting Ram's Phase 1 approval for AWS provisioning

---

## 📋 STORY TEMPLATE

Each story follows this format:
```
## STORY-XXX: [Story Title]

**Release**: R0/R1/R2/R3  
**Timeline**: Days X-Y  
**Owner**: Obi  
**Status**: 🚩 TO START

### User Story
[As a [user], I want to [action], so that [benefit]]

### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

### Technical Requirements
- Tech stack requirements
- Database schema changes
- API endpoints
- Frontend components

### Dependencies
- What must be complete before this story

### Implementation Tasks
1. Backend: [specific tasks]
2. Frontend: [specific tasks]
3. Testing: [specific tasks]
4. Deployment: [specific tasks]

### Estimated Effort
X hours (frontend + backend + testing)

---
```

---

# 🎯 R0 — WALKING SKELETON (CRITICAL PATH)

**Timeline**: Days 4–7  
**Goal**: User registration, MFA, real-time data pipeline → Demo URL LIVE  
**Blocker for**: Technical Volume (Task 5), Task 10 gate, Task 11 submission

---

## STORY-001: User Account Creation & Registration

**Release**: R0  
**Timeline**: Days 4–5  
**Owner**: Obi  
**Status**: 🚩 TO START

### User Story
As a **citizen**, I want to **create an account with email, password, SSN, and DOB**, so that **I can access the SSS system and apply for exemptions**.

### Acceptance Criteria
- [ ] Registration form renders on `/register` with all required fields (email, password, confirm password, full name, SSN, DOB)
- [ ] Frontend validates: email format, password strength (min 12 chars, 1 upper, 1 digit, 1 special), SSN format (XXX-XX-XXXX), DOB not in future
- [ ] Form submission calls `POST /auth/register`
- [ ] Backend creates user in `users` table with hashed password (bcrypt)
- [ ] Backend returns JWT token + user object
- [ ] Frontend stores JWT in localStorage
- [ ] User is logged in after registration (can access protected routes)
- [ ] Duplicate email returns 409 Conflict
- [ ] All requests logged (timestamp, email, IP, success/failure)

### Technical Requirements

**Frontend** (`frontend/src/pages/Registration.tsx`):
- Form component with fields: email, password, confirmPassword, fullName, ssn, dob
- Real-time validation feedback
- Submit button disabled until all fields valid
- Success: redirect to `/profile`
- Error: display error message from API

**Backend** (`backend/src/routes/auth.ts`):
```
POST /auth/register
Input: {
  email: string,
  password: string,
  fullName: string,
  ssn: string (XXX-XX-XXXX format),
  dob: string (YYYY-MM-DD)
}
Output: {
  user: { id, email, fullName },
  token: string (JWT)
}
Error: 409 if email exists, 400 if validation fails
```

**Database**:
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  ssn VARCHAR(11) NOT NULL, -- encrypted at rest in prod
  dob DATE NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Security**:
- Password hashed with bcrypt (12 rounds)
- Rate limiting: 10 registrations per IP per hour
- Input validation: email, SSN, DOB, password strength
- Log: registration attempt, success/failure, email, IP

### Dependencies
- Docker Compose running (PostgreSQL, Redis)
- Backend boilerplate (Express, routes structure)
- Frontend boilerplate (React, routing)

### Implementation Tasks

**Backend** (3 hours):
1. Create `POST /auth/register` route
2. Implement password hashing (bcrypt)
3. Validate input (email format, SSN, DOB, password strength)
4. Check for duplicate email
5. Insert into users table
6. Generate JWT token
7. Log registration event
8. Write tests: valid registration, duplicate email, validation failures

**Frontend** (2 hours):
1. Create Registration page component
2. Build form with validation
3. Call `POST /auth/register`
4. Handle success/error responses
5. Store JWT in localStorage
6. Redirect to profile on success
7. Write tests: form renders, validation works, API call on submit

**Testing** (1 hour):
1. Backend tests: POST /auth/register with valid/invalid data
2. Frontend tests: form renders, validation, submission

### Estimated Effort
**6 hours** (backend 3h + frontend 2h + testing 1h)

---

## STORY-002: User Profile Update & Compliance Check

**Release**: R0  
**Timeline**: Days 5–6  
**Owner**: Obi  
**Status**: 🚩 TO START

### User Story
As a **citizen**, I want to **update my profile (phone, address, etc.)**, so that **my account information is current for the exemption process**.

### Acceptance Criteria
- [ ] Profile page renders at `/profile` with all user fields (email, fullName, ssn, dob, phone, address)
- [ ] Only authenticated users can access (JWT required)
- [ ] User can edit phone, address fields
- [ ] Email, SSN, DOB are read-only (cannot change)
- [ ] Form validation on all fields
- [ ] Submit calls `PUT /users/:id`
- [ ] Backend updates users table
- [ ] Backend runs compliance check (checks against exemption eligibility rules)
- [ ] Compliance status displayed: "Eligible" / "Ineligible" / "Pending Review"
- [ ] All updates logged with user_id, timestamp, changed fields

### Technical Requirements

**Frontend** (`frontend/src/pages/Profile.tsx`):
- Display user info from JWT + API
- Editable fields: phone, address
- Read-only fields: email, ssn, dob, fullName
- Show compliance status badge
- Save button calls PUT /users/:id
- Validation: phone (E.164 format), address (required, max 500 chars)

**Backend** (`backend/src/routes/users.ts`):
```
GET /users/:id
Requires: JWT auth
Output: { id, email, fullName, ssn, dob, phone, address, mfaEnabled, complianceStatus }

PUT /users/:id
Requires: JWT auth
Input: { phone?: string, address?: string }
Output: { id, email, fullName, phone, address, complianceStatus }
```

**Compliance Check Logic**:
```javascript
function checkCompliance(user) {
  // Rules (simplified for R0):
  // 1. User must be >= 18 years old
  // 2. User must have valid SSN format
  // 3. User must have phone on file
  // 4. User must have address on file
  
  const age = calculateAge(user.dob);
  const status = (age >= 18 && user.phone && user.address) 
    ? 'Eligible' 
    : 'Ineligible';
  
  return status;
}
```

**Database**:
```sql
ALTER TABLE users ADD COLUMN compliance_status VARCHAR(50) DEFAULT 'Pending Review';
ALTER TABLE users ADD COLUMN compliance_checked_at TIMESTAMP;
```

### Dependencies
- STORY-001 complete (user exists, JWT works)
- Authentication middleware in place

### Implementation Tasks

**Backend** (3 hours):
1. Create `GET /users/:id` endpoint (return user data)
2. Create `PUT /users/:id` endpoint (update phone, address)
3. Implement compliance check function
4. Update users table with compliance_status
5. Validate input (phone E.164, address length)
6. Log all updates
7. Write tests: GET with/without auth, PUT with valid/invalid data, compliance check logic

**Frontend** (2 hours):
1. Create Profile page component
2. Fetch user data on load (GET /users/:id)
3. Display fields (read-only + editable)
4. Show compliance status
5. Handle save (PUT /users/:id)
6. Write tests: page renders, data loads, form updates

**Testing** (1 hour):
1. Backend: GET/PUT endpoints with auth/without auth
2. Frontend: form renders, validation, API calls

### Estimated Effort
**6 hours** (backend 3h + frontend 2h + testing 1h)

---

## STORY-003: Multi-Factor Authentication Setup

**Release**: R0  
**Timeline**: Days 6–7  
**Owner**: Obi  
**Status**: 🚩 TO START

### User Story
As a **citizen**, I want to **set up multi-factor authentication (MFA) using an authenticator app**, so that **my account is protected against unauthorized access**.

### Acceptance Criteria
- [ ] MFA setup page accessible at `/mfa` (requires auth)
- [ ] User sees QR code for their authenticator app (TOTP-based)
- [ ] User can scan QR code with Google Authenticator / Authy / Microsoft Authenticator
- [ ] User enters 6-digit TOTP code to verify
- [ ] Backend validates TOTP code matches secret
- [ ] MFA device stored in `mfa_devices` table as "verified"
- [ ] `mfa_enabled` flag set to true in users table
- [ ] Login flow updated: after password verification, prompt for TOTP code if MFA enabled
- [ ] User can verify TOTP code at `/mfa/verify`
- [ ] All MFA events logged (setup, verification, failure)

### Technical Requirements

**Frontend** (`frontend/src/pages/MFA.tsx`):
- Button to "Setup MFA"
- Display QR code (as data URI image)
- Input field for 6-digit TOTP code
- Submit calls POST /mfa/verify
- Success: redirect to profile
- Error: display error, allow retry

**Backend** (`backend/src/routes/mfa.ts`):
```
POST /mfa/setup
Requires: JWT auth
Output: {
  secret: string (base32 encoded),
  qrCode: string (data URI image)
}

POST /mfa/verify
Requires: JWT auth
Input: { totpCode: string (6 digits) }
Output: { success: true, message: "MFA enabled" }
Error: 400 if code invalid, 401 if auth fails
```

**Dependencies**:
- Use `speakeasy` library for TOTP generation
- Use `qrcode` library for QR code generation

**Database**:
```sql
CREATE TABLE mfa_devices (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  device_name VARCHAR(255) DEFAULT 'Primary Device',
  secret_key VARCHAR(255) NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT FALSE;
```

**Login Flow Update**:
```
1. User enters email/password
2. Backend validates password
3. If mfa_enabled = true:
   - Return { requiresMfa: true, tempToken: <short-lived token> }
   - Frontend shows TOTP input screen
   - User enters TOTP code
   - Frontend calls POST /auth/login/mfa with tempToken + totpCode
   - Backend validates TOTP code
   - Backend returns JWT token
4. If mfa_enabled = false:
   - Return JWT token directly
```

### Dependencies
- STORY-001 complete (user registration)
- STORY-002 complete (profile page)
- Authentication middleware

### Implementation Tasks

**Backend** (4 hours):
1. Install speakeasy + qrcode libraries
2. Create POST /mfa/setup endpoint (generate secret + QR code)
3. Create POST /mfa/verify endpoint (validate TOTP code)
4. Create POST /auth/login/mfa endpoint (handle MFA verification during login)
5. Update login flow to check mfa_enabled
6. Update users table: add mfa_enabled flag
7. Create mfa_devices table schema + migrations
8. Log all MFA events
9. Write tests: setup, verify with valid/invalid codes, login with MFA

**Frontend** (3 hours):
1. Create MFA page component
2. Fetch QR code from POST /mfa/setup
3. Display QR code image
4. TOTP code input (6-digit, auto-focus)
5. Submit to POST /mfa/verify
6. Handle success/error
7. Update login flow: if requiresMfa=true, show TOTP screen instead of redirecting
8. Write tests: page renders, QR code displays, verification works

**Testing** (1.5 hours):
1. Backend: TOTP generation, verification, code validation, time window tolerance
2. Frontend: form renders, QR code displays, code submission
3. Integration: full login flow with MFA

### Estimated Effort
**8.5 hours** (backend 4h + frontend 3h + testing 1.5h)

---

## STORY-004: Cloud Infrastructure & Security Controls (L5)

**Release**: R0  
**Timeline**: Days 4–7  
**Owner**: Obi (infrastructure as code)  
**Status**: 🚩 BLOCKED ON RAM APPROVAL  

### User Story
As a **system operator**, I want to **deploy application to AWS GovCloud with NIST 800-53 baseline controls**, so that **the system meets FedRAMP security requirements**.

### Acceptance Criteria
- [ ] AWS GovCloud VPC created (10.0.0.0/16)
- [ ] Public subnets (3 AZs for ALB)
- [ ] Private subnets (3 AZs for app/DB)
- [ ] Security groups: ALB (443), EC2 (egress to RDS 5432), Redis (6379)
- [ ] ALB configured with HTTPS (TLS 1.2+)
- [ ] RDS PostgreSQL 16 (multi-AZ, encrypted at rest with KMS)
- [ ] ElastiCache Redis 7 (multi-AZ, encrypted at rest)
- [ ] ECS cluster running Node.js backend container
- [ ] ECS service running React frontend container
- [ ] Route 53 DNS: sss-modernization-demo.colaberry.dev → ALB
- [ ] CloudWatch logging: all application logs captured
- [ ] CloudWatch alarms: CPU > 80%, error rate > 1%, latency p95 > 2s
- [ ] No public SSH access (Systems Manager Session Manager only)
- [ ] Secrets Manager: JWT_SECRET, DATABASE_URL, REDIS_URL
- [ ] ECR image repositories created (frontend, backend)
- [ ] Health check passes: GET /health returns 200 with "ok" status

### Technical Requirements

**Infrastructure as Code** (Terraform or CloudFormation):
```
aws/
├── vpc.tf                    # VPC, subnets, security groups
├── rds.tf                    # PostgreSQL RDS
├── elasticache.tf            # Redis cache
├── alb.tf                    # Application Load Balancer
├── ecs.tf                    # ECS cluster, services
├── route53.tf                # DNS
├── cloudwatch.tf             # Logging, alarms
├── iam.tf                    # IAM roles, policies
└── outputs.tf                # Output DNS name, endpoints
```

**Security Controls** (NIST 800-53):
- AC-2: Account Management (IAM roles)
- AC-3: Access Control (security groups, least-privilege)
- AC-6: Least Privilege (no public SSH)
- SC-7: Boundary Protection (VPC, security groups)
- SC-8: Transmission Confidentiality (HTTPS, TLS 1.2+)
- SI-4: Information System Monitoring (CloudWatch)

**Deployment Process**:
```bash
# Phase 1 (one-time setup):
terraform init
terraform plan
terraform apply

# CI/CD pipeline (GitHub Actions):
1. Test: npm test
2. Lint: npm run lint
3. Build: npm run build
4. Docker build: build image for ECR
5. Push to ECR
6. Deploy to ECS: update service, run migrations
7. Smoke tests: GET /health, basic API tests
```

### Dependencies
- Ram approval to proceed with AWS setup
- GitHub Actions configured with AWS credentials
- Terraform state file (S3 backend)

### Implementation Tasks

**Infrastructure** (8 hours):
1. Create AWS GovCloud account + IAM setup
2. Write Terraform: VPC, subnets, security groups
3. Write Terraform: RDS PostgreSQL (multi-AZ, encrypted)
4. Write Terraform: ElastiCache Redis (multi-AZ)
5. Write Terraform: ALB, target groups, HTTPS listener
6. Write Terraform: ECS cluster, services (backend + frontend)
7. Write Terraform: Route 53 DNS + CloudWatch
8. Configure AWS Secrets Manager for secrets
9. Test infrastructure deployment (dry-run)

**CI/CD** (3 hours):
1. Set up GitHub Actions workflow (test/lint/build)
2. Configure AWS credentials in GitHub Secrets
3. Create ECR repositories
4. Write Deploy workflow (Docker build, push to ECR, update ECS)
5. Test CI/CD pipeline on dummy PR

**Monitoring** (2 hours):
1. Set up CloudWatch log groups
2. Create CloudWatch alarms (CPU, error rate, latency)
3. Configure log retention (7 days for dev)
4. Set up SNS topics for alarm notifications

### Estimated Effort
**13 hours** (infrastructure 8h + CI/CD 3h + monitoring 2h)

**Note**: This story is blocked on Ram's approval. Terraform code can be written + reviewed now. Once approved, infrastructure can be provisioned in ~30 min.

---

## STORY-005: Real-Time Data Pipeline Setup (L2)

**Release**: R0  
**Timeline**: Days 6–7  
**Owner**: Obi  
**Status**: 🚩 TO START

### User Story
As a **system operator**, I want to **set up a real-time data pipeline that updates exemption data < 30 seconds**, so that **dashboards show current eligibility status**.

### Acceptance Criteria
- [ ] Real-time data source connected (polling Redis cache)
- [ ] Data freshness monitored: timestamps checked on every read
- [ ] Data refresh triggered on: user profile update, exemption status change, admin override
- [ ] Pipeline latency measured: data change to UI update < 30 seconds
- [ ] Redis cache updated on data changes
- [ ] Database change event logged with timestamp
- [ ] API endpoint: GET /data/pipeline-status returns { lastRefresh, dataAge, freshness }
- [ ] Dashboard shows data freshness indicator (green < 10s, yellow 10-20s, red > 20s)
- [ ] Metrics logged: pipeline latency, cache hit rate, data freshness

### Technical Requirements

**Backend** (`backend/src/services/dataPipeline.ts`):
```
Architecture:
1. User updates profile (PUT /users/:id)
2. Backend updates database
3. Backend invalidates Redis cache
4. Backend publishes event to Redis pubsub (optional: RabbitMQ for later)
5. Frontend polls GET /data/pipeline-status
6. Frontend updates UI if data changed

Redis Cache Strategy:
- Key: user:{userId}:eligibility
- TTL: 5 minutes (auto-refresh)
- On update: invalidate key, trigger refresh
- Cache hit rate target: > 80%
```

**Frontend** (`frontend/src/hooks/useRealTimeData.ts`):
```javascript
// Custom hook for real-time data updates
function useRealTimeData(userId, pollInterval = 5000) {
  const [data, setData] = useState(null);
  const [freshness, setFreshness] = useState(null);
  
  useEffect(() => {
    const poll = setInterval(async () => {
      const response = await api.get(`/data/pipeline-status?userId=${userId}`);
      const age = Date.now() - response.lastRefresh;
      setFreshness(age);
      setData(response);
    }, pollInterval);
    
    return () => clearInterval(poll);
  }, [userId]);
  
  return { data, freshness };
}
```

**API Endpoint**:
```
GET /data/pipeline-status
Query params: userId (optional)
Output: {
  lastRefresh: timestamp (ISO 8601),
  dataAge: number (milliseconds),
  freshness: 'fresh' | 'stale' | 'very_stale',
  cachedAt: timestamp
}
```

**Metrics Logging**:
```sql
CREATE TABLE pipeline_metrics (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  event_type VARCHAR(50), -- 'update', 'refresh', 'cache_hit', 'cache_miss'
  latency_ms INTEGER,
  data_age_ms INTEGER,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

### Dependencies
- STORY-001, STORY-002 complete (users, profile updates)
- Redis running
- Basic API routes established

### Implementation Tasks

**Backend** (3 hours):
1. Create data pipeline service
2. Implement Redis caching strategy
3. Create GET /data/pipeline-status endpoint
4. Log pipeline events (updates, refreshes, cache hits/misses)
5. Calculate data freshness metrics
6. Write tests: cache invalidation, data freshness calculation, endpoint response

**Frontend** (2 hours):
1. Create useRealTimeData hook
2. Implement polling logic (5-second interval)
3. Display freshness indicator (color badge)
4. Handle stale data (show warning)
5. Write tests: hook renders, polling updates, freshness display

**Monitoring** (1 hour):
1. Add metrics logging to backend
2. Create CloudWatch dashboard for pipeline freshness
3. Alert if data age > 30 seconds

### Estimated Effort
**6 hours** (backend 3h + frontend 2h + monitoring 1h)

---

## ✅ R0 SUMMARY

| Story | Title | Effort | Timeline | Status |
|-------|-------|--------|----------|--------|
| STORY-001 | User Registration | 6h | Days 4–5 | 🚩 TO START |
| STORY-002 | Profile Update & Compliance | 6h | Days 5–6 | 🚩 TO START |
| STORY-003 | MFA Setup | 8.5h | Days 6–7 | 🚩 TO START |
| STORY-004 | Cloud Infrastructure & L5 | 13h | Days 4–7 | 🚩 BLOCKED ON RAM |
| STORY-005 | Real-Time Data Pipeline | 6h | Days 6–7 | 🚩 TO START |

**Total R0 Effort**: 39.5 hours  
**R0 Delivery**: Demo URL LIVE by Day 7  
**R0 Blocker**: Story-004 (AWS) blocked on Ram approval

---

# 🎯 R1 — CORE BUILD

**Timeline**: Days 8–14  
**Dependencies**: R0 complete (infrastructure live, basic flows working)  
**Goal**: Exemption logic, case management, compliance validation, dashboards

---

## STORY-006: Exemption Eligibility Determination

**Release**: R1  
**Timeline**: Days 8–9  
**Owner**: Obi  
**Status**: ⏳ BLOCKED ON R0

### User Story
As a **citizen**, I want to **check if I'm eligible for an exemption**, so that **I know whether to apply**.

### Acceptance Criteria
- [ ] Exemption eligibility rules defined (age, residency, income, etc.)
- [ ] Eligibility check runs after profile update
- [ ] Results show: "Eligible for Exemptions: [List]" or "Not Eligible"
- [ ] User can see detailed reason for ineligibility
- [ ] Eligibility persisted in database
- [ ] Exemption types supported: Type A (age-based), Type B (income-based), Type C (hardship)
- [ ] All eligibility checks logged with reasoning

### Technical Requirements

**Eligibility Rules** (business logic):
```javascript
function checkExemptionEligibility(user) {
  const eligibilities = [];
  
  // Type A: Age-based (>= 65)
  if (calculateAge(user.dob) >= 65) {
    eligibilities.push('Type A - Senior Exemption');
  }
  
  // Type B: Income-based (< federal poverty threshold)
  if (user.income < POVERTY_THRESHOLD) {
    eligibilities.push('Type B - Income-Based Exemption');
  }
  
  // Type C: Hardship (manual review)
  if (user.hasDocumentedHardship) {
    eligibilities.push('Type C - Hardship Exemption (Pending Review)');
  }
  
  return {
    eligible: eligibilities.length > 0,
    exemptions: eligibilities,
    determinedAt: now()
  };
}
```

**Database Schema**:
```sql
CREATE TABLE exemptions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  exemption_type VARCHAR(50), -- 'Type A', 'Type B', 'Type C'
  status VARCHAR(50) DEFAULT 'Eligible', -- 'Eligible', 'Pending Review', 'Denied'
  determined_at TIMESTAMP,
  determined_by VARCHAR(100), -- 'system' or user_id
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Implementation Tasks

**Backend** (4 hours):
1. Define exemption eligibility rules
2. Create exemption service with eligibility check function
3. Update user profile endpoint to trigger eligibility check
4. Create POST /exemptions endpoint (trigger check manually)
5. Create GET /exemptions (retrieve user's exemptions)
6. Log all eligibility checks
7. Write tests: eligibility rules, edge cases, logging

**Frontend** (2 hours):
1. Display exemption eligibility on profile page
2. Show "Eligible for" or "Not Eligible" status
3. Button to "Check Eligibility" (manual trigger)
4. Display exemption list with reasoning
5. Write tests: eligibility display, manual trigger

### Estimated Effort
**6 hours** (backend 4h + frontend 2h)

---

## STORY-007: Case Management Workflow

**Release**: R1  
**Timeline**: Days 9–10  
**Owner**: Obi  
**Status**: ⏳ BLOCKED ON R0

### User Story
As a **case manager** (admin), I want to **track exemption applications as cases**, so that **I can manage the review and approval process**.

### Acceptance Criteria
- [ ] Case created when user submits exemption application
- [ ] Case has status: "Draft", "Submitted", "In Review", "Approved", "Denied", "Appealed"
- [ ] Case manager can assign notes and documents
- [ ] Case manager can change status
- [ ] Case timeline shows all status changes
- [ ] Notifications sent to user on status change
- [ ] Admin dashboard shows all open cases
- [ ] Filter by: status, user, exemption type, assigned case manager
- [ ] Export cases to CSV (for reporting)

### Technical Requirements

**Database Schema**:
```sql
CREATE TABLE cases (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  exemption_id UUID REFERENCES exemptions(id),
  status VARCHAR(50) DEFAULT 'Draft',
  assigned_to VARCHAR(100), -- case manager user_id
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  submitted_at TIMESTAMP,
  approved_at TIMESTAMP
);

CREATE TABLE case_notes (
  id UUID PRIMARY KEY,
  case_id UUID REFERENCES cases(id),
  note_by VARCHAR(100), -- case manager
  content TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE case_documents (
  id UUID PRIMARY KEY,
  case_id UUID REFERENCES cases(id),
  document_type VARCHAR(50), -- 'proof_of_age', 'income_statement', etc.
  document_url VARCHAR(500),
  uploaded_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);
```

**API Endpoints**:
```
POST /cases
Input: { exemptionId, ... }
Output: { id, status: 'Draft', ... }

GET /cases
Query: status, assignedTo, userId, page, limit
Output: { cases: [...], total, page }

PUT /cases/:id
Input: { status, assignedTo, notes }
Output: { id, status, ... }

POST /cases/:id/notes
Input: { content }
Output: { id, note, ... }

POST /cases/:id/documents
Input: { file, documentType }
Output: { id, documentUrl, ... }
```

### Implementation Tasks

**Backend** (5 hours):
1. Create cases table + schema
2. Create cases service (CRUD + status transitions)
3. Create API endpoints (GET/POST/PUT cases)
4. Implement case notes feature
5. Implement document upload (S3)
6. Log all case changes
7. Write tests: case creation, status changes, notes, documents

**Frontend** (4 hours):
1. Create admin dashboard (case list)
2. Create case detail page
3. Case status selector + update
4. Add notes interface
5. Document upload form
6. Filter/search by status, user, type
7. Write tests: dashboard renders, case updates, notes

### Estimated Effort
**9 hours** (backend 5h + frontend 4h)

---

## STORY-008: Compliance Matrix Validation (L3)

**Release**: R1  
**Timeline**: Days 10–11  
**Owner**: Obi  
**Status**: ⏳ BLOCKED ON R0

### User Story
As a **compliance officer**, I want to **validate that all system decisions comply with legal requirements**, so that **every exemption decision is auditable**.

### Acceptance Criteria
- [ ] Compliance matrix defined (requirement → control mapping)
- [ ] Every exemption decision logged with: requirement met, evidence, auditor trail
- [ ] Compliance dashboard shows: total decisions, compliance rate, failed controls
- [ ] Alerts if compliance rate drops below 99%
- [ ] Audit log queryable by: date range, user, decision type, requirement
- [ ] All compliance checks logged with timestamp + operator
- [ ] Non-compliance triggers manual review workflow

### Technical Requirements

**Compliance Matrix** (from Proposal Task 3):
```
Requirement                    → Control                    → Evidence
FAR 52.209-2 (Integrity)      → Audit logging 100%         → case_decisions table
FAR 52.210-1 (Default risk)   → Credit check on file       → case_documents table
FAR 52.212-1 (Flow-downs)    → Exemption rules enforced    → exemptions table
```

**Database**:
```sql
CREATE TABLE compliance_checks (
  id UUID PRIMARY KEY,
  requirement_id VARCHAR(100), -- FAR code
  decision_id UUID REFERENCES cases(id),
  control_name VARCHAR(255),
  passed BOOLEAN,
  evidence TEXT,
  checked_by VARCHAR(100),
  checked_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE compliance_dashboard (
  id UUID PRIMARY KEY,
  date DATE,
  total_decisions INTEGER,
  compliant_decisions INTEGER,
  compliance_rate DECIMAL,
  alerts TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Implementation Tasks

**Backend** (4 hours):
1. Define compliance matrix (requirement → control mappings)
2. Create compliance check service
3. Integrate compliance checks into case decision workflow
4. Create compliance dashboard API
5. Log all compliance checks
6. Write tests: compliance logic, edge cases

**Frontend** (2 hours):
1. Create compliance dashboard (rate, trends, alerts)
2. Compliance audit log page (queryable by date, user, requirement)
3. Alert display (non-compliance)
4. Write tests: dashboard renders, filtering works

### Estimated Effort
**6 hours** (backend 4h + frontend 2h)

---

## STORY-009: Data Freshness Monitoring (<30s)

**Release**: R1  
**Timeline**: Days 11–12  
**Owner**: Obi  
**Status**: ⏳ BLOCKED ON R0

### User Story
As a **system operator**, I want to **monitor that all data updates complete within 30 seconds**, so that **dashboards show current information**.

### Acceptance Criteria
- [ ] Data freshness measured for: user profiles, exemptions, case status, eligibility
- [ ] Latency tracked: database write → cache update → API response < 30s
- [ ] CloudWatch metrics: average latency, p50, p95, p99
- [ ] Dashboard shows freshness indicator per data type
- [ ] Alert if p95 latency > 30 seconds
- [ ] Analyze slowdowns: query performance, cache miss rate, network latency
- [ ] Target SLO: 95% of updates < 30s

### Technical Requirements

**Metrics Logging**:
```javascript
// In every critical update:
const startTime = Date.now();
// ... do update ...
const latency = Date.now() - startTime;
logger.info('data_update', { entity: 'users', latency, userId: x, timestamp: now() });
```

**Database**:
```sql
CREATE TABLE latency_metrics (
  id UUID PRIMARY KEY,
  entity_type VARCHAR(50), -- 'users', 'exemptions', 'cases'
  operation VARCHAR(50), -- 'create', 'update', 'delete'
  latency_ms INTEGER,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

**CloudWatch Dashboard**:
- Chart 1: Average latency over time
- Chart 2: p50, p95, p99 latencies
- Chart 3: Freshness rate (% < 30s)
- Chart 4: Cache hit rate
- Alert: p95 > 30s

### Implementation Tasks

**Backend** (3 hours):
1. Add latency logging to all critical updates
2. Create /metrics/latency endpoint (query by entity type, date range)
3. Create latency aggregation job (runs every 5 min)
4. Set up CloudWatch metrics + alarms
5. Write tests: latency logging, metrics calculation

**Monitoring** (2 hours):
1. Create CloudWatch dashboard for latency
2. Set up alarm for p95 > 30s
3. Configure SNS notifications

### Estimated Effort
**5 hours** (backend 3h + monitoring 2h)

---

## STORY-010: Security Audit Logging 100%

**Release**: R1  
**Timeline**: Days 12–13  
**Owner**: Obi  
**Status**: ⏳ BLOCKED ON R0

### User Story
As a **security officer**, I want to **audit 100% of security-relevant events**, so that **every action is traceable**.

### Acceptance Criteria
- [ ] All authentication events logged: login, logout, failed login, MFA setup, password change
- [ ] All authorization events logged: access denied, role change, permission grant
- [ ] All data access logged: read exemption data, read user data, export reports
- [ ] All admin actions logged: case status change, override, note added, document uploaded
- [ ] All infrastructure events logged: deployment, configuration change, alert triggered
- [ ] Audit logs immutable (write-once, cannot modify or delete)
- [ ] Audit logs queryable: by user, action, timestamp, resource
- [ ] Retention: 7 years (compliance requirement)
- [ ] No audit logs contain PII (SSN, password redacted)

### Technical Requirements

**Audit Logger Service**:
```javascript
logger.audit({
  action: 'USER_LOGIN',
  actor: userId,
  resource: 'auth',
  status: 'success' | 'failure',
  details: { ip, userAgent, mfaUsed },
  timestamp: now()
});
```

**Database** (Write-Once):
```sql
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action VARCHAR(50) NOT NULL,
  actor UUID REFERENCES users(id),
  resource VARCHAR(50),
  status VARCHAR(20),
  details JSONB,
  ip_address INET,
  timestamp TIMESTAMP DEFAULT NOW(),
  -- Immutable: no UPDATE allowed
  CONSTRAINT audit_logs_immutable CHECK (true)
);

-- Separate read-only view for querying
CREATE VIEW audit_logs_readonly AS SELECT * FROM audit_logs;
```

### Implementation Tasks

**Backend** (4 hours):
1. Create audit logger service
2. Add audit logging to: auth endpoints, user updates, case changes, admin actions
3. Create GET /audit endpoint (for admins)
4. Ensure logs contain no PII
5. Set up S3 archival for long-term retention
6. Write tests: logging on all critical paths, immutability

**Monitoring** (1 hour):
1. Set up CloudWatch logging for audit logs
2. Create audit log dashboard

### Estimated Effort
**5 hours** (backend 4h + monitoring 1h)

---

## STORY-011: Accessibility Testing (Section 508)

**Release**: R1  
**Timeline**: Days 13–14  
**Owner**: Obi  
**Status**: ⏳ BLOCKED ON R0

### User Story
As a **user with disabilities**, I want to **use the system with assistive technologies**, so that **I have equal access to exemption services**.

### Acceptance Criteria
- [ ] WCAG 2.1 Level AA conformance
- [ ] Keyboard navigation: all features accessible via keyboard
- [ ] Screen reader: all content readable by JAWS, NVDA, VoiceOver
- [ ] Color contrast: 4.5:1 for normal text, 3:1 for large text
- [ ] Alt text: all images have meaningful alt text
- [ ] Form labels: all inputs properly labeled
- [ ] Error messages: clear, associated with form fields
- [ ] Focus management: visible focus indicator on all interactive elements
- [ ] Page structure: semantic HTML (headings, landmarks, lists)
- [ ] Automated testing: axe-core + manual audit

### Technical Requirements

**Frontend Testing**:
```javascript
// Automated testing (axe-core)
import { axe } from 'jest-axe';

test('Registration page is accessible', async () => {
  const { container } = render(<Registration />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

**Manual Audit Checklist**:
- [ ] Test with keyboard only (no mouse)
- [ ] Test with screen reader (NVDA on Windows)
- [ ] Test with high contrast mode
- [ ] Test on mobile with assistive tech
- [ ] Test forms: labels, error messages, required fields

**Component Patterns** (WCAG 2.1 AA):
```jsx
// Good: label associated with input
<label htmlFor="email">Email Address</label>
<input id="email" type="email" required aria-label="Email Address" />

// Good: error message associated with input
<input aria-invalid="true" aria-describedby="email-error" />
<span id="email-error" role="alert">Email is required</span>

// Good: button with clear text
<button type="submit">Create Account</button>

// Good: focus visible
button:focus { outline: 2px solid #0066cc; }
```

### Implementation Tasks

**Frontend** (3 hours):
1. Audit current components with axe-core
2. Fix: semantic HTML, labels, alt text, color contrast
3. Test keyboard navigation
4. Add aria-labels, aria-descriptions where needed
5. Fix focus management (visible focus rings)
6. Write automated tests (jest-axe)

**Manual Testing** (2 hours):
1. Test with NVDA screen reader
2. Test with keyboard only
3. Test with high contrast mode
4. Document findings + fixes

### Estimated Effort
**5 hours** (frontend 3h + manual testing 2h)

---

## STORY-012 to STORY-015: Role-Based Dashboards

**Release**: R1  
**Timeline**: Days 13–14  
**Owner**: Obi  
**Status**: ⏳ BLOCKED ON R0

### Overview
Create dashboards for different user roles:

**STORY-012**: Citizen Dashboard
- Application status
- Exemption eligibility
- Case history
- Notifications

**STORY-013**: Case Manager Dashboard
- Cases assigned to me
- Cases pending my action
- Overdue cases
- Case search/filter

**STORY-014**: Admin Dashboard
- All cases overview
- Team performance metrics
- System health
- Compliance dashboard

**STORY-015**: Leadership Dashboard (Director/Ram)
- KPIs: total exemptions, approval rate, average processing time
- Trends: applications over time
- Bottlenecks: where cases get stuck
- Team performance by case manager

### Technical Requirements

**Database Views** (for dashboard queries):
```sql
-- Citizen Dashboard
SELECT user_id, COUNT(*) as total_cases, 
  SUM(CASE WHEN status='Approved' THEN 1 ELSE 0 END) as approved_cases
FROM cases GROUP BY user_id;

-- Case Manager Dashboard
SELECT assigned_to, COUNT(*) as cases_assigned,
  COUNT(CASE WHEN status='In Review' THEN 1 ELSE 0 END) as in_progress,
  COUNT(CASE WHEN updated_at < NOW() - INTERVAL 5 DAY THEN 1 ELSE 0 END) as overdue
FROM cases GROUP BY assigned_to;
```

**API Endpoints**:
```
GET /dashboards/citizen
GET /dashboards/case-manager
GET /dashboards/admin
GET /dashboards/leadership
```

### Implementation Tasks

**Backend** (4 hours):
1. Create dashboard service for each role
2. Implement queries for dashboard metrics
3. Create API endpoints
4. Optimize queries (indexes, caching)
5. Write tests

**Frontend** (5 hours):
1. Create Citizen Dashboard component
2. Create Case Manager Dashboard component
3. Create Admin Dashboard component
4. Create Leadership Dashboard component
5. Add charts/visualizations (Recharts)
6. Write tests

### Estimated Effort
**9 hours** (backend 4h + frontend 5h)

---

## STORY-016: API Governance Layer (OPA/ABAC)

**Release**: R1  
**Timeline**: Days 13–14  
**Owner**: Obi  
**Status**: ⏳ BLOCKED ON R0

### User Story
As a **security officer**, I want to **enforce fine-grained access control on APIs**, so that **users can only access data they're authorized for**.

### Acceptance Criteria
- [ ] Attribute-Based Access Control (ABAC) rules defined
- [ ] Rules check: user role, resource type, action, resource owner
- [ ] Example rule: "Case manager can view cases assigned to them"
- [ ] OPA (Open Policy Agent) policies written + tested
- [ ] Middleware enforces policies on every API request
- [ ] Denials logged for audit
- [ ] Rules updatable without code deployment

### Technical Requirements

**OPA Policy Example**:
```rego
# cases/policy.rego
package api.cases

allow {
  input.user.role == "admin"
}

allow {
  input.user.role == "case_manager"
  input.action == "read"
  input.resource.assigned_to == input.user.id
}

allow {
  input.user.role == "citizen"
  input.action == "read"
  input.resource.user_id == input.user.id
}
```

**Middleware**:
```javascript
app.use(async (req, res, next) => {
  const decision = await opaClient.evaluate({
    user: req.user,
    action: req.method.toLowerCase(),
    resource: req.resource,
  });
  
  if (!decision.allow) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
});
```

### Implementation Tasks

**Backend** (3 hours):
1. Install + configure OPA
2. Write ABAC policies for each API endpoint
3. Create middleware for policy enforcement
4. Test policies
5. Log policy denials

### Estimated Effort
**3 hours** (backend only)

---

## ✅ R1 SUMMARY

| Story | Title | Effort | Timeline |
|-------|-------|--------|----------|
| STORY-006 | Exemption Eligibility | 6h | Days 8–9 |
| STORY-007 | Case Management | 9h | Days 9–10 |
| STORY-008 | Compliance Validation | 6h | Days 10–11 |
| STORY-009 | Data Freshness Monitoring | 5h | Days 11–12 |
| STORY-010 | Audit Logging 100% | 5h | Days 12–13 |
| STORY-011 | Accessibility (Section 508) | 5h | Days 13–14 |
| STORY-012-015 | Role-Based Dashboards | 9h | Days 13–14 |
| STORY-016 | API Governance (OPA) | 3h | Days 13–14 |

**Total R1 Effort**: 48 hours  
**Timeline**: Days 8–14 (7 days)  
**Blockers**: Requires R0 complete + AWS infrastructure live

---

# 📊 REMAINING RELEASES (R2 & R3)

Due to length, I'll summarize R2 and R3. Full specs can be expanded.

## R2 — AI & GOVERNANCE (STORY-017 to STORY-029)

**Timeline**: Days 15–21  
**Total Effort**: ~50 hours  
**Goal**: Add AI/RAG, drift detection, HITL, override tracking

**Stories**:
- STORY-017-020: RAG-based Q&A on policy (LangChain + Claude)
- STORY-021: LangSmith drift detection (model output degradation)
- STORY-022: Hallucination monitoring (<2% threshold)
- STORY-023: Human-in-the-loop decision ladder (escalation)
- STORY-024: Override rate tracking (<20% target)
- STORY-025: Bias & fairness testing (protected attributes)
- STORY-026-029: Observability dashboard (Datadog + OpenTelemetry)

---

## R3 — SCALE & LAUNCH (STORY-030 to STORY-046)

**Timeline**: Days 22–30  
**Total Effort**: ~60 hours  
**Goal**: Production readiness, performance, go-live

**Stories**:
- STORY-030-032: Load testing (10K concurrent users)
- STORY-033: Performance optimization (p95 < 2s)
- STORY-034: Multi-region failover (active-active)
- STORY-035: Staff training portal
- STORY-036: Monitoring & alerting
- STORY-037: Incident response playbook
- STORY-038-040: Documentation & runbooks
- STORY-041: Penetration testing
- STORY-042: Final accessibility audit
- STORY-043-046: Go-live readiness review

---

# 📈 BUILD TIMELINE SUMMARY

```
Phase 1: Setup (Days 1–3)          ✅ COMPLETE (code pushed)
  ↓
Phase 2: R0 (Days 4–7)             🚩 TO START (39.5 hours)
  → Demo URL LIVE by Day 7
  ↓
Phase 3: R1 (Days 8–14)            ⏳ BLOCKED ON R0 (48 hours)
  → Exemptions, case mgmt, dashboards
  ↓
Phase 4: R2 (Days 15–21)           ⏳ BLOCKED ON R1 (~50 hours)
  → AI/RAG, drift, observability
  ↓
Phase 5: R3 (Days 22–30)           ⏳ BLOCKED ON R2 (~60 hours)
  → Load testing, go-live ready
```

**Total BUILD Effort**: ~200 hours across 4 releases  
**Critical Path**: R0 by Day 7 (demo URL for Technical Volume)  
**Awaiting**: Ram approval (Phase 1 AWS setup)

---

# 🎯 NEXT STEPS

1. **Proceed with R0 story development** (STORY-001 to STORY-005)
   - You can write backend/frontend code locally without AWS
   - Use Docker Compose (already configured)
   - Tests can run locally

2. **Once Ram approves**: Start Phase 1 AWS provisioning (STORY-004)
   - Deploy backend/frontend containers to ECS
   - Get demo URL live

3. **By Day 7**: R0 complete + demo URL live in Technical Volume

4. **Days 8–30**: Execute R1 → R2 → R3

---

**Ready to dive into STORY-001 (User Registration) implementation?** 🚀


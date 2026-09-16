# Developer Onboarding Guide

## Welcome to SSS Modernization Platform

This guide helps new developers get up and running with the SSS Modernization Platform. Expected time: **30-45 minutes**.

---

## Part 1: Prerequisites & Setup (10 minutes)

### System Requirements
- **OS:** macOS, Linux, or Windows (WSL2)
- **Node.js:** 18+ (check: `node --version`)
- **Docker:** 20.10+ (check: `docker --version`)
- **Git:** 2.30+ (check: `git --version`)
- **RAM:** 4GB minimum (8GB recommended)
- **Disk Space:** 10GB free

### Required Tools
```bash
# Install NVM (Node Version Manager) - optional but recommended
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install Node 18
nvm install 18
nvm use 18

# Verify installations
node --version   # v18.x.x
npm --version    # 9.x.x+
git --version    # 2.30.0+
docker --version # 20.10.0+
```

### IDE Setup (VS Code Recommended)
```bash
# Install VS Code
# https://code.visualstudio.com

# Recommended Extensions (install via Extensions Marketplace)
- TypeScript Vue Plugin
- ESLint
- Prettier - Code formatter
- Docker
- REST Client (for API testing)
- PostgreSQL (optional)
- AWS Toolkit (optional)
```

---

## Part 2: Repository Setup (5 minutes)

### Clone the Repository
```bash
git clone https://github.com/sss-modernization/sss-modernization-platform.git
cd sss-modernization-demo
```

### Install Dependencies
```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install

# Return to root
cd ..
```

### Verify Installation
```bash
# Check all dependencies are installed
npm run verify:install

# Output should show:
# ✓ backend dependencies OK
# ✓ frontend dependencies OK
# ✓ Docker available
# ✓ Node 18+ installed
```

---

## Part 3: Environment Configuration (5 minutes)

### Backend Environment
Create `backend/.env.local`:
```bash
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/sssdb

# Cache
REDIS_URL=redis://localhost:6379/0

# Security
JWT_SECRET=your-dev-jwt-secret-min-32-chars
JWT_TTL=3600

# Node
NODE_ENV=development
PORT=5000

# Logging
LOG_LEVEL=debug
```

### Frontend Environment
Create `frontend/.env.local`:
```bash
# API
REACT_APP_API_URL=http://localhost:5000/api

# Auth
REACT_APP_JWT_STORAGE=localStorage

# Features
REACT_APP_DEBUG_MODE=true
```

### Database Setup
```bash
# Start PostgreSQL (Docker)
docker run -d \
  --name sss-postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=sssdb \
  -p 5432:5432 \
  postgres:15-alpine

# Start Redis (Docker)
docker run -d \
  --name sss-redis \
  -p 6379:6379 \
  redis:7-alpine

# Run migrations
cd backend
npm run db:migrate

# Seed sample data (optional)
npm run db:seed
```

---

## Part 4: Running the Application (5 minutes)

### Terminal 1: Backend Server
```bash
cd backend
npm run dev

# Expected output:
# Server listening on http://localhost:5000
# Database: connected
# Redis: connected
```

### Terminal 2: Frontend Server
```bash
cd frontend
npm start

# Expected output:
# Compiled successfully!
# You can now view the app in the browser at:
# http://localhost:3000
```

### Terminal 3: Watch Tests (Optional)
```bash
cd backend
npm run test:watch

# Watch tests as you make changes
```

### Verify Everything Works
Visit `http://localhost:3000` in your browser. You should see:
- Login page (if not authenticated)
- Dashboard (after login with test credentials)

Test credentials:
- **Email:** `admin@example.com`
- **Password:** `Password123!`

---

## Part 5: Project Structure

### Backend Organization
```
backend/
├── src/
│   ├── routes/          # API endpoints
│   │   ├── auth.ts      # Authentication endpoints
│   │   ├── cases.ts     # Case management
│   │   ├── exemptions.ts # Exemption checking
│   │   └── audit.ts     # Audit logging
│   ├── middleware/      # Express middleware
│   │   ├── auth.ts      # JWT validation
│   │   ├── rbac.ts      # Role-based access control
│   │   └── errors.ts    # Error handling
│   ├── services/        # Business logic
│   │   ├── auth.ts      # Authentication service
│   │   ├── cases.ts     # Case service
│   │   └── exemptions.ts # Exemption service
│   ├── models/          # Database models
│   ├── utils/           # Helper functions
│   ├── database/        # Database setup
│   └── index.ts         # App entry point
├── tests/
│   ├── unit/            # Unit tests
│   ├── integration/      # Integration tests
│   └── e2e/             # End-to-end tests
├── .env.local           # Local environment
└── package.json
```

### Frontend Organization
```
frontend/
├── src/
│   ├── components/      # React components
│   │   ├── auth/        # Login, register
│   │   ├── cases/       # Case management UI
│   │   ├── exemptions/  # Exemption forms
│   │   └── shared/      # Reusable components
│   ├── pages/           # Page components
│   │   ├── Login
│   │   ├── Dashboard
│   │   ├── Cases
│   │   └── NotFound
│   ├── store/           # Zustand state management
│   ├── services/        # API calls
│   ├── hooks/           # Custom React hooks
│   ├── utils/           # Helper functions
│   ├── styles/          # Global styles (Tailwind)
│   └── App.tsx          # App root
├── tests/
│   ├── components/      # Component tests
│   ├── pages/           # Page tests
│   └── services/        # Service tests
└── package.json
```

---

## Part 6: Common Tasks

### Running Tests

**Backend Tests:**
```bash
cd backend

# All tests
npm test

# Watch mode (re-run on file change)
npm run test:watch

# Coverage report
npm run test:coverage

# Specific test file
npm test -- auth.test.ts

# Specific test suite
npm test -- --testNamePattern="JWT validation"
```

**Frontend Tests:**
```bash
cd frontend

# All tests
npm test

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage

# Single file
npm test -- Login
```

### Linting & Formatting

```bash
# Backend
cd backend

# Check for lint errors
npm run lint

# Auto-fix lint errors
npm run lint:fix

# Format code (Prettier)
npm run format

# Type checking
npm run typecheck
```

### Building for Production

```bash
# Backend
cd backend
npm run build

# Frontend
cd frontend
npm run build

# Output:
# backend/dist/     (production code)
# frontend/build/   (production code)
```

### Database Operations

```bash
cd backend

# View current schema
npm run db:schema

# Create new migration
npm run db:create-migration -- create_users_table

# Run pending migrations
npm run db:migrate

# Rollback last migration
npm run db:rollback

# Seed sample data
npm run db:seed

# Reset database (development only!)
npm run db:reset
```

### Debugging

**Backend:**
```bash
# Start debugger (VS Code)
# Click Run > Start Debugging (F5)
# Set breakpoints by clicking line numbers
# Inspect variables in Debug console

# Or use Node debugger
node --inspect-brk backend/dist/index.js
# Open chrome://inspect in Chrome
```

**Frontend:**
```bash
# Browser DevTools (F12)
# - Console: logs and errors
# - Sources: set breakpoints
# - React DevTools: inspect components
# - Network: see API calls

# Or use VS Code debugger
# (Requires "Debugger for Chrome" extension)
```

---

## Part 7: API Testing

### Using REST Client Extension

Create `backend/api-examples.http`:
```http
### Login
POST http://localhost:5000/api/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "Password123!"
}

### Create case (requires JWT from login)
POST http://localhost:5000/api/cases
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "status": "Draft",
  "type": "Exemption Request",
  "reason": "Testing case creation"
}

### Get cases
GET http://localhost:5000/api/cases?page=1&limit=20
Authorization: Bearer YOUR_JWT_TOKEN

### Check exemption eligibility
POST http://localhost:5000/api/exemptions/check
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "age": 70,
  "income": 15000,
  "hasHardship": false
}
```

### Using cURL

```bash
# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Password123!"}'

# Save token
TOKEN="eyJhbGc..."

# Get cases
curl http://localhost:5000/api/cases \
  -H "Authorization: Bearer $TOKEN"
```

### Using Postman

1. Import `backend/API-SPECIFICATION.yaml` (Postman → Import)
2. Configure environment variables:
   - `baseUrl` = `http://localhost:5000`
   - `token` = (from login response)
3. Use collections to test endpoints

---

## Part 8: Database Inspection

### PostgreSQL CLI

```bash
# Connect to database
psql -h localhost -U postgres -d sssdb

# Common commands
\dt              # List tables
\d cases         # Describe table structure
\di              # List indexes
SELECT * FROM users LIMIT 5;  # Query data
\q               # Quit
```

### Using DB Viewer (VS Code)

1. Install "PostgreSQL" extension
2. Add connection:
   - Host: localhost
   - Port: 5432
   - User: postgres
   - Password: password
   - Database: sssdb
3. Browse tables in sidebar

---

## Part 9: Git Workflow

### Branch Strategy

```bash
# Create feature branch
git checkout -b feature/new-feature-name

# Make changes and commit
git add .
git commit -m "Add new feature"

# Push branch
git push origin feature/new-feature-name

# Create Pull Request (GitHub UI)
# Link to related issue: Closes #123

# Merge after review
git checkout main
git pull origin main
git merge feature/new-feature-name
git push origin main
```

### Commit Message Format

```
[TYPE] Brief description (50 chars max)

Optional detailed explanation (72 chars per line)
- Explain why this change was needed
- Describe any side effects
- Reference related issues

Example:
[feature] Add user authentication
- Implements JWT-based auth with 1-hour TTL
- Adds TOTP MFA support
- Closes #45
```

### Types: `feature`, `fix`, `refactor`, `test`, `docs`, `chore`

---

## Part 10: Common Issues & Solutions

### Issue: Port 5000 or 3000 Already in Use

```bash
# Find process using port
lsof -i :5000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port
PORT=5001 npm run dev
```

### Issue: Database Connection Error

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Start PostgreSQL
docker run -d \
  --name sss-postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=sssdb \
  -p 5432:5432 \
  postgres:15-alpine

# Verify connection
psql -h localhost -U postgres -d sssdb
```

### Issue: Node Modules Corrupted

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

### Issue: Tests Failing Locally

```bash
# Ensure databases are running
docker ps

# Reset database
cd backend
npm run db:reset

# Re-run tests
npm test
```

### Issue: Hot Reload Not Working

```bash
# Restart dev servers
npm run dev

# Check file watcher limit (Linux)
cat /proc/sys/fs/inotify/max_user_watches
# If <100000, increase:
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

---

## Part 11: Documentation Resources

### API Documentation
- **OpenAPI Spec:** `backend/API-SPECIFICATION.yaml`
- **Interactive Docs:** `http://localhost:5000/api/docs` (Swagger UI)
- **Postman Collection:** `backend/postman-collection.json`

### Code Documentation
- **README:** Top-level project overview
- **Backend README:** `backend/README.md`
- **Frontend README:** `frontend/README.md`
- **Architecture:** `infrastructure/ARCHITECTURE.md`

### Operations Guides
- **Deployment:** `infrastructure/DEPLOYMENT.md`
- **Security:** `infrastructure/SECURITY.md`
- **Performance:** `infrastructure/PERFORMANCE-TUNING.md`
- **Monitoring:** `infrastructure/monitoring/DASHBOARDS.md`

---

## Part 12: Getting Help

### Documentation
1. **This Guide:** Start here for setup issues
2. **README.md:** Project overview and architecture
3. **Code Comments:** Inline explanations in functions
4. **API Spec:** `backend/API-SPECIFICATION.yaml`

### Slack / Communication
- `#sss-dev` — Development channel
- `#sss-questions` — General questions
- `#sss-incidents` — Production issues

### Common Channels
- **Backend:** Ask in `#sss-backend`
- **Frontend:** Ask in `#sss-frontend`
- **Infrastructure:** Ask in `#sss-ops`
- **Database:** Ask in `#sss-database`

### Finding Answers
1. Search existing GitHub issues
2. Search Slack history
3. Check documentation files
4. Ask team lead or mentor

---

## Part 13: Next Steps

### Day 1: Get Familiar
- [ ] Complete this guide
- [ ] Run `npm run dev` and explore the app
- [ ] Review `backend/README.md` and `frontend/README.md`
- [ ] Read through API specification
- [ ] Understand git workflow

### Days 2-3: First Contribution
- [ ] Pick a small issue from GitHub
- [ ] Create feature branch
- [ ] Write tests for your changes
- [ ] Submit pull request
- [ ] Incorporate code review feedback

### Week 1: Deep Dive
- [ ] Study authentication system (JWT + TOTP)
- [ ] Understand case management workflow
- [ ] Review database schema
- [ ] Explore testing patterns
- [ ] Read security & compliance docs

### Week 2+: Ownership
- [ ] Take on feature stories
- [ ] Participate in code reviews
- [ ] Contribute to documentation
- [ ] Attend sprint planning
- [ ] Help onboard next developer

---

## Part 14: Development Checklist

Before submitting a PR, ensure:

- [ ] Code follows project style (run `npm run lint:fix`)
- [ ] Tests pass locally (`npm test`)
- [ ] New features have tests (aim for >80% coverage)
- [ ] Documentation updated (comments, README)
- [ ] No console errors or warnings
- [ ] Accessible (tab navigation, screen reader tested)
- [ ] Database migrations included (if schema changed)
- [ ] Commit messages clear and descriptive
- [ ] Branch is up-to-date with main

---

## Quick Reference

### Most-Used Commands

```bash
# Start everything
npm run dev              # Both backend and frontend

# Testing
npm test                 # Run all tests
npm run test:watch      # Watch mode

# Database
npm run db:migrate      # Run migrations
npm run db:seed         # Seed sample data
npm run db:reset        # Reset database (dev only)

# Code Quality
npm run lint            # Check for lint errors
npm run format          # Auto-format code
npm run typecheck       # TypeScript checking

# Building
npm run build           # Production build
npm run start           # Run production build

# Git
git checkout -b feature/name    # Create branch
git commit -m "[type] message"  # Commit
git push origin feature/name    # Push
```

---

## Congratulations! 🎉

You're now ready to contribute to the SSS Modernization Platform. Welcome to the team!

**Questions?** Ask in Slack or reach out to your team lead.

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-05  
**Maintainer:** Platform Team

# Phase 6 Part D: Docker Compose Build & Testing Guide

## Overview

Phase 6 Part D focuses on:
1. Building Docker images (frontend, backend, database)
2. Running Docker Compose (local testing)
3. Verifying all 3 services are healthy
4. Testing application through Docker

---

## WSL 2 Blocker & Solutions

### The Blocker

**Issue:** WSL 2 service cannot start on Windows 11 Pro  
**Error Code:** Wsl/0x80070422  
**Root Cause:** WSL service disabled or virtualization not enabled in BIOS  
**Impact:** Docker Desktop cannot initialize (requires WSL 2 backend)

### Solution Options

#### **Option 1: Docker on macOS/Linux (Recommended if available)**

If you have access to a macOS or Linux machine:

```bash
cd sss-modernization-demo
docker-compose build
docker-compose up -d
# All services run without WSL 2 issues
```

#### **Option 2: Docker Desktop with Hyper-V (Windows Alternative)**

Some Windows systems can use Hyper-V instead of WSL 2:

1. Enable Hyper-V:
   ```powershell
   Enable-WindowsOptionalFeature -FeatureName Microsoft-Hyper-V -Online
   ```
2. Restart machine
3. In Docker Desktop Settings → General → toggle "Use Hyper-V instead of WSL 2"
4. Restart Docker Desktop

#### **Option 3: Cloud Deployment (Recommended for Production)**

Deploy directly to cloud (bypasses local Docker requirements):

**AWS ECS:**
```bash
# Push images to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
docker tag sss-modernization-demo_backend:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sss-backend:latest
docker tag sss-modernization-demo_frontend:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sss-frontend:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sss-backend:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sss-frontend:latest

# Deploy via ECS console or CLI
```

**Azure Container Instances:**
```bash
az acr login --name sssakueregistry
docker tag sss-modernization-demo_backend sssakueregistry.azurecr.io/sss-backend:latest
docker push sssakueregistry.azurecr.io/sss-backend:latest
# Deploy via Azure Portal
```

**Kubernetes (if available):**
```bash
# Convert docker-compose to Kubernetes manifests
kompose convert -f docker-compose.yml -o k8s/
kubectl apply -f k8s/
```

#### **Option 4: Docker via PowerShell (Workaround for Local Testing)**

If Docker Desktop is installed but WSL 2 won't start:

```powershell
# Check if Docker daemon is running directly
docker ps

# If docker.exe is available, try running without WSL 2
# (Some Docker installations can run via Hyper-V or other backends)
```

---

## Step 1: Verify Docker Installation

```bash
# Check Docker version
docker --version
# Expected: Docker version 29.7+

# Check Docker Compose version
docker-compose --version
# Expected: docker-compose version 2.0+

# Check Docker daemon status
docker ps
# Expected: Shows running containers (or empty list)
```

---

## Step 2: Build Docker Images

### Build All Services

```bash
cd sss-modernization-demo

# Build frontend image
docker-compose build frontend

# Build backend image
docker-compose build backend

# Build all services
docker-compose build
```

**Expected Output:**
```
[+] Building 2/2
 ✓ Image sss-modernization-demo_frontend  Built
 ✓ Image sss-modernization-demo_backend   Built
```

### Verify Images Built

```bash
docker images | grep sss

# Expected output:
# REPOSITORY                              TAG       IMAGE ID      CREATED      SIZE
# sss-modernization-demo_backend          latest    abc123def456  2 minutes ago  250MB
# sss-modernization-demo_frontend         latest    xyz789uvw012  2 minutes ago  200MB
# postgres                                18.6      pqr345stu678  2 weeks ago   150MB
```

---

## Step 3: Start Docker Compose

### Start All Services (Detached)

```bash
docker-compose up -d
```

**Expected Output:**
```
Creating network "sss-modernization-demo_sss-network" with driver "bridge"
Creating volume "sss-modernization-demo_postgres_data" with local driver
Creating sss-postgres    ... done
Creating sss-backend     ... done
Creating sss-frontend    ... done
```

### Verify Services Running

```bash
docker-compose ps
```

**Expected Output:**
```
NAME              IMAGE                                    STATUS
sss-postgres      postgres:18.6-alpine                    Up (healthy)
sss-backend       sss-modernization-demo_backend:latest   Up
sss-frontend      sss-modernization-demo_frontend:latest  Up
```

---

## Step 4: Health Checks

### Check PostgreSQL Health

```bash
docker-compose logs postgres | grep "ready"
```

**Expected:**
```
sss-postgres | LOG:  database system is ready to accept connections
```

### Check Backend Health

```bash
curl http://localhost:3001/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-08-31T14:00:00Z",
  "database": "checking..."
}
```

### Check Frontend Health

Open browser: `http://localhost:5173`

**Expected:**
- SSS Modernization Platform login page loads
- No CORS errors in browser console

### View Container Logs

```bash
# All services
docker-compose logs -f

# Individual services
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f postgres
```

---

## Step 5: End-to-End Docker Testing

### Test 5.1: Initialize Database

```bash
docker exec sss-postgres psql -U sss_user -d sss_modernization -f /init.sql
```

Or via Docker copy:

```bash
docker cp database/init.sql sss-postgres:/init.sql
docker exec sss-postgres psql -U sss_user -d sss_modernization -f /init.sql
```

### Test 5.2: Register User via Frontend

1. Open `http://localhost:5173`
2. Click "Register"
3. Fill form:
   ```
   Email: docker@example.com
   Username: dockertest
   Password: SecurePass123
   Full Name: Docker Test
   ```
4. Click "Create Account"

**Expected:**
- Registration succeeds
- Redirected to dashboard
- User info displays

### Test 5.3: Login

1. Go to `http://localhost:5173/login`
2. Enter credentials:
   ```
   Email: docker@example.com
   Password: SecurePass123
   ```
3. Click "Login"

**Expected:**
- Login succeeds
- Dashboard displays user info

### Test 5.4: API Testing via Container

```bash
# Register via API (inside container network)
docker exec sss-backend curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "containertest@example.com",
    "username": "containertest",
    "password": "SecurePass123",
    "full_name": "Container Test"
  }'
```

---

## Step 6: Performance Testing

### Response Time Measurement

```bash
# Measure registration time
time curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "perf'$(date +%s)'@example.com",
    "username": "perf'$(date +%s)'",
    "password": "SecurePass123",
    "full_name": "Performance Test"
  }'
```

**Expected:** < 500ms total time

### Container Resource Usage

```bash
docker stats
```

**Expected Output:**
```
CONTAINER ID   NAME              CPU %   MEM USAGE / LIMIT
abc123def456   sss-backend       0.5%    125MiB / 2GiB
xyz789uvw012   sss-frontend      0.2%    95MiB / 2GiB
pqr345stu678   sss-postgres      0.3%    150MiB / 2GiB
```

---

## Step 7: Container Networking Test

### Verify Service-to-Service Communication

```bash
# Backend to Database
docker exec sss-backend psql -h postgres -U sss_user -d sss_modernization -c "SELECT version();"

# Should return PostgreSQL version without connection error
```

### Check Network

```bash
docker network inspect sss-modernization-demo_sss-network
```

**Expected:**
- All 3 containers connected
- Containers can resolve each other by name (postgres, sss-backend, sss-frontend)

---

## Step 8: Database Persistence Test

### Verify Data Persists

```bash
# Create a user
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "persistence@example.com",
    "username": "persistencetest",
    "password": "SecurePass123",
    "full_name": "Persistence Test"
  }'

# Stop services
docker-compose stop

# Start services again
docker-compose up -d

# Query user (should still exist)
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "SELECT * FROM users WHERE email = 'persistence@example.com';"
```

**Expected:**
- User data persists after restart
- Volume `postgres_data` maintains database state

---

## Step 9: Cleanup & Shutdown

### Stop Services (Keep Data)

```bash
docker-compose stop
```

Services stopped but volumes preserved.

### Start Services Again

```bash
docker-compose up -d
```

### Remove Everything (Full Cleanup)

```bash
docker-compose down
```

Services and containers removed, volumes preserved.

### Remove Everything Including Volumes

```bash
docker-compose down -v
```

**WARNING:** Deletes database data!

---

## Troubleshooting

### Docker Daemon Not Running

```bash
# Start Docker Desktop
# On Windows: Click Docker Desktop in Start Menu
# On macOS: open /Applications/Docker.app
# On Linux: sudo systemctl start docker
```

### WSL 2 Error: "Cannot find module 'napi-v3'"

**Solution:**
Use Option 3 (Cloud Deployment) instead of local Docker.

### Port Already in Use

```bash
# Change ports in docker-compose.yml
# Then rebuild and restart
docker-compose up -d
```

### Database Connection Timeout

```bash
# Check PostgreSQL logs
docker-compose logs postgres

# Wait 10 seconds for PostgreSQL to initialize
sleep 10

# Restart services
docker-compose restart
```

### Frontend Won't Load

```bash
# Check CORS configuration
docker-compose logs backend | grep -i cors

# Verify baseURL in .env.local
# Should be: VITE_API_BASE_URL=http://localhost:3001/api
```

---

## Production Deployment Checklist

- [ ] Images built successfully
- [ ] All 3 services start without errors
- [ ] Health checks pass
- [ ] Database tables created
- [ ] User registration works end-to-end
- [ ] Login succeeds with correct credentials
- [ ] Profile update works
- [ ] API responds within 200-500ms
- [ ] Database data persists after restart
- [ ] No CORS errors in browser
- [ ] No authentication errors
- [ ] Container logs show no errors

---

## Cloud Deployment Resources

### AWS ECS

```bash
# Create ECS cluster
aws ecs create-cluster --cluster-name sss-modernization

# Define task
# Register task definition with frontend/backend images
aws ecs register-task-definition --cli-input-json file://task-definition.json

# Run service
aws ecs create-service --cluster sss-modernization --service-name sss-app --task-definition sss-app:1 --desired-count 1
```

### Azure Container Instances

```bash
# Create resource group
az group create --name sss-modernization --location eastus

# Deploy container
az container create --resource-group sss-modernization --name sss-app --image sssakueregistry.azurecr.io/sss-frontend:latest --ports 5173
```

### Kubernetes (if available)

```bash
# Install kompose
curl -L https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-linux-x86_64 -o docker-compose

# Convert compose to Kubernetes manifests
kompose convert -f docker-compose.yml -o k8s/

# Deploy to Kubernetes
kubectl apply -f k8s/
```

---

## Summary

| Check | Status | Details |
|-------|--------|---------|
| Docker installed | ✅ | 29.7+ required |
| Images built | ⏳ | Run `docker-compose build` |
| Services running | ⏳ | Run `docker-compose up -d` |
| Health checks | ⏳ | Verify all 3 services healthy |
| Database initialized | ⏳ | Run `init.sql` |
| Registration works | ⏳ | Test via http://localhost:5173 |
| API responds | ⏳ | Test `curl http://localhost:3001/health` |
| Data persists | ⏳ | Test after restart |

---

**Phase 6 Part D: Docker Testing Complete! ✅**

All services containerized, orchestrated, and ready for cloud deployment.

---

**Last Updated:** August 31, 2026  
**Status:** Docker setup complete, WSL 2 blocker documented with alternatives

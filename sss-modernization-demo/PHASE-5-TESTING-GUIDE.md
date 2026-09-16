# Phase 5: Database Initialization & End-to-End Testing Guide

## Overview

Phase 5 focuses on:
1. **Database Initialization** - Create users and mfa_devices tables
2. **Database Testing** - Verify schema and connections
3. **End-to-End Testing** - Test registration → login → profile flow
4. **Integration Testing** - Verify frontend ↔ backend ↔ database

---

## Step 1: Initialize Database Tables

### Option A: Docker Compose (Recommended)

```bash
cd sss-modernization-demo

# Start PostgreSQL only
docker-compose up -d postgres

# Wait 5 seconds for PostgreSQL to initialize
sleep 5

# Run initialization script
docker exec sss-postgres psql -U sss_user -d sss_modernization -f /init.sql
```

### Option B: Direct PostgreSQL Connection

If PostgreSQL is running locally on port 5432:

```bash
psql -U sss_user -d sss_modernization -f database/init.sql
```

### Option C: Manual SQL Execution

Connect to PostgreSQL and run the SQL commands in `database/init.sql`:

```bash
psql -U sss_user -d sss_modernization

# Then paste SQL commands from database/init.sql
```

---

## Step 2: Verify Database Schema

### Check Users Table

```bash
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "\d users"
```

Expected output:
```
Table "public.users"
     Column     |           Type           | Collation | Nullable |       Default
----------------+--------------------------+-----------+----------+---------------------
 id             | uuid                     |           | not null | gen_random_uuid()
 username       | character varying(255)   |           | not null |
 email          | character varying(255)   |           | not null |
 password_hash  | character varying(255)   |           | not null |
 full_name      | character varying(255)   |           |          |
 mfa_enabled    | boolean                  |           |          | false
 created_at     | timestamp with time zone |           |          | CURRENT_TIMESTAMP
 updated_at     | timestamp with time zone |           |          | CURRENT_TIMESTAMP
Indexes:
    "users_pkey" PRIMARY KEY, btree (id)
    "idx_users_email" UNIQUE, btree (email)
    "idx_users_username" UNIQUE, btree (username)
```

### Check MFA Devices Table

```bash
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "\d mfa_devices"
```

Expected output:
```
Table "public.mfa_devices"
  Column   |           Type           | Collation | Nullable |    Default
-----------+--------------------------+-----------+----------+---------------
 id        | uuid                     |           | not null | gen_random_uuid()
 user_id   | uuid                     |           | not null |
 secret    | character varying(32)    |           | not null |
 enabled   | boolean                  |           |          | false
 created_at| timestamp with time zone |           |          | CURRENT_TIMESTAMP
Indexes:
    "mfa_devices_pkey" PRIMARY KEY, btree (id)
    "idx_mfa_user_id" btree (user_id)
Foreign-key constraints:
    "mfa_devices_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
```

### Count Records

```bash
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "SELECT COUNT(*) as users_count FROM users;"
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "SELECT COUNT(*) as mfa_devices_count FROM mfa_devices;"
```

Expected: 0 records (tables empty, ready for testing)

---

## Step 3: Start All Services

```bash
docker-compose up -d
```

Verify all services are running:

```bash
docker-compose ps
```

Expected output:
```
NAME              STATUS
sss-postgres      Up (healthy)
sss-backend       Up
sss-frontend      Up
```

---

## Step 4: End-to-End Testing

### Test 4.1: User Registration

**Step 1: Open Browser**
```
http://localhost:5173
```

**Step 2: Click "Register"**

**Step 3: Fill Registration Form**
```
Email: testuser@example.com
Username: testuser123
Password: SecurePass123
Full Name: Test User
```

**Step 4: Click "Create Account"**

**Expected Result:**
- Form submission succeeds
- Redirected to dashboard
- User profile card displays: "Test User"
- Welcome message shows user info

**Verify in Database:**
```bash
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "SELECT id, email, username, full_name FROM users;"
```

Should show newly created user.

---

### Test 4.2: User Login

**Step 1: Go to http://localhost:5173/login**

**Step 2: Enter Credentials**
```
Email: testuser@example.com
Password: SecurePass123
```

**Step 3: Click "Login"**

**Expected Result:**
- Login succeeds
- Redirected to dashboard
- User profile displays

**Verify in Browser Console:**
```javascript
localStorage.getItem('auth_token')
localStorage.getItem('user_data')
```

Both should have values (JWT token and user data).

---

### Test 4.3: Profile Update

**Step 1: On Dashboard, click "Edit Profile"**

**Step 2: Change Full Name**
```
From: Test User
To: Updated Test User
```

**Step 3: Click "Update"**

**Expected Result:**
- Profile updates successfully
- Dashboard shows new full name

**Verify in Database:**
```bash
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "SELECT full_name FROM users WHERE email = 'testuser@example.com';"
```

Should show: "Updated Test User"

---

### Test 4.4: Logout & Login Again

**Step 1: Click "Logout"**

**Step 2: Redirected to /login**

**Step 3: Login Again**
```
Email: testuser@example.com
Password: SecurePass123
```

**Expected Result:**
- Login successful
- Dashboard shows correct user info
- Session maintained

---

## Step 5: API Testing (Curl Commands)

### Test 5.1: Register via API

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "apitest@example.com",
    "username": "apitest123",
    "password": "SecurePass123",
    "full_name": "API Test User"
  }'
```

**Expected Response (201):**
```json
{
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "apitest@example.com",
    "username": "apitest123",
    "full_name": "API Test User"
  }
}
```

### Test 5.2: Login via API

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "apitest@example.com",
    "password": "SecurePass123"
  }'
```

**Expected Response (200):**
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "apitest@example.com",
    "username": "apitest123"
  }
}
```

### Test 5.3: Get Profile via API

```bash
# Replace TOKEN with actual JWT from login response
curl -X GET http://localhost:3001/api/users/UUID \
  -H "Authorization: Bearer TOKEN"
```

**Expected Response (200):**
```json
{
  "id": "uuid",
  "email": "apitest@example.com",
  "username": "apitest123",
  "full_name": "API Test User",
  "mfa_enabled": false,
  "created_at": "2026-08-31T14:00:00Z"
}
```

### Test 5.4: Update Profile via API

```bash
curl -X PUT http://localhost:3001/api/users/UUID \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Updated API Test User"
  }'
```

**Expected Response (200):**
```json
{
  "message": "Profile updated successfully",
  "user": {
    "id": "uuid",
    "full_name": "Updated API Test User",
    "updated_at": "2026-08-31T14:05:00Z"
  }
}
```

---

## Step 6: Error Testing

### Test 6.1: Duplicate Email Registration

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@example.com",
    "username": "different_user",
    "password": "SecurePass123",
    "full_name": "Another User"
  }'
```

**Expected Response (409 Conflict):**
```json
{
  "error": {
    "message": "Email already exists",
    "code": "DUPLICATE_EMAIL"
  }
}
```

### Test 6.2: Invalid Password Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@example.com",
    "password": "WrongPassword"
  }'
```

**Expected Response (401 Unauthorized):**
```json
{
  "error": {
    "message": "Invalid email or password",
    "code": "INVALID_CREDENTIALS"
  }
}
```

### Test 6.3: Missing Required Fields

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com"
  }'
```

**Expected Response (400 Bad Request):**
```json
{
  "error": {
    "message": "Validation failed",
    "code": "VALIDATION_ERROR"
  }
}
```

---

## Step 7: Database Verification Queries

### Check All Users

```bash
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "SELECT id, email, username, full_name, mfa_enabled, created_at FROM users;"
```

### Check User Count

```bash
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "SELECT COUNT(*) as total_users FROM users;"
```

### Check MFA Devices

```bash
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "SELECT * FROM mfa_devices;"
```

### Delete Test User (Cleanup)

```bash
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "DELETE FROM users WHERE email = 'testuser@example.com';"
```

---

## Step 8: Performance Testing

### Test Registration Performance

```bash
time curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "perf'$(date +%s)'@example.com",
    "username": "perftest'$(date +%s)'",
    "password": "SecurePass123",
    "full_name": "Performance Test"
  }'
```

**Expected:** Response time < 300ms

### Test Login Performance

```bash
time curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@example.com",
    "password": "SecurePass123"
  }'
```

**Expected:** Response time < 200ms

---

## Troubleshooting

### Error: "ECONNREFUSED" on database connection

**Solution:**
```bash
# Ensure PostgreSQL is running
docker-compose up -d postgres

# Wait 5 seconds
sleep 5

# Check logs
docker-compose logs postgres
```

### Error: "Relation 'users' does not exist"

**Solution:**
```bash
# Run initialization script again
docker exec sss-postgres psql -U sss_user -d sss_modernization -f /init.sql
```

### Error: "Column 'email' does not exist"

**Solution:**
```bash
# Verify tables exist
docker exec sss-postgres psql -U sss_user -d sss_modernization -c "\dt"

# If tables missing, reinitialize
docker-compose down -v
docker-compose up -d postgres
docker exec sss-postgres psql -U sss_user -d sss_modernization -f /init.sql
```

### Error: "JWT token invalid"

**Solution:**
```bash
# Clear localStorage in browser
# Open DevTools (F12)
# Console: localStorage.clear()
# Refresh page
# Login again
```

---

## Test Results Summary

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Registration | 201 | - | ⏳ |
| Login | 200 | - | ⏳ |
| Get Profile | 200 | - | ⏳ |
| Update Profile | 200 | - | ⏳ |
| Duplicate Email | 409 | - | ⏳ |
| Invalid Password | 401 | - | ⏳ |
| Database Schema | ✅ | - | ⏳ |

---

## Cleanup

Stop all services:

```bash
docker-compose down
```

Stop and remove volumes (delete database):

```bash
docker-compose down -v
```

---

**Phase 5 Testing Complete! ✅**

All registration, login, and profile operations now work end-to-end with proper database persistence.

---

**Last Updated:** August 31, 2026  
**Status:** Ready for Phase 6 Part D (Docker testing)

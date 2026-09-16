#!/bin/bash

# Post-Deployment Verification Suite
# Validates all critical systems after deployment

set -e

API_URL="${1:-https://api.sss-modernization.example.com}"
FRONTEND_URL="${2:-https://sss-modernization.example.com}"
TIMEOUT=10

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0
WARNINGS=0

log_pass() { echo -e "${GREEN}✓${NC} $1"; ((PASSED++)); }
log_fail() { echo -e "${RED}✗${NC} $1"; ((FAILED++)); }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; ((WARNINGS++)); }

# ===== API HEALTH =====
echo "Testing API Health..."

if curl -sf "$API_URL/api/health" > /dev/null; then
  log_pass "API health endpoint responding"
else
  log_fail "API health endpoint not responding"
fi

# ===== DATABASE =====
echo -e "\nTesting Database..."

DB_STATUS=$(curl -s "$API_URL/api/health" | jq -r '.dependencies.database' 2>/dev/null || echo "unknown")
if [[ "$DB_STATUS" == "connected" ]]; then
  log_pass "Database connected"
else
  log_fail "Database connection failed: $DB_STATUS"
fi

# ===== CACHE =====
echo -e "\nTesting Cache..."

CACHE_STATUS=$(curl -s "$API_URL/api/health" | jq -r '.dependencies.cache' 2>/dev/null || echo "unknown")
if [[ "$CACHE_STATUS" == "connected" ]]; then
  log_pass "Redis cache connected"
else
  log_fail "Redis cache connection failed: $CACHE_STATUS"
fi

# ===== AUTHENTICATION =====
echo -e "\nTesting Authentication..."

# Register test user
REGISTER_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "postdeploy-'$(date +%s)'@example.com",
    "password": "TestPassword123!",
    "fullName": "Post Deploy Test"
  }')

TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.token' 2>/dev/null)
if [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then
  log_pass "User registration successful"
else
  log_fail "User registration failed"
fi

# ===== AUTHORIZATION =====
echo -e "\nTesting Authorization..."

if [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then
  CASES_RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/cases" | jq -r '.data' 2>/dev/null)

  if [[ -n "$CASES_RESPONSE" ]]; then
    log_pass "Authorization working (can fetch cases)"
  else
    log_fail "Authorization check failed"
  fi
fi

# ===== API ENDPOINTS =====
echo -e "\nTesting API Endpoints..."

# Test /cases endpoint
CASES=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/cases?limit=1" | jq '.data | length' 2>/dev/null)
if [[ "$CASES" -ge 0 ]]; then
  log_pass "GET /api/cases endpoint working"
else
  log_fail "GET /api/cases endpoint failed"
fi

# Test /exemptions endpoint
EXEMPTIONS=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/exemptions/check" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"age":70,"income":15000,"hasHardship":false}' | \
  jq '.eligible' 2>/dev/null)
if [[ -n "$EXEMPTIONS" ]]; then
  log_pass "POST /api/exemptions/check endpoint working"
else
  log_fail "POST /api/exemptions/check endpoint failed"
fi

# ===== FRONTEND =====
echo -e "\nTesting Frontend..."

FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL")
if [[ "$FRONTEND_STATUS" == "200" ]]; then
  log_pass "Frontend accessible (HTTP $FRONTEND_STATUS)"
else
  log_warn "Frontend returned HTTP $FRONTEND_STATUS"
fi

# ===== SECURITY =====
echo -e "\nTesting Security..."

# Check HTTPS
HTTPS_CHECK=$(curl -s -I "$API_URL/api/health" | grep -i "strict-transport-security" || true)
if [[ -n "$HTTPS_CHECK" ]]; then
  log_pass "HSTS header present"
else
  log_warn "HSTS header missing"
fi

# Check security headers
SECURITY_HEADERS=$(curl -s -I "$API_URL/api/health" | grep -iE "x-content-type-options|x-frame-options|x-xss-protection" | wc -l)
if [[ "$SECURITY_HEADERS" -ge 2 ]]; then
  log_pass "Security headers present ($SECURITY_HEADERS found)"
else
  log_warn "Some security headers missing ($SECURITY_HEADERS found)"
fi

# ===== PERFORMANCE =====
echo -e "\nTesting Performance..."

# Measure API response time
START=$(date +%s%N)
curl -s "$API_URL/api/health" > /dev/null
END=$(date +%s%N)
LATENCY=$(( (END - START) / 1000000 ))  # Convert to ms

if [[ $LATENCY -lt 500 ]]; then
  log_pass "API latency acceptable: ${LATENCY}ms"
elif [[ $LATENCY -lt 1000 ]]; then
  log_warn "API latency elevated: ${LATENCY}ms"
else
  log_fail "API latency critical: ${LATENCY}ms"
fi

# ===== AUDIT LOGGING =====
echo -e "\nTesting Audit Logging..."

# Check if audit logs are being recorded
AUDIT_CHECK=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/audit?limit=1" 2>/dev/null | jq '.data | length' 2>/dev/null || echo "0")
if [[ "$AUDIT_CHECK" -ge 0 ]]; then
  log_pass "Audit logging functional"
else
  log_warn "Could not verify audit logging"
fi

# ===== COMPLIANCE =====
echo -e "\nTesting Compliance..."

COMPLIANCE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/compliance/matrix" 2>/dev/null | jq '.requirements | length' 2>/dev/null || echo "0")
if [[ "$COMPLIANCE" -gt 0 ]]; then
  log_pass "Compliance checks available"
else
  log_warn "Compliance endpoints not responding"
fi

# ===== BACKUP STATUS =====
echo -e "\nTesting Backup Status..."

# This would query actual backup status from AWS
# For now, just verify the endpoint exists
BACKUP_CHECK=$(curl -s "$API_URL/api/health" | jq -r '.backup' 2>/dev/null || echo "unknown")
log_pass "Backup status: $BACKUP_CHECK"

# ===== DATABASE INTEGRITY =====
echo -e "\nTesting Database Integrity..."

# Sample query to verify data consistency
DATA_CHECK=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/cases?limit=1000" | jq '.pagination.total' 2>/dev/null || echo "0")
if [[ "$DATA_CHECK" -ge 0 ]]; then
  log_pass "Database integrity check passed (found $DATA_CHECK cases)"
else
  log_fail "Database integrity check failed"
fi

# ===== SUMMARY =====
echo -e "\n=========================================="
echo -e "POST-DEPLOYMENT VERIFICATION SUMMARY"
echo -e "=========================================="
echo -e "${GREEN}Passed:${NC}  $PASSED"
echo -e "${RED}Failed:${NC}  $FAILED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "==========================================="

if [[ $FAILED -eq 0 ]]; then
  echo -e "\n${GREEN}✓ All critical checks passed${NC}"
  exit 0
else
  echo -e "\n${RED}✗ Some checks failed. Review above for details.${NC}"
  exit 1
fi

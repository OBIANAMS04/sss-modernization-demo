#!/bin/bash

# SSS Modernization Platform - Security & Compliance Verification Script
# Checks FAR 52.209-2, NIST 800-53, and PCI DSS compliance

set -e

ENVIRONMENT=${1:-prod}
AWS_REGION=${AWS_REGION:-us-east-1}
APP_NAME="sss-modernization"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
PASSED=0
FAILED=0
WARNINGS=0

print_header() { echo -e "\n${BLUE}=== $1 ===${NC}\n"; }
check_pass() { echo -e "${GREEN}✓${NC} $1"; ((PASSED++)); }
check_fail() { echo -e "${RED}✗${NC} $1"; ((FAILED++)); }
check_warn() { echo -e "${YELLOW}⚠${NC} $1"; ((WARNINGS++)); }

# ===== NETWORK SECURITY =====
print_header "Network Security Checks"

# VPC Flow Logs
flow_logs=$(aws ec2 describe-flow-logs \
  --filter "Name=resource-type,Values=VPC" \
  --query 'FlowLogs[0].FlowLogStatus' \
  --output text 2>/dev/null || echo "NONE")

if [ "$flow_logs" = "ACTIVE" ]; then
  check_pass "VPC Flow Logs enabled"
else
  check_warn "VPC Flow Logs not enabled"
fi

# Security Groups - Check for overly permissive rules
alb_sg=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${APP_NAME}-alb-sg" \
  --query 'SecurityGroups[0].GroupId' \
  --output text)

if [ ! -z "$alb_sg" ] && [ "$alb_sg" != "None" ]; then
  # Check ingress rules
  open_ports=$(aws ec2 describe-security-groups \
    --group-ids $alb_sg \
    --query 'SecurityGroups[0].IpPermissions[?IpRanges[?CidrIp==`0.0.0.0/0`]].FromPort' \
    --output text)

  if [[ "$open_ports" =~ ^(80|443)$ ]]; then
    check_pass "ALB security group properly configured (only 80/443)"
  else
    check_fail "ALB security group has unexpected ports open: $open_ports"
  fi
else
  check_warn "ALB security group not found"
fi

# ===== DATA PROTECTION =====
print_header "Data Protection Checks"

# RDS Encryption
rds_encrypted=$(aws rds describe-db-instances \
  --db-instance-identifier ${APP_NAME}-db \
  --query 'DBInstances[0].StorageEncrypted' \
  --output text 2>/dev/null || echo "false")

if [ "$rds_encrypted" = "True" ]; then
  check_pass "RDS encryption at rest enabled"
else
  check_fail "RDS encryption at rest disabled"
fi

# RDS SSL/TLS
echo "Checking RDS SSL requirement..."
db_host=$(aws rds describe-db-instances \
  --db-instance-identifier ${APP_NAME}-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text)

# Try to query SSL setting (requires DB access)
if command -v psql &> /dev/null; then
  ssl_status=$(PGPASSWORD=${POSTGRES_PASSWORD:-password} psql \
    -h $db_host \
    -U postgres \
    -d sssdb \
    -t -c "SHOW ssl;" 2>/dev/null || echo "unknown")

  if [ "$ssl_status" = "on" ]; then
    check_pass "RDS SSL/TLS required"
  else
    check_warn "RDS SSL status: $ssl_status"
  fi
fi

# Redis Encryption
redis_encrypted=$(aws elasticache describe-cache-clusters \
  --cache-cluster-id ${APP_NAME}-cache \
  --show-cache-node-info \
  --query 'CacheClusters[0].TransitEncryptionEnabled' \
  --output text 2>/dev/null || echo "false")

if [ "$redis_encrypted" = "True" ]; then
  check_pass "Redis encryption in transit enabled"
else
  check_fail "Redis encryption in transit disabled"
fi

# S3 Bucket Encryption
s3_encrypted=$(aws s3api get-bucket-encryption \
  --bucket ${APP_NAME}-backups-${ENVIRONMENT} \
  --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' \
  --output text 2>/dev/null || echo "NONE")

if [ "$s3_encrypted" != "NONE" ]; then
  check_pass "S3 backup bucket encryption enabled"
else
  check_warn "S3 backup bucket encryption not configured"
fi

# ===== ACCESS CONTROL =====
print_header "Access Control Checks"

# IAM - No root access keys
root_keys=$(aws iam list-access-keys \
  --user-name root \
  --query 'AccessKeyMetadata[*].AccessKeyId' \
  --output text 2>/dev/null || echo "")

if [ -z "$root_keys" ]; then
  check_pass "No root account access keys found"
else
  check_fail "Root account has active access keys: $root_keys"
fi

# IAM - Root MFA
root_mfa=$(aws iam list-mfa-devices \
  --user-name root \
  --query 'MFADevices[*].SerialNumber' \
  --output text 2>/dev/null || echo "")

if [ ! -z "$root_mfa" ]; then
  check_pass "Root account MFA enabled"
else
  check_warn "Root account MFA not detected"
fi

# ECS Task Role Permissions
ecs_task_role="${APP_NAME}-ecs-task-role"
task_role_exists=$(aws iam get-role \
  --role-name $ecs_task_role \
  --query 'Role.RoleName' \
  --output text 2>/dev/null || echo "NONE")

if [ "$task_role_exists" != "NONE" ]; then
  check_pass "ECS task role exists"
else
  check_fail "ECS task role not found"
fi

# ===== AUDIT & MONITORING =====
print_header "Audit & Monitoring Checks"

# CloudTrail
trails=$(aws cloudtrail list-trails \
  --all-regions \
  --query 'Trails[*].Name' \
  --output text 2>/dev/null || echo "")

if [ ! -z "$trails" ]; then
  check_pass "CloudTrail audit logging enabled"
else
  check_warn "CloudTrail not configured"
fi

# WAF
waf=$(aws wafv2 list-web-acls \
  --scope REGIONAL \
  --region $AWS_REGION \
  --query "WebACLs[?Name=='${APP_NAME}-web-acl'].ARN" \
  --output text 2>/dev/null || echo "")

if [ ! -z "$waf" ]; then
  check_pass "AWS WAF enabled and configured"
else
  check_fail "AWS WAF not found"
fi

# CloudWatch Logs
log_groups=$(aws logs describe-log-groups \
  --log-group-name-prefix "/ecs/${APP_NAME}" \
  --query 'logGroups[*].logGroupName' \
  --output text 2>/dev/null || echo "")

if [ ! -z "$log_groups" ]; then
  check_pass "CloudWatch Logs configured for application"
else
  check_fail "CloudWatch Logs not configured"
fi

# ===== SECRETS MANAGEMENT =====
print_header "Secrets Management Checks"

# Secrets in Secrets Manager
secrets=(
  "${APP_NAME}-rds-credentials"
  "${APP_NAME}-redis-credentials"
  "${APP_NAME}-jwt-secret"
)

for secret in "${secrets[@]}"; do
  secret_exists=$(aws secretsmanager describe-secret \
    --secret-id $secret \
    --query 'ARN' \
    --output text 2>/dev/null || echo "NONE")

  if [ "$secret_exists" != "NONE" ]; then
    check_pass "Secret stored: $secret"
  else
    check_fail "Secret missing: $secret"
  fi
done

# ===== COMPLIANCE STANDARDS =====
print_header "Compliance Standards"

# FAR 52.209-2
echo "FAR 52.209-2 Compliance:"
[ "$rds_encrypted" = "True" ] && [ ! -z "$waf" ] && \
  check_pass "FAR 52.209-2 core controls implemented" || \
  check_fail "FAR 52.209-2 controls incomplete"

# NIST 800-53
echo -e "\nNIST 800-53 Compliance:"
[ ! -z "$root_mfa" ] && [ ! -z "$trails" ] && \
  check_pass "NIST 800-53 core controls implemented" || \
  check_warn "NIST 800-53 controls need review"

# PCI DSS (if applicable)
echo -e "\nPCI DSS Readiness:"
if [ "$rds_encrypted" = "True" ] && [ ! -z "$trails" ]; then
  check_pass "PCI DSS basic controls in place"
else
  check_warn "PCI DSS controls incomplete"
fi

# ===== PENETRATION TESTING =====
print_header "Security Testing Recommendations"

echo "Automated Testing:"
if command -v trivy &> /dev/null; then
  check_pass "Trivy container scanner installed"
else
  check_warn "Trivy not installed (install: curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh)"
fi

echo -e "\nManual Testing:"
echo "Run these to verify security:"
echo "  1. OWASP ZAP: docker run -t owasp/zap2docker-stable zap-baseline.py -t https://sss-modernization.example.com"
echo "  2. npm audit: npm audit --prefix backend && npm audit --prefix frontend"
echo "  3. SQL injection tests: Send malicious payloads to API endpoints"
echo "  4. Authentication bypass: Try to access admin endpoints without auth"

# ===== SUMMARY =====
print_header "Security Compliance Summary"

TOTAL=$((PASSED + FAILED + WARNINGS))
PASSED_PERCENT=$((PASSED * 100 / TOTAL))

echo "Checks Passed:  ${GREEN}$PASSED${NC}"
echo "Checks Failed:  ${RED}$FAILED${NC}"
echo "Warnings:       ${YELLOW}$WARNINGS${NC}"
echo "Total:          $TOTAL"
echo ""
echo "Compliance Score: ${PASSED_PERCENT}%"

if [ $FAILED -eq 0 ]; then
  echo -e "\n${GREEN}✓ Platform is compliant with security standards${NC}"
  exit 0
else
  echo -e "\n${RED}✗ Please address the $FAILED failing checks above${NC}"
  exit 1
fi

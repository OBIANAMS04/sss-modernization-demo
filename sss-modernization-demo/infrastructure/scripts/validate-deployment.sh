#!/bin/bash

# SSS Modernization Platform - Deployment Validation Script
# Validates all infrastructure components are deployed and healthy

set -e

ENVIRONMENT=${1:-prod}
AWS_REGION=${AWS_REGION:-us-east-1}
APP_NAME="sss-modernization"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
print_header() {
  echo -e "${BLUE}=== $1 ===${NC}\n"
}

test_check() {
  local name=$1
  local result=$2
  TESTS_RUN=$((TESTS_RUN + 1))

  if [ $result -eq 0 ]; then
    echo -e "${GREEN}✅ PASS${NC}: $name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}❌ FAIL${NC}: $name"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# Main validation flow
main() {
  print_header "SSS Modernization Platform - Deployment Validation"
  echo "Environment: $ENVIRONMENT"
  echo "Region: $AWS_REGION"
  echo ""

  # VPC Validation
  print_header "1. VPC Configuration"

  vpc_id=$(aws ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=${APP_NAME}-vpc" \
    --query 'Vpcs[0].VpcId' \
    --output text 2>/dev/null || echo "")

  [ -n "$vpc_id" ] && [ "$vpc_id" != "None" ]
  test_check "VPC exists" $?

  if [ -n "$vpc_id" ] && [ "$vpc_id" != "None" ]; then
    # Check subnets
    subnet_count=$(aws ec2 describe-subnets \
      --filters "Name=vpc-id,Values=$vpc_id" \
      --query 'length(Subnets)' \
      --output text)

    [ "$subnet_count" -eq 4 ]
    test_check "4 Subnets configured (2 public, 2 private)" $?

    # Check Internet Gateway
    igw=$(aws ec2 describe-internet-gateways \
      --filters "Name=attachment.vpc-id,Values=$vpc_id" \
      --query 'InternetGateways[0].InternetGatewayId' \
      --output text 2>/dev/null || echo "")

    [ -n "$igw" ] && [ "$igw" != "None" ]
    test_check "Internet Gateway attached" $?

    # Check NAT Gateway
    nat=$(aws ec2 describe-nat-gateways \
      --filter "Name=vpc-id,Values=$vpc_id" \
      --query 'NatGateways[0].NatGatewayId' \
      --output text 2>/dev/null || echo "")

    [ -n "$nat" ] && [ "$nat" != "None" ]
    test_check "NAT Gateway configured" $?
  fi

  # Security Groups Validation
  print_header "2. Security Groups"

  for sg_name in "alb-sg" "ecs-sg" "rds-sg" "elasticache-sg"; do
    sg=$(aws ec2 describe-security-groups \
      --filters "Name=group-name,Values=${APP_NAME}-${sg_name}" \
      --query 'SecurityGroups[0].GroupId' \
      --output text 2>/dev/null || echo "")

    [ -n "$sg" ] && [ "$sg" != "None" ]
    test_check "Security group exists: $sg_name" $?
  done

  # RDS Validation
  print_header "3. RDS Database"

  rds=$(aws rds describe-db-instances \
    --db-instance-identifier ${APP_NAME}-db \
    --query 'DBInstances[0]' \
    --output json 2>/dev/null || echo "{}")

  db_available=$(echo "$rds" | jq -r '.DBInstanceStatus' 2>/dev/null)
  [ "$db_available" = "available" ]
  test_check "RDS instance available" $?

  db_encrypted=$(echo "$rds" | jq -r '.StorageEncrypted' 2>/dev/null)
  [ "$db_encrypted" = "true" ]
  test_check "RDS encryption enabled" $?

  db_multi_az=$(echo "$rds" | jq -r '.MultiAZ' 2>/dev/null)
  [ "$db_multi_az" = "true" ]
  test_check "RDS Multi-AZ enabled" $?

  db_backup=$(echo "$rds" | jq -r '.BackupRetentionPeriod' 2>/dev/null)
  [ "$db_backup" -ge 30 ]
  test_check "RDS backup retention >= 30 days" $?

  # Test Database Connectivity
  if [ -n "$rds" ] && [ "$db_available" = "available" ]; then
    db_host=$(echo "$rds" | jq -r '.Endpoint.Address' 2>/dev/null)
    db_port=$(echo "$rds" | jq -r '.Endpoint.Port' 2>/dev/null)

    timeout 5 bash -c "echo > /dev/tcp/$db_host/$db_port" 2>/dev/null
    test_check "RDS connectivity" $?
  fi

  # ElastiCache Validation
  print_header "4. ElastiCache Redis"

  redis=$(aws elasticache describe-cache-clusters \
    --cache-cluster-id ${APP_NAME}-cache \
    --show-cache-node-info \
    --query 'CacheClusters[0]' \
    --output json 2>/dev/null || echo "{}")

  redis_available=$(echo "$redis" | jq -r '.CacheClusterStatus' 2>/dev/null)
  [ "$redis_available" = "available" ]
  test_check "Redis cluster available" $?

  redis_encrypted=$(echo "$redis" | jq -r '.AtRestEncryptionEnabled' 2>/dev/null)
  [ "$redis_encrypted" = "true" ]
  test_check "Redis encryption enabled" $?

  redis_transit=$(echo "$redis" | jq -r '.TransitEncryptionEnabled' 2>/dev/null)
  [ "$redis_transit" = "true" ]
  test_check "Redis transit encryption enabled" $?

  # Test Redis Connectivity
  if [ -n "$redis" ] && [ "$redis_available" = "available" ]; then
    redis_host=$(echo "$redis" | jq -r '.CacheNodes[0].Address' 2>/dev/null)
    redis_port=$(echo "$redis" | jq -r '.CacheNodes[0].Port' 2>/dev/null)

    timeout 5 bash -c "echo > /dev/tcp/$redis_host/$redis_port" 2>/dev/null
    test_check "Redis connectivity" $?
  fi

  # ECS Validation
  print_header "5. ECS Cluster"

  cluster=$(aws ecs describe-clusters \
    --clusters ${APP_NAME}-cluster \
    --query 'clusters[0]' \
    --output json 2>/dev/null || echo "{}")

  cluster_arn=$(echo "$cluster" | jq -r '.clusterArn' 2>/dev/null)
  [ -n "$cluster_arn" ] && [ "$cluster_arn" != "null" ]
  test_check "ECS cluster exists" $?

  # Check Services
  for service in "backend-service" "frontend-service"; do
    service_info=$(aws ecs describe-services \
      --cluster ${APP_NAME}-cluster \
      --services ${APP_NAME}-${service} \
      --query 'services[0]' \
      --output json 2>/dev/null || echo "{}")

    status=$(echo "$service_info" | jq -r '.status' 2>/dev/null)
    [ "$status" = "ACTIVE" ]
    test_check "ECS service active: $service" $?

    running=$(echo "$service_info" | jq -r '.runningCount' 2>/dev/null)
    desired=$(echo "$service_info" | jq -r '.desiredCount' 2>/dev/null)
    [ "$running" -eq "$desired" ]
    test_check "ECS tasks healthy ($running/$desired): $service" $?
  done

  # Load Balancer Validation
  print_header "6. Application Load Balancer"

  alb=$(aws elbv2 describe-load-balancers \
    --names ${APP_NAME}-alb \
    --query 'LoadBalancers[0]' \
    --output json 2>/dev/null || echo "{}")

  alb_state=$(echo "$alb" | jq -r '.State.Code' 2>/dev/null)
  [ "$alb_state" = "active" ]
  test_check "ALB is active" $?

  alb_dns=$(echo "$alb" | jq -r '.DNSName' 2>/dev/null)
  echo "ALB DNS Name: $alb_dns"

  # Test ALB Health
  if [ -n "$alb_dns" ] && [ "$alb_dns" != "null" ]; then
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      http://$alb_dns/api/health 2>/dev/null || echo "0")

    [ "$http_code" = "200" ] || [ "$http_code" = "401" ]
    test_check "ALB backend health check (HTTP $http_code)" $?

    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      http://$alb_dns/ 2>/dev/null || echo "0")

    [ "$http_code" = "200" ] || [ "$http_code" = "302" ]
    test_check "ALB frontend health check (HTTP $http_code)" $?
  fi

  # CloudWatch Logs Validation
  print_header "7. CloudWatch Monitoring"

  log_groups=(
    "/ecs/${APP_NAME}"
    "/aws/rds/instance/${APP_NAME}-db"
    "/aws/elasticache/${APP_NAME}/engine"
    "/aws/waf/${APP_NAME}"
  )

  for lg in "${log_groups[@]}"; do
    aws logs describe-log-groups \
      --log-group-name-prefix "$lg" \
      --query 'logGroups[0].logGroupName' \
      --output text 2>/dev/null | grep -q "$lg"
    test_check "CloudWatch log group exists: $lg" $?
  done

  # WAF Validation
  print_header "8. AWS WAF"

  waf=$(aws wafv2 list-web-acls \
    --scope REGIONAL \
    --region $AWS_REGION \
    --query "WebACLs[?Name=='${APP_NAME}-web-acl'].ARN" \
    --output text 2>/dev/null || echo "")

  [ -n "$waf" ]
  test_check "WAF Web ACL exists" $?

  # IAM Roles Validation
  print_header "9. IAM Permissions"

  for role in "ecs-task-execution-role" "ecs-task-role"; do
    aws iam get-role \
      --role-name ${APP_NAME}-${role} \
      --query 'Role.RoleId' \
      --output text 2>/dev/null | grep -q .
    test_check "IAM role exists: $role" $?
  done

  # Secrets Manager Validation
  print_header "10. Secrets & Credentials"

  for secret in "rds-credentials" "redis-credentials" "jwt-secret"; do
    aws secretsmanager describe-secret \
      --secret-id ${APP_NAME}-${secret} \
      --query 'ARN' \
      --output text 2>/dev/null | grep -q arn:aws
    test_check "Secret stored: $secret" $?
  done

  # Final Summary
  print_header "Validation Summary"
  echo "Total Tests: $TESTS_RUN"
  echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
  [ $TESTS_FAILED -gt 0 ] && echo -e "${RED}Failed: $TESTS_FAILED${NC}" || echo -e "${GREEN}Failed: 0${NC}"

  echo ""
  if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}=== ALL VALIDATION CHECKS PASSED ===${NC}"
    return 0
  else
    echo -e "${RED}=== VALIDATION CHECKS FAILED ===${NC}"
    echo "Failed tests: $TESTS_FAILED"
    return 1
  fi
}

# Run validation
main

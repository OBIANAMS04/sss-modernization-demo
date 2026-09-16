# Disaster Recovery Testing Procedures

## Overview

This document outlines disaster recovery (DR) testing procedures for the SSS Modernization Platform. Tests validate RTO/RPO targets and ensure system resilience.

**Targets:**
- RTO (Recovery Time Objective): 15 minutes
- RPO (Recovery Point Objective): 1 hour

## Pre-Test Checklist

- [ ] Notify all stakeholders of scheduled DR test
- [ ] Schedule test during off-peak hours
- [ ] Have rollback plan documented and ready
- [ ] Verify current database backups exist
- [ ] Ensure CloudWatch monitoring is active
- [ ] Document baseline metrics (CPU, latency, connections)
- [ ] Have AWS credentials ready
- [ ] Have terraform state backup

## Test 1: Database Failure & Recovery

**Objective:** Validate RDS automated failover and restore procedures

**Procedure:**

### Step 1: Document Baseline
```bash
# Record current database metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=sss-modernization-db \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average > baseline-db-connections.json

# Record application response times
aws logs filter-log-events \
  --log-group-name /ecs/sss-modernization \
  --filter-pattern "[timestamp, request_id, duration, status]" \
  --start-time $(($(date +%s)*1000 - 3600000)) \
  --end-time $(($(date +%s)*1000)) > baseline-latency.json
```

### Step 2: Initiate Failover
```bash
# Reboot RDS instance (forces Multi-AZ failover)
aws rds reboot-db-instance \
  --db-instance-identifier sss-modernization-db \
  --force

# Note the reboot start time
FAILOVER_START=$(date +%s)
```

### Step 3: Monitor Recovery
```bash
# Poll instance status until available
while true; do
  STATUS=$(aws rds describe-db-instances \
    --db-instance-identifier sss-modernization-db \
    --query 'DBInstances[0].DBInstanceStatus' \
    --output text)
  
  if [ "$STATUS" = "available" ]; then
    FAILOVER_END=$(date +%s)
    echo "Database available after $((FAILOVER_END - FAILOVER_START)) seconds"
    break
  fi
  
  echo "Status: $STATUS... waiting"
  sleep 10
done
```

### Step 4: Verify Data Integrity
```bash
# Connect to database and verify tables exist
PGPASSWORD=$RDS_PASSWORD psql \
  --host $(aws rds describe-db-instances \
    --db-instance-identifier sss-modernization-db \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text) \
  --username postgres \
  --dbname sssdb \
  --command "SELECT COUNT(*) FROM users;"

# Compare row counts with baseline
CURRENT_COUNT=$(psql -t -c "SELECT COUNT(*) FROM users;")
echo "Current user count: $CURRENT_COUNT"
```

### Step 5: Test Application Connectivity
```bash
# Health check endpoint
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --names sss-modernization-alb \
  --query 'LoadBalancers[0].DNSName' \
  --output text)

# Loop health check for 5 minutes
END_TIME=$(($(date +%s) + 300))
while [ $(date +%s) -lt $END_TIME ]; do
  curl -f http://$ALB_DNS/api/health && \
    echo "✅ Health check passed at $(date)" || \
    echo "❌ Health check failed at $(date)"
  sleep 10
done
```

### Step 6: Compare Metrics
```bash
# Compare post-failover metrics with baseline
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=sss-modernization-db \
  --start-time $(date -u -d '15 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average > post-failover-connections.json

# Compare in Python/Node
cat > compare-metrics.py << 'EOF'
import json

with open('baseline-db-connections.json') as f:
    baseline = json.load(f)
with open('post-failover-connections.json') as f:
    post_failover = json.load(f)

baseline_avg = sum(d['Average'] for d in baseline['Datapoints']) / len(baseline['Datapoints'])
post_avg = sum(d['Average'] for d in post_failover['Datapoints']) / len(post_failover['Datapoints'])

print(f"Baseline connections: {baseline_avg:.2f}")
print(f"Post-failover connections: {post_avg:.2f}")
print(f"Difference: {abs(baseline_avg - post_avg):.2f}")

if abs(baseline_avg - post_avg) < 5:
    print("✅ PASS: Connection recovery successful")
else:
    print("❌ FAIL: Unusual connection pattern detected")
EOF

python3 compare-metrics.py
```

**Success Criteria:**
- [ ] RDS failover completes < 5 minutes
- [ ] Application reconnects automatically
- [ ] No data loss (row counts match)
- [ ] Connection counts return to baseline
- [ ] Health checks pass within 15 minutes total

**Result:** _____________

---

## Test 2: Application Service Failure

**Objective:** Validate ECS auto-recovery and load balancer failover

**Procedure:**

### Step 1: Get Current Tasks
```bash
# List running backend tasks
aws ecs list-tasks \
  --cluster sss-modernization-cluster \
  --service-name sss-modernization-backend-service \
  --desired-status RUNNING
```

### Step 2: Terminate a Task
```bash
# Stop one running task (simulates service failure)
TASK_ARN=$(aws ecs list-tasks \
  --cluster sss-modernization-cluster \
  --service-name sss-modernization-backend-service \
  --desired-status RUNNING \
  --query 'taskArns[0]' \
  --output text)

START_TIME=$(date +%s)

aws ecs stop-task \
  --cluster sss-modernization-cluster \
  --task $TASK_ARN \
  --reason "DR testing"

echo "Stopped task: $TASK_ARN"
```

### Step 3: Monitor Recovery
```bash
# Poll until desired count restored
while true; do
  RUNNING=$(aws ecs describe-services \
    --cluster sss-modernization-cluster \
    --services sss-modernization-backend-service \
    --query 'services[0].runningCount' \
    --output text)
  
  DESIRED=$(aws ecs describe-services \
    --cluster sss-modernization-cluster \
    --services sss-modernization-backend-service \
    --query 'services[0].desiredCount' \
    --output text)
  
  if [ "$RUNNING" -eq "$DESIRED" ]; then
    END_TIME=$(date +%s)
    RECOVERY_TIME=$((END_TIME - START_TIME))
    echo "✅ Service recovered in $RECOVERY_TIME seconds"
    break
  fi
  
  echo "Running: $RUNNING / Desired: $DESIRED"
  sleep 5
done
```

### Step 4: Verify Traffic Routing
```bash
# Confirm new task is healthy
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --names sss-modernization-alb \
  --query 'LoadBalancers[0].DNSName' \
  --output text)

# Health checks on target
for i in {1..10}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    http://$ALB_DNS/api/health)
  echo "Health check $i: HTTP $HTTP_CODE"
  [ "$HTTP_CODE" = "200" ] && break
  sleep 2
done
```

### Step 5: Verify No Data Loss
```bash
# Check case management data consistency
curl -s -H "Authorization: Bearer $JWT_TOKEN" \
  http://$ALB_DNS/api/cases \
  | jq '.length' > post-recovery-case-count.txt

# Compare with pre-failure
echo "Case count before: $(cat pre-failure-case-count.txt)"
echo "Case count after: $(cat post-recovery-case-count.txt)"
```

**Success Criteria:**
- [ ] ECS replaces terminated task < 30 seconds
- [ ] New task becomes healthy < 60 seconds
- [ ] Traffic routes to new task automatically
- [ ] No requests fail during transition
- [ ] Data integrity maintained

**Result:** _____________

---

## Test 3: Cache Failure & Recovery

**Objective:** Validate Redis failover and application cache invalidation

**Procedure:**

### Step 1: Baseline Cache Performance
```bash
# Measure cache hit rate
aws logs filter-log-events \
  --log-group-name /ecs/sss-modernization \
  --filter-pattern "CACHE_HIT" \
  --start-time $(($(date +%s)*1000 - 300000)) \
  --end-time $(($(date +%s)*1000)) > baseline-cache-hits.json

CACHE_HITS=$(jq '.events | length' baseline-cache-hits.json)
echo "Cache hits (last 5 min): $CACHE_HITS"
```

### Step 2: Simulate Cache Failure
```bash
# Disable cache access (connection limit)
aws elasticache modify-cache-cluster \
  --cache-cluster-id sss-modernization-cache \
  --security-group-ids $(aws ec2 describe-security-groups \
    --filter "Name=group-name,Values=sss-modernization-elasticache-sg" \
    --query 'SecurityGroups[0].GroupId' \
    --output text) \
  --apply-immediately

START_TIME=$(date +%s)
echo "Cache isolation started"
```

### Step 3: Monitor Application Behavior
```bash
# Application should fall back to database
for i in {1..30}; do
  LATENCY=$(curl -s -D - http://$ALB_DNS/api/cases \
    | grep "x-latency" || echo "0")
  
  echo "Request $i - Latency: $LATENCY ms"
  sleep 1
done
```

### Step 4: Restore Cache
```bash
# Re-enable cache access
aws elasticache modify-cache-cluster \
  --cache-cluster-id sss-modernization-cache \
  --apply-immediately

# Monitor cache warming
WAIT_TIME=0
while [ $WAIT_TIME -lt 120 ]; do
  CONNECTED=$(aws elasticache describe-cache-clusters \
    --cache-cluster-id sss-modernization-cache \
    --show-cache-node-info \
    --query 'CacheClusters[0].CacheNodes[0].CacheNodeStatus' \
    --output text)
  
  if [ "$CONNECTED" = "available" ]; then
    END_TIME=$(date +%s)
    RECOVERY_TIME=$((END_TIME - START_TIME))
    echo "✅ Cache recovered in $RECOVERY_TIME seconds"
    break
  fi
  
  sleep 10
  WAIT_TIME=$((WAIT_TIME + 10))
done
```

### Step 5: Verify Cache Performance Restored
```bash
# Measure post-recovery cache hit rate
aws logs filter-log-events \
  --log-group-name /ecs/sss-modernization \
  --filter-pattern "CACHE_HIT" \
  --start-time $(($(date +%s)*1000 - 300000)) \
  --end-time $(($(date +%s)*1000)) > post-recovery-cache-hits.json

NEW_CACHE_HITS=$(jq '.events | length' post-recovery-cache-hits.json)
echo "Cache hits after recovery: $NEW_CACHE_HITS"

# Performance should return to baseline
if [ $NEW_CACHE_HITS -gt $((CACHE_HITS * 80 / 100)) ]; then
  echo "✅ Cache performance restored"
else
  echo "⚠️ Cache performance degraded"
fi
```

**Success Criteria:**
- [ ] Application continues functioning during cache outage
- [ ] Response times increase (acceptable degradation)
- [ ] Cache recovery completes < 5 minutes
- [ ] Cache hit rate returns to baseline
- [ ] No requests fail

**Result:** _____________

---

## Test 4: ALB Failure & Multi-AZ Recovery

**Objective:** Validate ALB availability and target group failover

**Procedure:**

### Step 1: Document Active Targets
```bash
# List healthy targets
aws elbv2 describe-target-health \
  --target-group-arn $(aws elbv2 describe-target-groups \
    --names sss-modernization-backend-tg \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text) > baseline-targets.json

cat baseline-targets.json | jq '.TargetHealthDescriptions | length'
```

### Step 2: Deregister Target
```bash
# Remove one target from ALB
TARGET_IP=$(jq -r '.TargetHealthDescriptions[0].Target.Id' baseline-targets.json)
TARGET_PORT=$(jq -r '.TargetHealthDescriptions[0].Target.Port' baseline-targets.json)
TARGET_GROUP=$(aws elbv2 describe-target-groups \
  --names sss-modernization-backend-tg \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text)

aws elbv2 deregister-targets \
  --target-group-arn $TARGET_GROUP \
  --targets Id=$TARGET_IP,Port=$TARGET_PORT

START_TIME=$(date +%s)
echo "Target deregistered: $TARGET_IP:$TARGET_PORT"
```

### Step 3: Monitor Traffic Rerouting
```bash
# Measure connection distribution
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --names sss-modernization-alb \
  --query 'LoadBalancers[0].DNSName' \
  --output text)

# Send 100 requests and track responses
for i in {1..100}; do
  curl -s http://$ALB_DNS/api/health > /dev/null &
done
wait

# Verify all requests succeeded
FAILED=$(grep -c "Connection refused" /tmp/responses.log || echo 0)
echo "Failed requests: $FAILED"
```

### Step 4: Re-register Target
```bash
# Restore target
aws elbv2 register-targets \
  --target-group-arn $TARGET_GROUP \
  --targets Id=$TARGET_IP,Port=$TARGET_PORT

# Wait for target to become healthy
while true; do
  STATE=$(aws elbv2 describe-target-health \
    --target-group-arn $TARGET_GROUP \
    --targets Id=$TARGET_IP,Port=$TARGET_PORT \
    --query 'TargetHealthDescriptions[0].TargetHealth.State' \
    --output text)
  
  if [ "$STATE" = "healthy" ]; then
    END_TIME=$(date +%s)
    RECOVERY_TIME=$((END_TIME - START_TIME))
    echo "✅ Target restored and healthy in $RECOVERY_TIME seconds"
    break
  fi
  
  echo "State: $STATE"
  sleep 5
done
```

**Success Criteria:**
- [ ] Traffic reroutes automatically within 10 seconds
- [ ] No requests fail during failover
- [ ] Target health check detects failure
- [ ] Target reintegration completes < 60 seconds
- [ ] Connection distribution balanced

**Result:** _____________

---

## Test 5: Complete Regional Failover (Quarterly)

**Objective:** Full disaster recovery test with infrastructure rebuild

**Prerequisites:**
- Scheduled for weekend with stakeholder approval
- 4-hour maintenance window
- Full backup verified

**Procedure:**

1. Create infrastructure snapshot
2. Destroy current infrastructure
3. Rebuild from Terraform (different AZ)
4. Restore database from backup
5. Deploy applications
6. Verify all systems operational
7. Validate data integrity
8. Document lessons learned

**Timeline:**
- Backup creation: 5 minutes
- Infrastructure destruction: 5 minutes
- Infrastructure rebuild: 10 minutes
- Database restore: 20 minutes
- Application deployment: 5 minutes
- Validation: 15 minutes
- **Total: ~60 minutes**

---

## Test 6: Backup Restore Validation

**Objective:** Verify backups can be restored successfully

**Monthly Procedure:**

```bash
# Create snapshot of current database
aws rds create-db-snapshot \
  --db-instance-identifier sss-modernization-db \
  --db-snapshot-identifier sss-modernization-backup-$(date +%Y%m%d)

# Restore to temporary instance
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier sss-modernization-db-restore-test \
  --db-snapshot-identifier sss-modernization-backup-$(date +%Y%m%d)

# Verify data
PGPASSWORD=$TEST_PASSWORD psql \
  --host $(aws rds describe-db-instances \
    --db-instance-identifier sss-modernization-db-restore-test \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text) \
  --username postgres \
  --dbname sssdb \
  --command "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM cases;"

# Cleanup
aws rds delete-db-instance \
  --db-instance-identifier sss-modernization-db-restore-test \
  --skip-final-snapshot
```

---

## Post-Test Documentation

**For each test, document:**

1. **Test Date/Time:** _____________
2. **RTO Achieved:** _____________ (Target: < 15 min)
3. **RPO Achieved:** _____________ (Target: < 1 hour)
4. **Issues Encountered:** _____________
5. **Workarounds Applied:** _____________
6. **Root Causes:** _____________
7. **Improvements Made:** _____________
8. **Stakeholder Sign-off:** _____________

---

## Escalation Contacts

| Role | Name | Phone | Email |
|------|------|-------|-------|
| Infrastructure Lead | [Name] | [Phone] | [Email] |
| On-Call Engineer | [Name] | [Phone] | [Email] |
| CISO | [Name] | [Phone] | [Email] |

---

## Appendix: Quick Recovery Commands

### Database Recovery
```bash
# Restore from most recent snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier sss-modernization-db \
  --db-snapshot-identifier $(aws rds describe-db-snapshots \
    --db-instance-identifier sss-modernization-db-prod \
    --query 'DBSnapshots[0].DBSnapshotIdentifier' \
    --output text)
```

### Service Recovery
```bash
# Force new deployment
aws ecs update-service \
  --cluster sss-modernization-cluster \
  --service sss-modernization-backend-service \
  --force-new-deployment
```

### Infrastructure Recovery
```bash
# Terraform destroy + apply
cd infrastructure/terraform
terraform destroy -auto-approve
terraform apply -var-file=prod.tfvars -auto-approve
```

---

**Document Version:** 1.0
**Last Updated:** 2024-08-04
**Next Review:** 2024-11-04

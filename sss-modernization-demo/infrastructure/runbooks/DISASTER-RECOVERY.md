# Disaster Recovery Runbook

**RTO (Recovery Time Objective):** 30 minutes  
**RPO (Recovery Point Objective):** <5 minutes  

## Multi-Region Architecture

```
PRIMARY REGION (us-east-1)          SECONDARY REGION (us-west-2)
┌─────────────────────────────┐     ┌──────────────────────────────┐
│ Production Environment      │     │ Standby/DR Environment       │
│                             │     │                              │
│ ┌─────────────┐             │     │ ┌──────────────┐             │
│ │ ALB/Route53 │────────────────────→ │ ALB (Passive)│             │
│ └─────────────┘             │     │ └──────────────┘             │
│       ↓                     │     │       ↓                      │
│ ┌─────────────┐             │     │ ┌──────────────┐             │
│ │ ECS Cluster │ (Active)    │     │ │ ECS Cluster  │ (Standby)   │
│ │ 4 tasks     │             │     │ │ 0-1 tasks    │             │
│ └─────────────┘             │     │ └──────────────┘             │
│       ↓                     │     │       ↓                      │
│ ┌─────────────┐             │     │ ┌──────────────┐             │
│ │ RDS Primary │─────Async Replication──→ │ RDS Replica  │             │
│ └─────────────┘             │     │ └──────────────┘             │
│       ↓                     │     │       ↓                      │
│ ┌─────────────┐             │     │ ┌──────────────┐             │
│ │ Redis Prim. │─────Async Replication──→ │ Redis Replica│             │
│ └─────────────┘             │     │ └──────────────┘             │
│       ↓                     │     │                              │
│ ┌─────────────┐             │     │                              │
│ │ S3 Backups  │─────S3 Replication──────→ S3 Backups (Secondary)    │
│ └─────────────┘             │     │                              │
└─────────────────────────────┘     └──────────────────────────────┘
```

## Failover Decision Tree

```
DETECT ISSUE
     ↓
Is PRIMARY REGION down?
  ├─ NO → Investigate locally (not DR)
  └─ YES → Continue
         ↓
    Confirm via AWS Status Page
         ↓
    Alert team: #sss-incidents Slack channel
         ↓
    Gather metrics:
    - Replication lag
    - Data consistency
    - Secondary readiness
         ↓
    DECISION: Failover to secondary?
      ├─ NO → Wait for primary recovery
      └─ YES → Execute failover procedure
             ↓
          Promote secondary DB
             ↓
          Promote secondary cache
             ↓
          Update Route53/DNS
             ↓
          Deploy to secondary ECS
             ↓
          Validate application
             ↓
          Notify stakeholders
             ↓
          Document timeline
```

## Step-by-Step Failover Procedure

### Phase 1: Detection & Assessment (0-5 minutes)

```bash
# Step 1: Confirm primary region outage
aws ec2 describe-instances \
  --region us-east-1 \
  --query 'Reservations[].Instances[].State' \
  # Expected: All instances stopped or error

# Step 2: Check AWS Health Dashboard
open https://health.aws.amazon.com/

# Step 3: Check replication status
aws rds describe-db-instances \
  --region us-west-2 \
  --db-instance-identifier sss-modernization-db-secondary \
  --query 'DBInstances[0].[DBInstanceStatus, LatestRestorableTime]'

# Step 4: Verify data recency
# Expected: LatestRestorableTime should be <5 minutes ago

# Step 5: Alert on-call team
# Post to #sss-incidents: "P0: Primary region down, initiating failover procedure"
```

### Phase 2: Promote Secondary Database (5-15 minutes)

```bash
# Step 1: Promote RDS read replica to standalone
aws rds promote-read-replica \
  --db-instance-identifier sss-modernization-db-secondary \
  --backup-retention-period 7 \
  --region us-west-2

# This takes 5-10 minutes

# Step 2: Monitor promotion progress
aws rds describe-db-instances \
  --region us-west-2 \
  --db-instance-identifier sss-modernization-db-secondary \
  --query 'DBInstances[0].DBInstanceStatus' \
  # Watch for: "backing-up" → "available"

# Step 3: Verify data integrity
PGPASSWORD=$DB_PASSWORD psql \
  -h sss-modernization-db-secondary.XXXXX.us-west-2.rds.amazonaws.com \
  -U postgres \
  -d sssdb \
  -c "SELECT COUNT(*) FROM users; SELECT MAX(created_at) FROM audit_logs;"

# Should show expected record counts
```

### Phase 3: Promote Secondary Cache (15-20 minutes)

```bash
# Step 1: Verify Redis read replica is in sync
redis-cli -h <secondary-redis-endpoint> INFO replication
# Expected: role:master or replica:synced

# Step 2: If using read replica, promote it
aws elasticache modify-replication-group \
  --replication-group-id sss-modernization-cache-secondary \
  --automatic-failover-enabled \
  --region us-west-2

# Step 3: Verify Redis is healthy
redis-cli -h <secondary-redis-endpoint> PING
# Expected: PONG
```

### Phase 4: Update DNS & Route53 (20-25 minutes)

```bash
# Step 1: Check current Route53 configuration
aws route53 list-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --query 'ResourceRecordSets[?Name==`sss-modernization.example.com`]'

# Step 2: Update weighted routing (shift 100% to secondary)
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch file:///tmp/failover-change-batch.json

# Content of failover-change-batch.json:
# {
#   "Changes": [
#     {
#       "Action": "UPSERT",
#       "ResourceRecordSet": {
#         "Name": "sss-modernization.example.com",
#         "Type": "A",
#         "AliasTarget": {
#           "HostedZoneId": "Z35SXDOTRQ7X7K",
#           "DNSName": "secondary-alb.XXXXX.us-west-2.elb.amazonaws.com",
#           "EvaluateTargetHealth": true
#         },
#         "SetIdentifier": "secondary-region",
#         "Weight": 100
#       }
#     }
#   ]
# }

# Step 3: Wait for DNS propagation (typically 2-5 minutes)
# Verify with:
nslookup sss-modernization.example.com
# Should resolve to secondary region IP
```

### Phase 5: Deploy to Secondary ECS (25-30 minutes)

```bash
# Step 1: Update backend secrets to point to secondary DB/Redis
aws secretsmanager update-secret \
  --secret-id sss-modernization-rds-credentials \
  --region us-west-2 \
  --secret-string '{
    "host": "sss-modernization-db-secondary.XXXXX.us-west-2.rds.amazonaws.com",
    "port": 5432,
    "username": "postgres",
    "password": "'$NEW_DB_PASSWORD'"
  }'

aws secretsmanager update-secret \
  --secret-id sss-modernization-redis-credentials \
  --region us-west-2 \
  --secret-string '{
    "host": "secondary-redis.XXXXX.ng.0001.usw2.cache.amazonaws.com",
    "port": 6379,
    "password": "'$REDIS_PASSWORD'"
  }'

# Step 2: Deploy to ECS in secondary region
aws ecs update-service \
  --cluster sss-modernization-secondary \
  --service sss-modernization-backend \
  --desired-count 2 \
  --region us-west-2 \
  --force-new-deployment

# Step 3: Monitor ECS task startup
aws ecs describe-tasks \
  --cluster sss-modernization-secondary \
  --region us-west-2 \
  --tasks $(aws ecs list-tasks --cluster sss-modernization-secondary --region us-west-2 --query 'taskArns[0:2]' --output text) \
  --query 'tasks[*].[lastStatus, stopCode]'

# Wait for all tasks to be RUNNING
```

### Phase 6: Validation (30 minutes total)

```bash
# Step 1: Health check
curl -I https://sss-modernization.example.com/api/health
# Expected: HTTP 200

# Step 2: Run smoke tests
npm run test:smoke -- --url https://sss-modernization.example.com

# Step 3: Spot check data
curl -H "Authorization: Bearer $TEST_TOKEN" \
  https://sss-modernization.example.com/api/cases \
  | jq '.data | length'
# Should return active cases

# Step 4: Monitor metrics for 5 minutes
# Check CloudWatch dashboards for:
# - Error rate < 0.5%
# - Latency p95 < 1000ms
# - No database connection errors

# Step 5: Notify stakeholders
# Post to #sss-incidents: "✅ Failover complete. Secondary region is now active."
```

## Recovery (Returning to Primary)

### Phase 1: Investigate Primary Outage (Ongoing)

```bash
# Once primary region is restored:

# Step 1: Verify infrastructure is healthy
aws ec2 describe-instances \
  --region us-east-1 \
  --query 'Reservations[].Instances[].State'

# Step 2: Restore RDS from backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier sss-modernization-db-restored \
  --db-snapshot-identifier <latest-snapshot-id> \
  --region us-east-1

# Step 3: Restore Redis from backup
aws elasticache create-replication-group \
  --replication-group-description "Restored primary Redis" \
  --engine redis \
  --cache-node-type cache.t3.medium \
  --num-cache-clusters 2 \
  --region us-east-1
```

### Phase 2: Switchback to Primary

```bash
# Step 1: Update Route53 to primary region (50% traffic initially)
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch file:///tmp/switchback-batch.json

# Increase to 100% over 15-30 minutes to ensure stability

# Step 2: Re-establish replication
# Configure secondary as read replica again (following multi-region.tf)

# Step 3: Monitor for 1 hour
# Watch for any errors or inconsistencies
```

## Checklist for After Failover

- [ ] All critical business functions verified working
- [ ] Data integrity confirmed (no missing records)
- [ ] Compliance checks passing
- [ ] Performance metrics normal
- [ ] Backups running successfully
- [ ] Team notified of status
- [ ] Post-mortem scheduled for next business day
- [ ] Root cause analysis started
- [ ] Lessons learned documented

## Automation (Optional: Use Fault Injection Simulator)

```bash
# AWS FIS can automatically trigger failover if configured
aws fis create-experiment-template \
  --description "Failover to secondary region" \
  --actions \
    "stop-instances={targets={Instances=[all-primary-instances]},parameters={}}" \
  --stop-conditions \
    "aws:cloudwatch:alarm-state-for-duration={duration=5m,alarmNames=[arn:aws:cloudwatch:...]}"
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-06  
**Testing Schedule:** Quarterly failover drills  
**Contact:** Platform SRE Team

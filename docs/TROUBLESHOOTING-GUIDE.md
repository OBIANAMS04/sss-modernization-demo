# #42: Troubleshooting Guide

## Overview

Common issues and solutions for the SSS Modernization Platform.

---

## Application Issues

### 1. API Returning 500 Errors

**Symptom:** Random 500 Internal Server Error responses

**Diagnosis:**
```bash
# Check application logs
aws logs tail /aws/ecs/sss-modernization --follow

# Check recent errors
grep "ERROR" app.log | tail -20

# Check database connections
SELECT count(*) FROM pg_stat_activity WHERE datname = 'sss';
```

**Solutions:**
- **Database connection pool exhausted:** Increase `pool.max` in connection config
- **Memory leak:** Restart ECS task (triggers auto-rollback if error rate spikes)
- **Unhandled async error:** Check error boundary in middleware

### 2. API Timeout (504)

**Symptom:** Requests timeout after 60 seconds (ALB timeout)

**Diagnosis:**
```bash
# Check request duration distribution
aws cloudwatch get-metric-statistics \
  --namespace SSS/API \
  --metric-name RequestDuration \
  --dimensions Name=Endpoint,Value=/api/cases \
  --start-time 2026-08-07T00:00:00Z \
  --end-time 2026-08-07T01:00:00Z \
  --period 60 \
  --statistics Average,Maximum
```

**Solutions:**
- **Slow database query:** Check CloudWatch metrics, add indexes if needed
- **N+1 query:** Use eager loading with `.populate()` or `.joins()`
- **External API call:** Add timeout, implement circuit breaker
- **Large payload:** Implement pagination or streaming

### 3. Authentication Failures

**Symptom:** "Invalid token" or "Unauthorized" for valid users

**Diagnosis:**
```bash
# Check JWT expiration
node -e "console.log(new Date(PAYLOAD.exp * 1000))"

# Verify Cognito pool configuration
aws cognito-idp describe-user-pool \
  --user-pool-id us-east-1_xxxxx

# Check audit logs for failed auth
grep "AUTH_FAILED" audit.log
```

**Solutions:**
- **Token expired:** Implement refresh token rotation
- **Wrong secret key:** Verify `JWT_SECRET` in Secrets Manager
- **Clock skew:** Sync server time with `ntpdate -s time.nist.gov`
- **Cognito pool deleted:** Recreate or restore from backup

### 4. WebSocket Connection Drops

**Symptom:** Real-time updates stop working, Socket.io disconnects

**Diagnosis:**
```bash
# Check Socket.io logs
grep "socket.io" app.log | grep "disconnect"

# Monitor WebSocket connections
aws cloudwatch get-metric-statistics \
  --namespace SSS/WebSocket \
  --metric-name ActiveConnections \
  --start-time 2026-08-07T00:00:00Z \
  --end-time 2026-08-07T01:00:00Z \
  --period 60 \
  --statistics Average
```

**Solutions:**
- **ALB timeout:** Increase ALB idle timeout to 300s
- **Network interruption:** Implement exponential backoff reconnection
- **Memory limit exceeded:** Increase ECS task memory
- **Too many connections:** Scale horizontally (add more ECS tasks)

---

## Database Issues

### 1. Slow Queries

**Symptom:** Database latency increasing, some operations take >2s

**Diagnosis:**
```bash
# Enable query logging (temporarily)
ALTER SYSTEM SET log_min_duration_statement = 1000;
SELECT pg_reload_conf();

# Find slow queries
SELECT query, mean_time, calls FROM pg_stat_statements 
ORDER BY mean_time DESC LIMIT 10;

# Check index usage
SELECT schemaname, tablename, indexname, idx_scan 
FROM pg_stat_user_indexes 
WHERE idx_scan = 0;
```

**Solutions:**
- **Missing index:** `CREATE INDEX idx_cases_status ON cases(status)` then commit
- **Full table scan:** Rewrite query to use indexed columns
- **Outdated statistics:** `ANALYZE cases;` to update query planner
- **Connection pool exhaustion:** Increase pool size or upgrade instance

### 2. Connection Pool Exhausted

**Symptom:** "Connection pool error" or "No available connections"

**Diagnosis:**
```bash
# Check current connections
SELECT count(*) FROM pg_stat_activity;
SELECT pid, usename, application_name, state FROM pg_stat_activity;

# Check connection leaks
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
```

**Solutions:**
- **Leaked connections:** Restart application (ECS task)
- **Too many concurrent requests:** Implement request queuing or scale horizontally
- **Idle connections:** Reduce idle timeout in pool config
- **Upgrade RDS instance:** Increase `max_connections` parameter

### 3. Replication Lag (RDS Multi-AZ)

**Symptom:** Data inconsistency between primary and standby

**Diagnosis:**
```bash
# Check replication lag in read replica
SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();

# Monitor from AWS
aws rds describe-db-instances \
  --db-instance-identifier sss-db \
  --query 'DBInstances[0].StatusInfos'
```

**Solutions:**
- **High write volume:** Check for long-running transactions
- **Network latency:** Verify EC2/RDS in same AZ or VPC
- **Upgrade RDS type:** io1 provides better replication performance

### 4. Backup Failed

**Symptom:** No backup taken at scheduled time

**Diagnosis:**
```bash
# Check RDS backup status
aws rds describe-db-instances \
  --db-instance-identifier sss-db \
  --query 'DBInstances[0].[LatestRestorableTime,BackupRetentionPeriod]'

# Check RDS events
aws rds describe-events \
  --source-identifier sss-db \
  --source-type db-instance \
  --query 'Events[0:10]'
```

**Solutions:**
- **Backup window conflict:** Move backup window to off-peak hours
- **Insufficient storage:** Free up disk space or upgrade storage
- **Manual backup ongoing:** Wait for current backup to complete
- **Backup retention disabled:** Set `BackupRetentionPeriod` >= 1

---

## Cache Issues

### 1. High Cache Miss Rate

**Symptom:** Cache hit ratio <50%, increased database load

**Diagnosis:**
```bash
# Check cache hit ratio
redis-cli INFO stats | grep hit

# Monitor cache memory
redis-cli INFO memory

# Find frequently evicted keys
redis-cli INFO keyspace
```

**Solutions:**
- **TTL too short:** Increase TTL for hot data (cases → 1h, search → 5m)
- **Memory limit:** Increase ElastiCache node size
- **Wrong eviction policy:** Change to `allkeys-lru` for better eviction
- **Cache invalidation issue:** Verify `DEL` commands fire correctly

### 2. Redis Connection Timeout

**Symptom:** "ECONNREFUSED" when connecting to Redis

**Diagnosis:**
```bash
# Test Redis connectivity
redis-cli -h sss-cache.xxxxx.cache.amazonaws.com ping

# Check security group
aws ec2 describe-security-groups --group-ids sg-xxxxx

# Check ElastiCache cluster status
aws elasticache describe-cache-clusters \
  --cache-cluster-id sss-cache
```

**Solutions:**
- **Security group rule missing:** Add inbound 6379 from ECS security group
- **Redis node down:** Trigger failover via AWS Console
- **Wrong endpoint:** Verify REDIS_URL environment variable
- **Network ACL blocking:** Check subnet network ACLs

### 3. High Eviction Rate

**Symptom:** Cached data disappearing prematurely

**Diagnosis:**
```bash
# Check eviction stats
redis-cli INFO stats | grep evicted

# Monitor memory usage
redis-cli INFO memory | grep used_memory

# Check key expiration
redis-cli DBSIZE
redis-cli TTL key-name
```

**Solutions:**
- **Increase memory:** Upgrade ElastiCache node to larger instance
- **Reduce dataset size:** Implement smarter TTL values
- **Implement tiered caching:** Hot data in memory, warm data in Redis
- **Change eviction policy:** Switch to `allkeys-lfu` for working sets

---

## Search Issues

### 1. Elasticsearch Cluster Unhealthy

**Symptom:** Search returns 503 "Unavailable"

**Diagnosis:**
```bash
# Check cluster health
curl -u user:pass https://search-sss-xxxxx.us-east-1.es.amazonaws.com/_cluster/health

# Check node status
curl https://search-sss-xxxxx.us-east-1.es.amazonaws.com/_nodes

# Check index status
curl https://search-sss-xxxxx.us-east-1.es.amazonaws.com/_cat/indices
```

**Solutions:**
- **Cluster too small:** Scale up Elasticsearch domain (add nodes)
- **Disk full:** Implement index lifecycle policy, delete old indexes
- **Too many shards:** Reduce shard count (default 1 per node is usually fine)
- **Shard allocation issues:** Check `_cluster/allocation/explain`

### 2. Search Latency High

**Symptom:** Searches taking >500ms

**Diagnosis:**
```bash
# Profile slow queries
curl -H "Content-Type: application/json" https://search-sss-xxxxx.us-east-1.es.amazonaws.com/cases/_search?profile=true \
  -d '{
    "query": { "match": { "status": "pending" } }
  }'

# Check index stats
curl https://search-sss-xxxxx.us-east-1.es.amazonaws.com/cases/_stats
```

**Solutions:**
- **Too many results:** Add `size` limit, implement pagination
- **Expensive aggregations:** Move to post-processing in application
- **Missing index:** Create index on frequently searched fields
- **Refresh interval too high:** Change `refresh_interval` from 30s to 1s for hot data

### 3. Index Out of Sync with Database

**Symptom:** Search results don't match database, missing recent data

**Diagnosis:**
```bash
# Check index last update
curl https://search-sss-xxxxx.us-east-1.es.amazonaws.com/cases/_stats | jq .indices.cases.primaries.indexing

# Compare counts
DB: SELECT count(*) FROM cases;
ES: curl https://search-sss-xxxxx.us-east-1.es.amazonaws.com/cases/_count
```

**Solutions:**
- **Reindex needed:** `npm run reindex:cases`
- **Indexing failed:** Check application logs for Elasticsearch errors
- **Duplicate data:** Clear index and re-index: `DELETE cases` then `npm run reindex`
- **Stale refresh cache:** Implement change data capture or CDC

---

## Security Issues

### 1. Unauthorized Access to Resource

**Symptom:** User can access resources they shouldn't (ABAC failure)

**Diagnosis:**
```bash
# Check OPA policy
curl http://opa-service/v1/data/sss/allow \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "user": { "id": "user123", "role": "citizen" },
      "action": "write",
      "resource": { "id": "case456", "owner_id": "user789" }
    }
  }'

# Check audit log
SELECT * FROM audit_logs WHERE resource_id = 'case456' ORDER BY created_at DESC;
```

**Solutions:**
- **Policy logic error:** Review Rego policy, fix attribute evaluation
- **Wrong user context:** Verify JWT contains correct role
- **Cache not cleared:** Restart OPA bundle server
- **Database permission:** Check row-level security (RLS) policies

### 2. WAF Blocking Legitimate Traffic

**Symptom:** Legitimate requests return 403 Forbidden from WAF

**Diagnosis:**
```bash
# Check WAF rules
aws wafv2 list-resources-for-web-acl \
  --web-acl-arn arn:aws:wafv2:us-east-1:xxxxx:global/webacl/sss/xxxxx

# Check WAF logs
aws logs tail /aws/waf/sss --follow

# Identify blocked request pattern
grep "403" cloudfront.log | tail -20
```

**Solutions:**
- **Rate limiting too strict:** Increase threshold in WAF rule
- **Geographic block:** Whitelist country in WAF rules
- **User-Agent blocked:** Add to exceptions or disable rule
- **IP reputation:** Check if company IP on block list, whitelist

### 3. SSL Certificate Expiring

**Symptom:** Browser warning "Certificate Expired" or "Invalid"

**Diagnosis:**
```bash
# Check certificate expiration
echo | openssl s_client -servername sss-platform.gov -connect sss-platform.gov:443 2>/dev/null | openssl x509 -noout -dates

# Check ACM certificate
aws acm describe-certificate --certificate-arn arn:aws:acm:us-east-1:xxxxx:certificate/xxxxx
```

**Solutions:**
- **Manual renewal needed:** Renew in ACM console (auto-renewal should handle)
- **DNS validation failed:** Re-validate domain in ACM
- **Multiple SANs:** Ensure all domains are in certificate
- **Wildcard issue:** Use wildcard cert if many subdomains

---

## Infrastructure Issues

### 1. ECS Task Crashing

**Symptom:** Task keeps restarting, service unhealthy

**Diagnosis:**
```bash
# Check task logs
aws ecs describe-tasks \
  --cluster sss \
  --tasks arn:aws:ecs:us-east-1:xxxxx:task/sss/xxxxx \
  --query 'tasks[0].lastStatus'

# Get logs from CloudWatch
aws logs tail /ecs/sss-modernization --follow

# Check task definition
aws ecs describe-task-definition --task-definition sss-modernization:1
```

**Solutions:**
- **Out of memory:** Increase ECS task memory allocation
- **Missing environment variable:** Check Secrets Manager, verify injection
- **Port conflict:** Check if another task using same port
- **Health check failing:** Review health check command, increase grace period

### 2. Load Balancer Unhealthy Targets

**Symptom:** "502 Bad Gateway" from ALB, targets marked unhealthy

**Diagnosis:**
```bash
# Check target health
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:xxxxx:targetgroup/sss/xxxxx

# Check ALB logs
aws s3 ls s3://sss-alb-logs/ --recursive

# Check application health endpoint
curl http://10.0.1.x:3000/health
```

**Solutions:**
- **Health check endpoint returns 500:** Fix application startup
- **Port unreachable:** Verify security group allows inbound
- **Health check timeout too short:** Increase threshold
- **Container not starting:** Check CloudWatch logs for startup errors

### 3. Out of Disk Space

**Symptom:** "Disk full" errors, deployments fail

**Diagnosis:**
```bash
# Check disk usage
df -h

# Find large files
du -sh /* | sort -h

# Check CloudWatch alarm
aws cloudwatch describe-alarms --alarm-names "sss-disk-full"
```

**Solutions:**
- **ECS task logs filling disk:** Implement log rotation, use CloudWatch Logs
- **Old Docker images:** Remove unused images: `docker image prune`
- **Database files:** Check RDS storage, implement archival
- **Increase volume size:** Grow EBS volume (if applicable)

### 4. High CPU/Memory Usage

**Symptom:** Application slow, CPU or memory alerts firing

**Diagnosis:**
```bash
# Check top processes
top -bn1 | head -20

# Check ECS task metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=sss \
  --start-time 2026-08-07T00:00:00Z \
  --end-time 2026-08-07T01:00:00Z \
  --period 300 \
  --statistics Average
```

**Solutions:**
- **Memory leak:** Restart container (orchestration handles this)
- **N+1 queries:** Optimize database queries, add indexes
- **Inefficient algorithm:** Profile with Node.js profiler
- **Scale horizontally:** Add more ECS tasks/instances

---

## Deployment Issues

### 1. Deployment Stuck

**Symptom:** CodeDeploy/GitHub Actions workflow hanging

**Diagnosis:**
```bash
# Check deployment status
aws deploy get-deployment --deployment-id d-xxxxx

# Check CodeDeploy logs
aws logs tail /aws/codedeploy/sss --follow

# Check ECS service update progress
aws ecs describe-services \
  --cluster sss \
  --services sss-api \
  --query 'services[0].deployments'
```

**Solutions:**
- **Health check timeout:** Increase ECS deployment timeout
- **Service discovery issue:** Restart CloudMap/Route53 registration
- **Insufficient capacity:** Scale up ECS cluster
- **Rollback triggered:** Check error metrics, fix application, retry

### 2. Rollback Failed

**Symptom:** Deployment rolled back, old version also has errors

**Diagnosis:**
```bash
# Check rollback status
aws deploy describe-deployment --deployment-id d-xxxxx

# Verify previous version
aws ecs describe-task-definition --task-definition sss-modernization:N-1

# Check git history
git log --oneline | head -5
```

**Solutions:**
- **Previous version also broken:** Deploy known good version
- **Database migration issue:** Check migration logs, manual rollback
- **Both versions failing:** Investigate root cause, don't deploy
- **Deployment automation stuck:** Manually revert ECS task definition

### 3. Database Migration Failed

**Symptom:** New column exists partially, migration incomplete

**Diagnosis:**
```bash
# Check migration status
SELECT version, success, executed_at FROM schema_migrations ORDER BY executed_at DESC;

# Check for locks
SELECT * FROM pg_locks;

# Check transaction state
SELECT * FROM pg_stat_activity WHERE state != 'idle';
```

**Solutions:**
- **Long-running transaction blocking:** Kill transaction with `SELECT pg_terminate_backend(pid)`
- **Lock conflict:** Wait for transaction to complete, retry migration
- **Partial schema:** Rollback migration and fix script
- **Deployment timeout:** Increase timeout, run migration separately

---

## Performance Issues

### 1. Dashboard Loading Slowly

**Symptom:** Dashboard takes >3s to load, spinners show

**Diagnosis:**
```bash
# Check frontend bundle size
npm run build && ls -lh dist/

# Monitor network requests
curl -X GET https://api.sss-platform.gov/api/dashboard/summary \
  -H "Authorization: Bearer token" \
  -w "Time: %{time_total}s\n"

# Check API endpoint latency
aws cloudwatch get-metric-statistics \
  --namespace SSS/API \
  --metric-name RequestDuration \
  --dimensions Name=Endpoint,Value=/api/dashboard/summary \
  --start-time 2026-08-07T00:00:00Z \
  --end-time 2026-08-07T01:00:00Z \
  --period 60 \
  --statistics Average,Maximum
```

**Solutions:**
- **Large JavaScript bundle:** Implement code splitting, lazy load routes
- **Too many API calls:** Batch requests, combine endpoints
- **Database queries slow:** Add indexes, implement caching
- **Frontend rendering slow:** Use React.memo, virtual scrolling for lists

### 2. Report Generation Timeout

**Symptom:** "Report generation failed" after 60 seconds

**Diagnosis:**
```bash
# Check report job status
SELECT * FROM report_jobs WHERE id = 'report-123' ORDER BY created_at DESC;

# Check SQS queue
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/xxxxx/report-generation \
  --attribute-names All

# Monitor job logs
aws logs tail /aws/lambda/sss-report-generator --follow
```

**Solutions:**
- **Timeout setting too low:** Increase Lambda timeout from 60s to 300s
- **Large dataset:** Implement pagination, stream results to S3
- **Complex aggregations:** Pre-compute metrics, use materialized views
- **External API slow:** Add timeout, implement fallback

### 3. Bulk Import Very Slow

**Symptom:** Importing 10,000 cases takes >30 minutes

**Diagnosis:**
```bash
# Check import job progress
SELECT status, count(*) FROM cases WHERE created_at > NOW() - INTERVAL '1 day' GROUP BY status;

# Check batch queue
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/xxxxx/case-processing

# Check database load
SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%INSERT%';
```

**Solutions:**
- **Batch size too small:** Increase batch size from 100 to 1000
- **Too many validations:** Run async validation in background
- **Index updates slow:** Disable indexes during import, rebuild after
- **Connection pool exhausted:** Increase pool size or use bulk insert API

---

## Monitoring & Alert Issues

### 1. False Positive Alerts

**Symptom:** Alert fires but system is working fine

**Diagnosis:**
```bash
# Check alarm configuration
aws cloudwatch describe-alarms --alarm-names "sss-error-spike"

# Verify metrics
aws cloudwatch get-metric-statistics \
  --namespace SSS/API \
  --metric-name ErrorCount \
  --start-time 2026-08-07T00:00:00Z \
  --end-time 2026-08-07T01:00:00Z \
  --period 300 \
  --statistics Sum
```

**Solutions:**
- **Threshold too sensitive:** Increase threshold from 5% to 10%
- **Insufficient data points:** Increase evaluation periods
- **Treat missing data as good:** Change alarm state handling
- **Scheduled maintenance:** Disable alert during maintenance window

### 2. Alert Not Firing

**Symptom:** Issue occurs but no alert

**Diagnosis:**
```bash
# Check alarm state
aws cloudwatch describe-alarms --alarm-names "sss-latency-high"

# Verify SNS topic
aws sns get-topic-attributes --topic-arn arn:aws:sns:us-east-1:xxxxx:sss-alerts

# Check alert history
aws cloudwatch describe-alarm-history --alarm-name "sss-latency-high"
```

**Solutions:**
- **Alarm disabled:** Re-enable alarm via CloudWatch console
- **SNS topic not subscribed:** Add email/Slack subscription
- **Metric not publishing:** Check application telemetry code
- **Threshold never exceeded:** Adjust threshold to realistic value

---

## Maintenance & Support

### Emergency Contacts
- **On-Call:** [PagerDuty page or phone list]
- **Database Admin:** [Name/contact]
- **Security Team:** [Name/contact]
- **Cloud Ops:** [Name/contact]

### Escalation Path
1. **Alert fires** → On-call engineer acknowledges (PagerDuty)
2. **>15 min** → Escalate to backup engineer
3. **>30 min** → Escalate to team lead
4. **>1 hour** → Activate war room, engage stakeholders

### Common Fixes Quick Reference

| Issue | Fix | Time |
|-------|-----|------|
| ECS task crash | Restart: `aws ecs update-service --force-new-deployment` | 2m |
| Redis down | Failover: AWS Console ElastiCache | 5m |
| Database slow | Kill long transaction: `SELECT pg_terminate_backend(pid)` | 1m |
| Deployment hung | Roll back: Previous ECS task definition | 3m |

---

**Status:** ✅ COMPLETE

# Operations Runbooks

Incident response procedures for the SSS Modernization Platform. Each runbook contains diagnostic steps, mitigation strategies, and recovery procedures.

---

## Table of Contents
1. **Database Issues** — RDS connection failures, slow queries, disk full
2. **Cache Issues** — Redis connection, memory, eviction
3. **Application Issues** — Service crashes, memory leaks, high CPU
4. **Network Issues** — Load balancer, WAF blocking, latency
5. **Authentication Issues** — JWT validation, MFA failures
6. **Data Issues** — Audit log failures, compliance violations
7. **Deployment Issues** — Service update failures, rollback procedures
8. **Security Issues** — Suspected breach, unauthorized access

---

## 1. Database Issues

### 1.1: RDS Connection Failures

**Symptoms:**
- "Connection refused" errors in application logs
- `FATAL: role "postgres" does not exist`
- Timeout when connecting to database
- Cannot access CloudWatch logs

**Diagnosis:**
```bash
# Check RDS instance status
aws rds describe-db-instances \
  --db-instance-identifier sss-modernization-db \
  --query 'DBInstances[0].DBInstanceStatus'

# Should return: "available"
# If not available, check:
aws rds describe-db-instances \
  --db-instance-identifier sss-modernization-db \
  --query 'DBInstances[0].[DBInstanceStatus, PendingModifiedValues]'

# Check security group allows connection
aws ec2 describe-security-groups \
  --group-ids sg-xxxxx \
  --query 'SecurityGroups[0].IpPermissions' | grep 5432

# Test connection from ECS task
aws ecs execute-command \
  --cluster sss-modernization \
  --task sss-modernization-backend-xxxxx \
  --container sss-modernization-backend \
  --interactive \
  --command "/bin/sh"

# Inside container:
psql -h $DATABASE_HOST -U $DATABASE_USER -d sssdb
```

**Resolution:**
1. **RDS Instance Down:**
   ```bash
   # Check if instance needs restart
   aws rds reboot-db-instance \
     --db-instance-identifier sss-modernization-db
   # Wait 5-10 minutes for reboot
   ```

2. **Security Group Issue:**
   ```bash
   # Add ECS security group to RDS ingress
   aws ec2 authorize-security-group-ingress \
     --group-id sg-rds-xxxxx \
     --protocol tcp \
     --port 5432 \
     --source-group sg-ecs-xxxxx
   ```

3. **Database Credentials Wrong:**
   ```bash
   # Verify credentials in Secrets Manager
   aws secretsmanager get-secret-value \
     --secret-id sss-modernization-rds-credentials
   
   # Rotate password if suspected compromise
   aws secretsmanager rotate-secret \
     --secret-id sss-modernization-rds-credentials \
     --rotation-rules AutomaticallyAfterDays=30
   ```

4. **Recovery:**
   ```bash
   # Restart ECS services to pick up fixed connection
   aws ecs update-service \
     --cluster sss-modernization \
     --service sss-modernization-backend \
     --force-new-deployment
   ```

**Monitoring:**
- Check CloudWatch log `/ecs/sss-modernization-backend`
- Alert threshold: 0 failed connections per 5 minutes

---

### 1.2: Database Slow Queries

**Symptoms:**
- API latency p95 > 500ms, p99 > 1000ms
- "Slow query log" entries in CloudWatch
- ECS tasks consuming >60% CPU
- RDS CPU > 70% for sustained period

**Diagnosis:**
```bash
# Enable slow query log (if not already)
aws rds modify-db-instance \
  --db-instance-identifier sss-modernization-db \
  --enable-cloudwatch-logs-exports postgresql
  # Wait for reboot window

# Check slow queries
aws logs filter-log-events \
  --log-group-name /aws/rds/instance/sss-modernization-db/postgresql \
  --filter-pattern "duration:" \
  --query 'events[0:20]'

# Or query database directly
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U postgres -d sssdb << 'SQL'
-- Find slowest queries
SELECT query, calls, mean_exec_time, max_exec_time 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;

-- Check for missing indexes
SELECT schemaname, tablename, indexname, idx_scan 
FROM pg_stat_user_indexes 
WHERE idx_scan = 0;

-- Check table size
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size 
FROM pg_tables 
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC 
LIMIT 10;
SQL
```

**Resolution:**
1. **Add Missing Indexes:**
   ```bash
   # Run performance optimization script
   bash infrastructure/scripts/create-performance-indexes.sql
   
   # Or manually add index
   CREATE INDEX idx_cases_status_created 
   ON cases(status, created_at DESC)
   WHERE status != 'Approved';
   ```

2. **Optimize Slow Queries:**
   ```bash
   # Generate optimization guide
   bash infrastructure/scripts/optimize-performance.sh
   
   # Review generated file
   cat optimize-output/query-optimization-guide.sql
   ```

3. **Increase RDS Resources:**
   ```bash
   # Modify DB instance class (requires downtime or multi-AZ failover)
   aws rds modify-db-instance \
     --db-instance-identifier sss-modernization-db \
     --db-instance-class db.t3.medium \
     --apply-immediately
   ```

4. **Check Connection Pool:**
   ```bash
   # Verify pool settings in backend config
   grep -r "pool:" backend/src
   
   # Expected: min=2, max=20 connections
   # Adjust if needed and restart
   ```

**Prevention:**
- Monitor CloudWatch metric "DBLoad" (should be <2)
- Set alarm for queries > 1 second
- Run performance optimization monthly

---

### 1.3: Disk Full / Storage Issues

**Symptoms:**
- "No space left on device" error
- RDS Free Storage Space < 500 MB
- Transaction rollbacks
- Cannot write to audit logs

**Diagnosis:**
```bash
# Check RDS Free Storage Space
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name FreeStorageSpace \
  --dimensions Name=DBInstanceIdentifier,Value=sss-modernization-db \
  --statistics Average \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300

# Check if storage is actually full
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U postgres -d sssdb << 'SQL'
SELECT pg_database.datname, 
       pg_size_pretty(pg_database_size(pg_database.datname)) AS size 
FROM pg_database 
ORDER BY pg_database_size(pg_database.datname) DESC;
SQL
```

**Resolution:**
1. **Immediate: Cleanup Old Logs**
   ```bash
   # Delete old audit logs (>1 year)
   PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U postgres -d sssdb << 'SQL'
   DELETE FROM audit_logs 
   WHERE timestamp < NOW() - INTERVAL '1 year';
   VACUUM ANALYZE audit_logs;
   SQL
   ```

2. **Immediate: Archive to S3**
   ```bash
   # Export logs to S3 for archival
   PGPASSWORD=$DB_PASSWORD pg_dump -h $DB_HOST -U postgres -d sssdb | \
     gzip | \
     aws s3 cp - s3://sss-modernization-backups-prod/archive/$(date +%Y-%m-%d).sql.gz
   ```

3. **Increase Storage:**
   ```bash
   # Modify RDS allocated storage (requires downtime)
   aws rds modify-db-instance \
     --db-instance-identifier sss-modernization-db \
     --allocated-storage 200 \
     --apply-immediately
   # Wait 10-30 minutes for storage increase
   ```

4. **Check for Bloated Tables:**
   ```bash
   PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U postgres -d sssdb << 'SQL'
   -- Find table bloat
   SELECT schemaname, tablename, 
          round(100 * pg_relation_size(schemaname||'.'||tablename) / 
          pg_total_relation_size(schemaname||'.'||tablename)) as table_ratio
   FROM pg_tables 
   WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
   ORDER BY pg_relation_size(schemaname||'.'||tablename) DESC;
   
   -- VACUUM to reclaim space
   VACUUM ANALYZE;
   SQL
   ```

**Prevention:**
- Monitor `FreeStorageSpace` metric (alert < 10GB)
- Set up log rotation (30-day retention in CloudWatch, 365 days in S3)
- Archive old audit logs quarterly

---

## 2. Cache Issues

### 2.1: Redis Connection Failures

**Symptoms:**
- "Connection refused" in application logs
- Cache hit ratio drops to 0%
- Application latency spikes
- "TargetHealth: unhealthy" for cache service

**Diagnosis:**
```bash
# Check Redis cluster status
aws elasticache describe-cache-clusters \
  --cache-cluster-id sss-modernization-cache \
  --show-cache-node-info \
  --query 'CacheClusters[0].[CacheClusterStatus, Engine, EngineVersion]'

# Check from application
curl http://localhost:6379  # Should fail (not HTTP)

# Use redis-cli
docker run -it redis:7-alpine redis-cli -h $REDIS_HOST ping
# Expected: PONG

# Check security group
aws ec2 describe-security-groups \
  --group-ids sg-xxxxx \
  --query 'SecurityGroups[0].IpPermissions' | grep 6379
```

**Resolution:**
1. **Restart Redis:**
   ```bash
   # Reboot cache cluster
   aws elasticache reboot-cache-cluster \
     --cache-cluster-id sss-modernization-cache
   # Wait 5 minutes
   ```

2. **Check Credentials:**
   ```bash
   # Verify Redis password in Secrets Manager
   aws secretsmanager get-secret-value \
     --secret-id sss-modernization-redis-credentials
   
   # Rotate if suspected compromise
   aws elasticache modify-cache-cluster \
     --cache-cluster-id sss-modernization-cache \
     --apply-immediately
   ```

3. **Security Group Issue:**
   ```bash
   # Add ECS security group to Redis ingress
   aws ec2 authorize-security-group-ingress \
     --group-id sg-redis-xxxxx \
     --protocol tcp \
     --port 6379 \
     --source-group sg-ecs-xxxxx
   ```

4. **Restart Application:**
   ```bash
   # Force redeploy to reconnect
   aws ecs update-service \
     --cluster sss-modernization \
     --service sss-modernization-backend \
     --force-new-deployment
   ```

**Fallback:** Application continues with degraded performance (cache disabled).

---

### 2.2: Redis High Memory Usage

**Symptoms:**
- ElastiCache "SwapUsage" metric > 0
- Eviction events increasing
- Cache hit ratio degrading
- "Redis is running out of memory" warnings

**Diagnosis:**
```bash
# Check memory usage
aws cloudwatch get-metric-statistics \
  --namespace AWS/ElastiCache \
  --metric-name DatabaseMemoryUsagePercentage \
  --dimensions Name=CacheClusterId,Value=sss-modernization-cache \
  --statistics Average \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300

# Connect and check keys
redis-cli -h $REDIS_HOST --auth $REDIS_PASSWORD << 'REDIS'
INFO memory
DBSIZE
SCAN 0 MATCH "session:*" COUNT 100
REDIS

# Check eviction policy
CONFIG GET maxmemory-policy
```

**Resolution:**
1. **Immediate: Clear Old Sessions**
   ```bash
   redis-cli -h $REDIS_HOST --auth $REDIS_PASSWORD << 'REDIS'
   -- Delete expired sessions (> 1 hour old)
   EVAL "
   local keys = redis.call('SCAN', 0, 'MATCH', 'session:*', 'COUNT', 1000)[2]
   for i,key in ipairs(keys) do
     redis.call('DEL', key)
   end
   return #keys
   " 0
   REDIS
   ```

2. **Flush Old Cache:**
   ```bash
   redis-cli -h $REDIS_HOST --auth $REDIS_PASSWORD FLUSHDB
   # Application will rebuild cache on next requests
   ```

3. **Increase Cache Memory:**
   ```bash
   # Modify cache cluster (requires downtime)
   aws elasticache modify-cache-cluster \
     --cache-cluster-id sss-modernization-cache \
     --cache-node-type cache.t3.medium \
     --apply-immediately
   # Wait 10 minutes
   ```

4. **Adjust Eviction Policy:**
   ```bash
   aws elasticache modify-parameter-group \
     --parameter-group-name sss-modernization-cache-params \
     --parameter-name-values 'maxmemory-policy=allkeys-lru' \
     --apply-immediately
   ```

**Prevention:**
- Monitor memory usage (alert > 80%)
- Set shorter TTL for sessions (1-2 hours)
- Implement LRU eviction policy

---

## 3. Application Issues

### 3.1: Service Crashes / OOM Errors

**Symptoms:**
- ECS task stops (status = STOPPED)
- "JavaScript heap out of memory" error
- Task restart loop (kept restarting)
- 502 Bad Gateway from ALB

**Diagnosis:**
```bash
# Check ECS task logs
aws logs get-log-events \
  --log-group-name /ecs/sss-modernization-backend \
  --log-stream-name ecs/sss-modernization-backend/xxxxx \
  --tail 100

# Check task status
aws ecs describe-tasks \
  --cluster sss-modernization \
  --tasks arn:aws:ecs:region:account:task/cluster/xxxxx \
  --query 'tasks[0].[lastStatus, exitCode, stoppedReason]'

# Check memory metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name MemoryUtilization \
  --dimensions Name=ClusterName,Value=sss-modernization Name=ServiceName,Value=sss-modernization-backend \
  --statistics Average,Maximum \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300
```

**Resolution:**
1. **Memory Leak:**
   ```bash
   # Check for memory leaks in recent changes
   git log --oneline -20 | head -10
   
   # Look at diff of suspicious commits
   git show <commit-hash> -- backend/src
   
   # Common issues:
   # - Objects not garbage collected
   # - Circular references
   # - Event listeners not removed
   # - Cache growing unbounded
   ```

2. **Increase Task Memory:**
   ```bash
   # Update ECS task definition
   aws ecs describe-task-definition \
     --task-definition sss-modernization-backend \
     --query 'taskDefinition' > task-def.json
   
   # Edit task-def.json:
   # - containerDefinitions[0].memory: 512 → 1024
   # - containerDefinitions[0].memoryReservation: 256 → 512
   
   # Register new version
   aws ecs register-task-definition --cli-input-json file://task-def.json
   
   # Update service
   aws ecs update-service \
     --cluster sss-modernization \
     --service sss-modernization-backend \
     --task-definition sss-modernization-backend:2 \
     --force-new-deployment
   ```

3. **Kill Memory-Hogging Process:**
   ```bash
   # SSH into running task
   aws ecs execute-command \
     --cluster sss-modernization \
     --task $(aws ecs list-tasks --cluster sss-modernization --service-name sss-modernization-backend --query 'taskArns[0]' --output text) \
     --container sss-modernization-backend \
     --interactive \
     --command "/bin/sh"
   
   # Inside container:
   top  # Find memory hog
   ps aux  # List processes
   ```

**Prevention:**
- Monitor memory usage (alert > 80%)
- Set up memory profile in development
- Review memory trends in CloudWatch

---

### 3.2: High CPU Usage

**Symptoms:**
- ECS CPU utilization > 80%
- API latency increases
- Requests timing out
- "Too many open connections" warnings

**Diagnosis:**
```bash
# Check CPU metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ClusterName,Value=sss-modernization Name=ServiceName,Value=sss-modernization-backend \
  --statistics Average,Maximum \
  --start-time $(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300

# Check database connections
aws ecs execute-command \
  --cluster sss-modernization \
  --task $(aws ecs list-tasks --cluster sss-modernization --service-name sss-modernization-backend --query 'taskArns[0]' --output text) \
  --container sss-modernization-backend \
  --interactive \
  --command "/bin/sh"

# Inside container:
# Check node processes
ps aux | grep node

# Check connection pool
netstat -an | grep ESTABLISHED | wc -l

# Check application logs for slow operations
tail -f /var/log/app.log | grep "duration:"
```

**Resolution:**
1. **Scale Up Service:**
   ```bash
   # Increase desired task count
   aws ecs update-service \
     --cluster sss-modernization \
     --service sss-modernization-backend \
     --desired-count 4
   # Wait 2-3 minutes for new tasks
   ```

2. **Find CPU-Intensive Operation:**
   ```bash
   # Look for slow queries or complex operations
   curl http://localhost:5000/api/health
   
   # Check metrics in the last hour
   aws logs filter-log-events \
     --log-group-name /ecs/sss-modernization-backend \
     --start-time $(($(date +%s)*1000 - 3600000)) \
     --filter-pattern "[ERROR] OR [WARN]" \
     --query 'events[*].message'
   ```

3. **Optimize Code:**
   ```bash
   # Review recent changes for expensive operations
   git log --oneline -20
   
   # Common issues:
   # - Nested loops on large datasets
   # - Synchronous DB queries instead of async
   # - Inefficient regex or string operations
   # - Missing pagination on list endpoints
   ```

4. **Increase Task CPU:**
   ```bash
   # Update task definition (similar to memory resolution)
   # Change: containerDefinitions[0].cpu: 256 → 512
   ```

**Prevention:**
- Monitor CPU (alert > 70%)
- Load test before deployment
- Profile slow endpoints in development

---

## 4. Network Issues

### 4.1: ALB Not Routing Traffic

**Symptoms:**
- 503 Service Unavailable
- Targets show "unhealthy" status
- No traffic reaching ECS tasks
- "Connection reset by peer"

**Diagnosis:**
```bash
# Check ALB target health
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:region:account:targetgroup/sss-backend/xxxxx

# Should show: "TargetHealth.State": "healthy"

# Check ALB configuration
aws elbv2 describe-load-balancers \
  --names sss-modernization-alb \
  --query 'LoadBalancers[0].[State.Code, Scheme]'

# Check security group
aws ec2 describe-security-groups \
  --group-ids sg-alb-xxxxx \
  --query 'SecurityGroups[0].IpPermissions'

# Test health check endpoint
curl http://localhost:5000/api/health
# Expected: {"status":"healthy",...}

# Check ALB logs
aws s3 ls s3://sss-modernization-alb-logs/ --recursive | head -20
```

**Resolution:**
1. **Health Check Failing:**
   ```bash
   # Check if health endpoint is responding
   docker exec $(docker ps | grep sss-backend | awk '{print $1}') \
     curl -f http://localhost:5000/api/health || echo "Health check failed"
   
   # If failing, check:
   # - Database connectivity
   # - Cache connectivity
   # - Error logs
   ```

2. **Update Health Check Configuration:**
   ```bash
   aws elbv2 modify-target-group \
     --target-group-arn arn:aws:elasticloadbalancing:region:account:targetgroup/sss-backend/xxxxx \
     --health-check-enabled \
     --health-check-protocol HTTP \
     --health-check-path /api/health \
     --health-check-interval-seconds 30 \
     --health-check-timeout-seconds 5 \
     --healthy-threshold-count 2 \
     --unhealthy-threshold-count 2
   ```

3. **Security Group Issue:**
   ```bash
   # Ensure ALB can reach ECS tasks
   aws ec2 authorize-security-group-ingress \
     --group-id sg-ecs-xxxxx \
     --protocol tcp \
     --port 5000 \
     --source-group sg-alb-xxxxx
   ```

4. **Restart ECS Service:**
   ```bash
   aws ecs update-service \
     --cluster sss-modernization \
     --service sss-modernization-backend \
     --force-new-deployment
   ```

**Prevention:**
- Monitor target health (alert when unhealthy > 0)
- Implement robust health check endpoint
- Test health check regularly

---

### 4.2: WAF Blocking Legitimate Traffic

**Symptoms:**
- 403 Forbidden responses
- Legitimate API calls blocked
- WAF logs show rule matches
- Users unable to submit forms

**Diagnosis:**
```bash
# Check WAF rules
aws wafv2 list-web-acls \
  --scope REGIONAL \
  --region us-east-1 \
  --query "WebACLs[?Name=='sss-modernization-web-acl'].ARN"

# Get WAF details
aws wafv2 get-web-acl \
  --id <web-acl-id> \
  --scope REGIONAL \
  --region us-east-1

# Check WAF logs
aws logs filter-log-events \
  --log-group-name /aws/wafv2/sss-modernization \
  --filter-pattern "\"action\": \"BLOCK\"" \
  --query 'events[0:20]'

# Extract blocked requests
aws logs filter-log-events \
  --log-group-name /aws/wafv2/sss-modernization \
  --start-time $(($(date +%s)*1000 - 600000)) \
  --query 'events[*].message' \
  | jq '.[] | select(.action=="BLOCK") | {httpsourcename, httpsourcematchfield, terminatingruleid}'
```

**Resolution:**
1. **Identify False Positive:**
   ```bash
   # Determine which rule is blocking
   # Common culprits:
   # - SQL Injection detection (false positives on quotes)
   # - Rate limiting (too low threshold)
   # - Geo-blocking (wrong regions)
   # - Request size limits (multipart uploads)
   ```

2. **Whitelist Legitimate Traffic:**
   ```bash
   # Create IP set for trusted sources
   aws wafv2 create-ip-set \
     --name trusted-ips \
     --scope REGIONAL \
     --region us-east-1 \
     --addresses '["192.0.2.0/24"]'
   
   # Update WAF rule to exclude IP set
   # (via AWS Console or complex CLI)
   ```

3. **Adjust Rule Sensitivity:**
   ```bash
   # For SQL Injection rule (common false positives):
   # Use "Count" action instead of "Block" to test
   
   # Check WAF logs for patterns
   # Common false positives:
   # - Email addresses with +
   # - JSON with quotes
   # - Special characters in form data
   ```

4. **Temporary Bypass:**
   ```bash
   # If urgent, bypass WAF for specific IPs
   aws wafv2 update-ip-set \
     --id <ip-set-id> \
     --scope REGIONAL \
     --addresses '["203.0.113.0/24", "198.51.100.0/24"]'
   ```

**Prevention:**
- Test WAF rules in "Count" mode before blocking
- Whitelist internal/partner IPs
- Monitor WAF logs daily
- Review false positives weekly

---

## 5. Authentication Issues

### 5.1: JWT Token Validation Failures

**Symptoms:**
- "Invalid token" errors for all users
- 401 Unauthorized on valid tokens
- "Token expired" message too early
- MFA code not accepted

**Diagnosis:**
```bash
# Decode JWT token (online or locally)
# Go to https://jwt.io
# Or use:
node << 'JS'
const jwt = require('jsonwebtoken');
const token = process.env.JWT_TOKEN;
console.log(jwt.decode(token, {complete: true}));
JS

# Check JWT secret
aws secretsmanager get-secret-value \
  --secret-id sss-modernization-jwt-secret \
  --query 'SecretString'

# Verify token signature
curl -X POST http://localhost:5000/api/auth/verify \
  -H "Authorization: Bearer $TOKEN"

# Check token TTL in config
grep -r "JWT_TTL\|jwt.*expir" backend/src
```

**Resolution:**
1. **Token Expired:**
   ```bash
   # Expected: tokens expire after 1 hour
   # User needs to login again
   
   # Check if TTL is configured correctly
   # Should be: JWT_TTL=3600 (seconds)
   
   # If too short, update and restart
   # (Note: this affects all current tokens)
   ```

2. **JWT Secret Changed:**
   ```bash
   # All tokens become invalid if secret changes
   # Verify current secret matches config
   
   aws secretsmanager get-secret-value \
     --secret-id sss-modernization-jwt-secret
   
   # Should match: $JWT_SECRET environment variable
   # If not, restart with correct secret
   ```

3. **Clock Skew:**
   ```bash
   # If server clocks are misaligned
   # JWT validation may fail
   
   # Check server time
   date
   
   # Sync time if needed
   ntpdate -s time.nist.gov  # or similar
   ```

4. **MFA Code Validation:**
   ```bash
   # Check TOTP settings
   grep -r "speakeasy\|TOTP\|MFA" backend/src
   
   # TOTP windows are ~30 seconds
   # If user's device time is wrong, code won't work
   
   # Support can issue new TOTP secret
   ```

**Prevention:**
- Monitor token validation errors (alert > 1%)
- Use consistent server time (NTP)
- Educate users on token TTL

---

### 5.2: Login Loop / Session Issues

**Symptoms:**
- Users stuck on login page after credentials
- Session lost after page refresh
- Logout doesn't work
- "Session expired" immediately after login

**Diagnosis:**
```bash
# Check Redis session storage
redis-cli -h $REDIS_HOST --auth $REDIS_PASSWORD << 'REDIS'
SCAN 0 MATCH "session:*"
GET session:<session-id>
REDIS

# Check browser cookies
# (DevTools → Application → Cookies)
# Should show: jwt token in localStorage or sessionStorage

# Check login flow logs
aws logs filter-log-events \
  --log-group-name /ecs/sss-modernization-backend \
  --filter-pattern "\"login\""
```

**Resolution:**
1. **Browser Cache Issue:**
   ```bash
   # User action: Clear browser cache
   # Hard refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)
   # Clear localStorage: F12 → Application → Storage → Clear All
   ```

2. **Redis Session Expired:**
   ```bash
   # Sessions stored in Redis for 24 hours by default
   # If Redis was restarted, sessions lost
   
   # User needs to login again (expected behavior)
   ```

3. **CORS Issue:**
   ```bash
   # Check CORS configuration
   grep -r "cors\|CORS\|Access-Control" backend/src
   
   # Should allow: http://localhost:3000 (dev) and https://api.sss-modernization.com (prod)
   
   # Verify browser console for CORS errors
   # Common issue: localhost vs 127.0.0.1 mismatch
   ```

4. **Token Storage:**
   ```bash
   # Check where token is stored (localStorage vs sessionStorage)
   grep -r "localStorage\|sessionStorage" frontend/src
   
   # sessionStorage: cleared on browser close
   # localStorage: persists across sessions
   
   # For security, sessionStorage is better
   ```

**Prevention:**
- Monitor login failures (alert > 2%)
- Test login flow after deployments
- Educate users on clearing cache

---

## 6. Data Issues

### 6.1: Audit Log Failures

**Symptoms:**
- Audit logs not appearing
- "INSERT failed" errors in logs
- Compliance dashboard shows no events
- Cannot track user actions

**Diagnosis:**
```bash
# Check audit log table
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U postgres -d sssdb << 'SQL'
SELECT COUNT(*) FROM audit_logs;
SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 5;

-- Check table constraints
\d audit_logs

-- Check for errors
SELECT pg_last_xlog_receive_lsn();
SQL

# Check application logs for audit errors
aws logs filter-log-events \
  --log-group-name /ecs/sss-modernization-backend \
  --filter-pattern "audit" \
  | grep -i "error\|fail"
```

**Resolution:**
1. **Disk Full:**
   ```bash
   # See Section 1.3 for disk full resolution
   ```

2. **Constraint Violation:**
   ```bash
   # If audit logs are immutable (write-once)
   # Duplicates will fail
   
   # Check for duplicate entries
   PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U postgres -d sssdb << 'SQL'
   SELECT id, actor, action, COUNT(*) 
   FROM audit_logs 
   GROUP BY id, actor, action 
   HAVING COUNT(*) > 1;
   SQL
   ```

3. **Restore Audit Logging:**
   ```bash
   # Re-start application to pick up fixed DB
   aws ecs update-service \
     --cluster sss-modernization \
     --service sss-modernization-backend \
     --force-new-deployment
   ```

**Prevention:**
- Monitor audit log insert failures (alert > 0)
- Verify immutable constraint working
- Test compliance dashboard daily

---

## 7. Deployment Issues

### 7.1: Service Update Fails / Rollback

**Symptoms:**
- New version won't start (exit code 1)
- "Failed to start container" errors
- Service stuck in deploying state
- 502 errors after deployment

**Diagnosis:**
```bash
# Check service status
aws ecs describe-services \
  --cluster sss-modernization \
  --services sss-modernization-backend \
  --query 'services[0].[status, deployments, events[0:5]]'

# Check task logs
aws logs tail /ecs/sss-modernization-backend --follow --format short

# Check most recent task definition
aws ecs describe-task-definition \
  --task-definition sss-modernization-backend \
  --query 'taskDefinition.containerDefinitions[0].[image, environment]'

# Inspect specific task
aws ecs describe-tasks \
  --cluster sss-modernization \
  --tasks $(aws ecs list-tasks --cluster sss-modernization --service-name sss-modernization-backend --query 'taskArns[0]' --output text) \
  --query 'tasks[0].[lastStatus, stopCode, stoppedReason, containerInstanceArn]'
```

**Resolution:**
1. **Image Pull Failure:**
   ```bash
   # Check if Docker image exists in ECR
   aws ecr describe-images \
     --repository-name sss-modernization-backend \
     --query 'imageDetails[-1]'
   
   # If missing, rebuild and push
   docker build -t sss-modernization-backend:latest backend/
   docker tag sss-modernization-backend:latest <account>.dkr.ecr.us-east-1.amazonaws.com/sss-modernization-backend:latest
   docker push <account>.dkr.ecr.us-east-1.amazonaws.com/sss-modernization-backend:latest
   ```

2. **Application Crash on Startup:**
   ```bash
   # Check logs for error
   aws logs filter-log-events \
     --log-group-name /ecs/sss-modernization-backend \
     --start-time $(($(date +%s)*1000 - 600000)) \
     --filter-pattern "ERROR\|Cannot find module\|SyntaxError"
   
   # Common issues:
   # - Missing environment variables
   # - Database migration failed
   # - Port already in use
   ```

3. **Immediate Rollback:**
   ```bash
   # Get previous task definition version
   aws ecs list-task-definitions \
     --family-prefix sss-modernization-backend \
     --query 'taskDefinitionArns[-2:]'
   
   # Update service to previous version
   aws ecs update-service \
     --cluster sss-modernization \
     --service sss-modernization-backend \
     --task-definition sss-modernization-backend:5 \
     --force-new-deployment
   
   # Wait for rollback to complete (2-3 minutes)
   ```

4. **Investigate Root Cause:**
   ```bash
   # Compare previous successful vs current version
   aws ecs describe-task-definition \
     --task-definition sss-modernization-backend:5 \
     > previous.json
   
   aws ecs describe-task-definition \
     --task-definition sss-modernization-backend:6 \
     > current.json
   
   diff previous.json current.json
   
   # Review code changes
   git log --oneline -10
   git diff <commit>~1..<commit>
   ```

**Prevention:**
- Test Docker image locally before pushing
- Run smoke tests after deployment
- Use gradual deployment (canary, blue-green)

---

## 8. Security Issues

### 8.1: Suspected Credential Leak

**Symptoms:**
- Unauthorized access to resources
- Unusual API activity
- Credentials appearing in logs
- Third party alerts (Have I Been Pwned)

**Response (Immediate):**

1. **Contain the Leak:**
   ```bash
   # Immediately rotate compromised credentials
   aws secretsmanager rotate-secret \
     --secret-id sss-modernization-rds-credentials \
     --rotation-rules AutomaticallyAfterDays=1
   
   aws secretsmanager rotate-secret \
     --secret-id sss-modernization-redis-credentials
   
   aws secretsmanager rotate-secret \
     --secret-id sss-modernization-jwt-secret
   ```

2. **Disable Compromised User Account:**
   ```bash
   # If user credentials leaked
   PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U postgres -d sssdb << 'SQL'
   UPDATE users SET is_active = false WHERE email = 'compromised@example.com';
   SQL
   
   # Revoke existing sessions
   redis-cli -h $REDIS_HOST --auth $REDIS_PASSWORD FLUSHDB
   ```

3. **Review Audit Logs:**
   ```bash
   # Find suspicious activity
   PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U postgres -d sssdb << 'SQL'
   SELECT timestamp, actor, action, resource_id, details
   FROM audit_logs
   WHERE timestamp > NOW() - INTERVAL '24 hours'
   AND (action LIKE '%DELETE%' OR action LIKE '%MODIFY%')
   ORDER BY timestamp DESC
   LIMIT 50;
   SQL
   ```

4. **Enable Enhanced Monitoring:**
   ```bash
   # Increase logging verbosity temporarily
   aws logs put-retention-policy \
     --log-group-name /ecs/sss-modernization-backend \
     --retention-in-days 7
   
   # Monitor for further suspicious activity
   aws logs filter-log-events \
     --log-group-name /ecs/sss-modernization-backend \
     --filter-pattern "DELETE\|UNAUTHORIZED" \
     --start-time $(($(date +%s)*1000 - 86400000))
   ```

**Investigation (Post-Incident):**
1. Where did credentials leak? (code, logs, git history)
2. How long were they exposed?
3. What actions were taken with compromised credentials?
4. Do other credentials need rotation?
5. Are there unknown users or API keys?

**Prevention:**
- Use Secrets Manager (not hardcoded)
- Scan git history for secrets: `git log -S password`
- Monitor CloudTrail for unusual API activity
- Implement secret rotation policies (90-day TTL)

---

## Response Template

Use this template for any incident:

```
INCIDENT: [Description]
SEVERITY: [P0/P1/P2/P3]
TIME DETECTED: [time]
STATUS: [Investigating/Mitigating/Resolved]

DIAGNOSIS:
- [Symptom 1]
- [Symptom 2]
- [Finding 1]

ACTIONS TAKEN:
1. [Action 1] - Result: [result]
2. [Action 2] - Result: [result]

RESOLUTION:
[How issue was resolved]

ROOT CAUSE:
[Why it happened]

PREVENTION:
[How to prevent recurrence]

FOLLOW-UP:
- [ ] Update monitoring
- [ ] Add automated checks
- [ ] Document in runbook
- [ ] Schedule post-mortem
```

---

## Quick Escalation Path

- **P0 (Critical):** Page on-call immediately → Declare SEV-1 → All hands on deck
- **P1 (High):** Page on-call → Declare SEV-2 → Core team responds
- **P2 (Medium):** Create ticket → Assign to team → Standard priority
- **P3 (Low):** Document → Schedule fix → Standard backlog

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-05  
**Maintainer:** Operations Team  
**Escalation:** Slack #sss-incidents

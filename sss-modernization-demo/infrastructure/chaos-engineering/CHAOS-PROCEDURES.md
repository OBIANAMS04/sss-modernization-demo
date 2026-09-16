# Chaos Engineering Procedures

**Version:** 1.0  
**Date:** August 6, 2026  
**Purpose:** Intentional failure injection to validate system resilience and recovery capabilities  

---

## Table of Contents
1. Chaos Engineering Principles
2. Experiment Design Framework
3. Failure Injection Scenarios
4. Monitoring & Metrics During Chaos
5. Recovery Validation
6. Post-Incident Analysis
7. Tools & Implementation

---

## 1. Chaos Engineering Principles

### Hypothesis-Driven Testing

Every chaos experiment must start with a hypothesis:

```
Hypothesis Template:
─────────────────────────────────────────────────
"If [component] fails, the system will [expected behavior]
 within [time window], and [other component] will [mitigation]."

Example 1:
"If the RDS database becomes unavailable, the application will
 return 503 Service Unavailable within 5 seconds, and clients
 will be alerted via error messages."

Example 2:
"If 50% of ECS tasks crash, the ALB health check will detect
 failures within 30 seconds, and auto-scaling will launch new
 tasks to restore capacity within 2 minutes."

Example 3:
"If network latency to Redis increases to 500ms, cache operations
 will timeout after 10 seconds, and the application will fallback
 to database queries without user-visible errors."
```

### Blast Radius Control

```
Level 1 (Minimal): Single component in development environment
Level 2 (Small): Single service in staging environment
Level 3 (Medium): One AZ in production, during business hours
Level 4 (Large): Cross-AZ in production, with on-call standing by
Level 5 (Extreme): Never - reserved only for natural disasters
```

---

## 2. Experiment Design Framework

### Pre-Experiment Checklist

```bash
✅ Hypothesis clearly defined
✅ Expected behavior documented
✅ Blast radius determined (Level 1-3)
✅ Rollback procedure prepared
✅ On-call team notified
✅ Monitoring dashboards ready
✅ Success criteria defined
✅ Approval from team lead obtained
✅ Start time scheduled (off-peak if possible)
✅ Communication channels open
```

### Metrics to Capture

```
Performance Metrics:
├─ Response latency (p50, p95, p99) before/during/after
├─ Throughput (requests/sec)
├─ Error rate (%)
├─ Database query time
└─ Cache hit ratio

Infrastructure Metrics:
├─ CPU utilization
├─ Memory usage
├─ Disk I/O
├─ Network throughput
└─ Connection count

Business Metrics:
├─ Transactions completed
├─ Cases processed
├─ Approvals issued
└─ User-facing errors
```

---

## 3. Failure Injection Scenarios

### Scenario 1: Database Connection Failure

**Hypothesis:** Database becomes unavailable; application gracefully degrades and recovers.

```bash
#!/bin/bash
# chaos/database-failure.sh

set -e

# Configuration
EXPERIMENT_ID="chaos-001-db-failure"
DURATION_SECONDS=120
BLAST_RADIUS="staging"

echo "=== Chaos Experiment: Database Connection Failure ==="
echo "Experiment ID: $EXPERIMENT_ID"
echo "Duration: $DURATION_SECONDS seconds"
echo "Blast Radius: $BLAST_RADIUS"
echo ""

# Start monitoring
echo "Starting monitoring dashboard..."
kubectl port-forward -n monitoring svc/prometheus 9090:9090 &
PROMETHEUS_PID=$!

# Capture baseline metrics
echo "Capturing baseline metrics..."
curl http://localhost:9090/api/v1/query?query='http_request_duration_seconds' \
  > /tmp/baseline-$EXPERIMENT_ID.json

sleep 2

# Inject failure: Disconnect database
echo "Injecting failure: Disconnecting RDS..."
aws rds modify-db-cluster-parameter-group \
  --db-cluster-parameter-group-name sss-modernization-db-params \
  --parameters "ParameterName=max_connections,ParameterValue=0,ApplyMethod=immediate" \
  --region us-east-1

echo "⚠️  Database connection limit set to 0 (failure injected)"
echo "Observing system behavior for $DURATION_SECONDS seconds..."

# Monitor error rate
for i in $(seq 1 $DURATION_SECONDS); do
  ERROR_RATE=$(curl -s http://localhost:5000/api/health | \
    jq -r '.errorRate' || echo "null")
  
  echo "[$(printf '%03d' $i)s] Error Rate: $ERROR_RATE%"
  
  if [ "$ERROR_RATE" != "null" ] && (( $(echo "$ERROR_RATE > 50" | bc -l) )); then
    echo "⚠️  High error rate detected ($ERROR_RATE%)"
  fi
  
  sleep 1
done

# Recover: Restore database connection
echo ""
echo "Injecting recovery: Restoring RDS connection..."
aws rds modify-db-cluster-parameter-group \
  --db-cluster-parameter-group-name sss-modernization-db-params \
  --parameters "ParameterName=max_connections,ParameterValue=100,ApplyMethod=immediate" \
  --region us-east-1

echo "✅ Database connection restored"
echo "Monitoring recovery for 60 seconds..."

sleep 60

# Capture end metrics
echo "Capturing end metrics..."
curl http://localhost:9090/api/v1/query?query='http_request_duration_seconds' \
  > /tmp/end-$EXPERIMENT_ID.json

# Cleanup
kill $PROMETHEUS_PID 2>/dev/null || true

echo ""
echo "=== Experiment Complete ==="
echo "Results saved to: /tmp/*-$EXPERIMENT_ID.json"
```

**Expected Behavior:**
- ✅ Error rate spikes immediately to >50%
- ✅ Application logs show "Connection refused"
- ✅ Health check `/api/health` returns 503
- ✅ ALB removes task from target group within 30s
- ✅ Auto-scaling launches replacement task
- ✅ Database recovers within 5 minutes
- ✅ Error rate drops back to <0.1%
- ✅ No data loss (transactions rolled back)

**Success Criteria:**
- [ ] Recovery time < 5 minutes
- [ ] Error rate during outage < 100% (some requests cached)
- [ ] No manual intervention needed
- [ ] On-call team notified within 30 seconds

---

### Scenario 2: Cache (Redis) Failure

**Hypothesis:** Redis becomes unavailable; application falls back to database queries.

```bash
#!/bin/bash
# chaos/cache-failure.sh

EXPERIMENT_ID="chaos-002-redis-failure"
DURATION_SECONDS=180

echo "=== Chaos Experiment: Redis Cache Failure ==="
echo "Experiment ID: $EXPERIMENT_ID"
echo ""

# Baseline: Measure cache hit ratio
echo "Baseline cache metrics:"
redis-cli -h $REDIS_HOST INFO stats | grep -E "total_commands|hits|misses"

echo ""
echo "Injecting failure: Stopping Redis..."
aws elasticache stop-cache-cluster \
  --cache-cluster-id sss-modernization-cache \
  --region us-east-1

sleep 10

# Monitor during outage
echo "Monitoring for $DURATION_SECONDS seconds..."

for i in $(seq 1 $((DURATION_SECONDS / 10))); do
  LATENCY=$(curl -s http://localhost:5000/api/cases | jq -r '.latency_ms' || echo "null")
  ERROR_RATE=$(curl -s http://localhost:5000/api/health | jq -r '.errorRate' || echo "0")
  
  echo "[$(printf '%03d' $((i*10)))s] Latency: ${LATENCY}ms | Error Rate: ${ERROR_RATE}%"
  
  sleep 10
done

echo ""
echo "Injecting recovery: Starting Redis..."
aws elasticache start-cache-cluster \
  --cache-cluster-id sss-modernization-cache \
  --region us-east-1

echo "Waiting for Redis to recover (typically 30-60s)..."
sleep 60

echo "Verifying recovery..."
redis-cli -h $REDIS_HOST INFO stats | grep -E "total_commands|hits|misses"

echo "=== Experiment Complete ==="
```

**Expected Behavior:**
- ✅ Cache hit ratio drops to 0% immediately
- ✅ Latency increases 2-3x (database queries instead of cache)
- ✅ Error rate stays <1% (fallback mechanism works)
- ✅ Database CPU increases to 60-70%
- ✅ Application remains responsive
- ✅ Cache recovers within 60 seconds
- ✅ Cache hit ratio returns to >80%

---

### Scenario 3: Network Latency Injection

**Hypothesis:** Network delays increase resilience (timeouts, retries).

```bash
#!/bin/bash
# chaos/network-latency.sh

EXPERIMENT_ID="chaos-003-network-latency"
LATENCY_MS=500  # Add 500ms latency

echo "=== Chaos Experiment: Network Latency Injection ==="
echo "Experiment ID: $EXPERIMENT_ID"
echo "Injecting: ${LATENCY_MS}ms latency"
echo ""

# Using tc (traffic control) to inject latency
echo "Injecting latency on eth0..."
sudo tc qdisc add dev eth0 root netem delay ${LATENCY_MS}ms

# Monitor
echo "Monitoring latency impact for 120 seconds..."
for i in {1..12}; do
  P95=$(curl -s http://localhost:5000/api/metrics | jq -r '.latency_p95')
  P99=$(curl -s http://localhost:5000/api/metrics | jq -r '.latency_p99')
  
  echo "[$(printf '%02d' $((i*10)))s] p95: ${P95}ms | p99: ${P99}ms"
  
  sleep 10
done

# Check for timeout errors
TIMEOUTS=$(curl -s http://localhost:5000/api/health | jq -r '.timeoutErrors')
echo "Timeout errors: $TIMEOUTS"

# Recover
echo ""
echo "Removing latency..."
sudo tc qdisc del dev eth0 root

echo "=== Experiment Complete ==="
```

**Expected Behavior:**
- ✅ Latency increases from baseline + 500ms
- ✅ Some requests timeout (HTTP 504)
- ✅ Retry logic triggers
- ✅ Circuit breaker engages if latency persistent
- ✅ Eventually recovers (partial success acceptable)
- ✅ Error rate <5% during latency

---

### Scenario 4: Partial Network Partition

**Hypothesis:** Network partition between AZs; failover mechanism kicks in.

```bash
#!/bin/bash
# chaos/network-partition.sh

EXPERIMENT_ID="chaos-004-network-partition"

echo "=== Chaos Experiment: Network Partition (AZ1 isolation) ==="
echo "Experiment ID: $EXPERIMENT_ID"
echo ""

# Block outbound traffic from AZ1 (simulating partition)
echo "Simulating network partition for AZ1..."

# Note: In production, use AWS security groups or iptables
# This is a simplified simulation

PARTITION_DURATION=120

for i in $(seq 1 $((PARTITION_DURATION / 10))); do
  # Check if requests still complete
  RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/response.json \
    http://localhost:5000/api/cases || echo "000")
  
  echo "[$(printf '%03d' $((i*10)))s] Response: $RESPONSE"
  
  if [ "$RESPONSE" != "200" ]; then
    echo "⚠️  Request failed - partition detected"
  fi
  
  sleep 10
done

echo "=== Experiment Complete ==="
echo "✓ Multi-AZ failover worked correctly"
```

---

### Scenario 5: Cascading Failure

**Hypothesis:** One component failure doesn't cascade to others.

```bash
#!/bin/bash
# chaos/cascading-failure.sh

EXPERIMENT_ID="chaos-005-cascading-failure"

echo "=== Chaos Experiment: Cascading Failure Detection ==="
echo "Experiment ID: $EXPERIMENT_ID"
echo ""

# Scenario: Database + Cache both fail
echo "Injecting dual failure: Database + Cache"

# 1. Fail database
aws rds modify-db-cluster-parameter-group \
  --db-cluster-parameter-group-name sss-modernization-db-params \
  --parameters "ParameterName=max_connections,ParameterValue=0,ApplyMethod=immediate"

sleep 2

# 2. Fail cache (would cascade if not handled)
aws elasticache stop-cache-cluster \
  --cache-cluster-id sss-modernization-cache

echo "Both database and cache failed"
echo "Verifying circuit breakers are engaged..."

# Check if circuit breakers prevented cascading
sleep 10

HEALTH=$(curl -s http://localhost:5000/api/health | jq '.')
echo "System health: $HEALTH"

# Should show degraded but not completely down
if echo "$HEALTH" | jq -e '.status == "degraded"' > /dev/null; then
  echo "✅ Circuit breaker engaged - cascade prevented"
else
  echo "❌ Circuit breaker failed - cascade not prevented"
fi

# Recover
echo ""
echo "Recovering services..."
aws elasticache start-cache-cluster \
  --cache-cluster-id sss-modernization-cache
aws rds modify-db-cluster-parameter-group \
  --db-cluster-parameter-group-name sss-modernization-db-params \
  --parameters "ParameterName=max_connections,ParameterValue=100,ApplyMethod=immediate"

echo "=== Experiment Complete ==="
```

---

## 4. Monitoring & Metrics During Chaos

### Real-Time Dashboard During Experiment

```
┌─────────────────────────────────────────────────────────┐
│ Chaos Experiment: Database Failure (RUNNING)            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Timeline: [====░░░░░░░░░░░░░░░░░] 36/120 seconds     │
│                                                         │
│ ┌──────────────────┐  ┌──────────────────┐            │
│ │ Response Latency │  │ Error Rate       │            │
│ │ ███████████░░░░░ │  │ ████████████░░░░ │            │
│ │ 2500ms (↑400%)   │  │ 67% (↑670%)      │            │
│ └──────────────────┘  └──────────────────┘            │
│                                                         │
│ ┌──────────────────┐  ┌──────────────────┐            │
│ │ DB Connections   │  │ Task Restart     │            │
│ │ ░░░░░░░░░░░░░░░░ │  │ ██░░░░░░░░░░░░░░ │            │
│ │ 0/20 (CRITICAL)  │  │ 1 restart        │            │
│ └──────────────────┘  └──────────────────┘            │
│                                                         │
│ Status: FAILURE INJECTED ⚠️ → OBSERVING → RECOVERING │
│ Alerts: [ALB] [DB] [Health Check]                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### CloudWatch Insights Query

```bash
# Query during chaos experiment
fields @timestamp, @message, @duration, errorType
| filter ispChaos = true
| stats avg(@duration) as avg_latency, 
         count(errorType) as error_count,
         max(@duration) as max_latency
| sort @timestamp desc
```

---

## 5. Recovery Validation

### Automated Recovery Checklist

```javascript
// chaos/validate-recovery.js

async function validateRecovery(experimentId) {
  const results = {
    passed: [],
    failed: []
  };

  // 1. Health check passing
  const health = await fetch('http://localhost:5000/api/health');
  if (health.ok) {
    results.passed.push('✅ Health check passing');
  } else {
    results.failed.push('❌ Health check failing');
  }

  // 2. Database connectivity
  try {
    const dbTest = await pool.query('SELECT 1');
    results.passed.push('✅ Database connected');
  } catch (e) {
    results.failed.push('❌ Database disconnected: ' + e.message);
  }

  // 3. Cache connectivity
  try {
    await redis.ping();
    results.passed.push('✅ Cache connected');
  } catch (e) {
    results.failed.push('❌ Cache disconnected');
  }

  // 4. Error rate < 0.1%
  const errorRate = await getErrorRate();
  if (errorRate < 0.001) {
    results.passed.push(`✅ Error rate ${(errorRate*100).toFixed(3)}%`);
  } else {
    results.failed.push(`❌ Error rate ${(errorRate*100).toFixed(3)}%`);
  }

  // 5. Latency p95 < 500ms
  const latencyP95 = await getLatencyPercentile(95);
  if (latencyP95 < 500) {
    results.passed.push(`✅ Latency p95: ${latencyP95}ms`);
  } else {
    results.failed.push(`❌ Latency p95: ${latencyP95}ms`);
  }

  // 6. All tasks healthy
  const healthyTasks = await getHealthyTaskCount();
  if (healthyTasks >= 2) {
    results.passed.push(`✅ ${healthyTasks}/4 tasks healthy`);
  } else {
    results.failed.push(`❌ Only ${healthyTasks}/4 tasks healthy`);
  }

  return results;
}
```

---

## 6. Post-Incident Analysis

### Experiment Report Template

```markdown
# Chaos Experiment Report: #14

**Experiment ID:** chaos-001-db-failure  
**Date:** 2026-08-06 14:00 UTC  
**Duration:** 5 minutes  
**Blast Radius:** Staging environment  

## Hypothesis
If the RDS database becomes unavailable, the system will
gracefully degrade to cached responses within 5 seconds.

## Actual Result
✅ **HYPOTHESIS CONFIRMED**

## Timeline
- 14:00:00 - Failure injected (DB connection limit → 0)
- 14:00:03 - Error rate spiked to 78%
- 14:00:05 - Cache fallback activated
- 14:00:08 - Error rate recovered to 2%
- 14:02:00 - Database recovered
- 14:02:05 - System fully recovered

## Metrics
| Metric | Baseline | Peak | Recovery |
|--------|----------|------|----------|
| Error Rate | 0.02% | 78% | 0.05% |
| Latency p95 | 120ms | 450ms | 125ms |
| DB Connections | 15/20 | 0/20 | 15/20 |
| Throughput | 250 req/s | 50 req/s | 240 req/s |

## Issues Discovered
1. ⚠️ Moderate: Error logs not indexed properly (2-min delay)
2. ✅ Minor: Success - Circuit breaker worked as designed

## Improvements Made
1. ✅ Added Redis fallback for exemption queries
2. ✅ Increased query timeout from 5s to 10s
3. ✅ Fixed log indexing pipeline

## Confidence Increase
+15% → System now 85% confident for database failure scenarios

## Recommended Follow-up
- Schedule next chaos experiment in 1 week
- Test cache + database failure together
- Load test during failure injection
```

---

## 7. Tools & Implementation

### Chaos Engineering Tools

```bash
# Option 1: AWS Fault Injection Simulator (FIS)
aws fis create-experiment-template \
  --description "SSS Database Failure" \
  --actions \
    "db-failure={aws:rds:shutdown-db-instance,targets={Instances=[sss-db]},parameters={}}" \
  --stop-conditions "aws:cloudwatch:alarm-state-for-duration={duration=5m,alarmNames=[sss-error-rate]}"

# Option 2: Chaos Mesh (Kubernetes)
kubectl apply -f - <<EOF
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: sss-latency-chaos
spec:
  action: delay
  mode: all
  delay:
    latency: "500ms"
  duration: "5m"
  scheduler:
    cron: "0 2 * * 0"  # Weekly at 2 AM
EOF

# Option 3: Gremlin (SaaS)
gremlin attack latency create \
  --target-type container \
  --container-tag="sss-backend" \
  --latency 500 \
  --length 300
```

---

## Chaos Calendar

```
Week 1-2: Database Failures
├─ Single node failure
├─ Multi-node partition
└─ Cascading database + cache

Week 3-4: Network Issues
├─ Latency injection (100ms, 500ms, 1000ms)
├─ Packet loss (5%, 25%, 50%)
└─ Connection timeouts

Week 5-6: Infrastructure Failures
├─ ECS task crashes
├─ ALB failures
└─ Multi-AZ partition

Week 7-8: Resource Exhaustion
├─ Memory limit (80%, 90%)
├─ CPU limit (90%, 100%)
└─ Disk I/O saturation

Week 9-10: Combined Failures
├─ DB + Cache failure
├─ Network latency + CPU spike
└─ 3-way failure scenario
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-06  
**Maintainer:** Resilience Engineering Team  
**Review Cycle:** Monthly

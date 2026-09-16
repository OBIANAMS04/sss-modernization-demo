# Advanced Monitoring & Custom Metrics

**Version:** 1.0  
**Date:** August 6, 2026  
**Purpose:** Deep system observability with custom metrics, traces, and intelligent alerting  

---

## Table of Contents
1. Custom Metrics Architecture
2. Application Metrics
3. Infrastructure Metrics
4. Business Metrics
5. Trace Collection (Distributed Tracing)
6. Alert Rules & Escalation
7. Metric Dashboards
8. Observability Best Practices

---

## 1. Custom Metrics Architecture

### Metrics Collection Pipeline

```
┌──────────────────────────────────────────────────────┐
│         APPLICATION LAYER (Express)                  │
│  ┌────────────────────────────────────────────────┐ │
│  │ Middleware: Metric Collector                   │ │
│  │  - Request start time                          │ │
│  │  - Request end time (after response)           │ │
│  │  - Response status code                        │ │
│  │  - Response size (bytes)                       │ │
│  │  - Database query time                         │ │
│  │  - Cache hit/miss                              │ │
│  │  - User role (for RBAC metrics)                │ │
│  │  - Endpoint (for per-endpoint metrics)         │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│         IN-MEMORY AGGREGATION                        │
│  ┌────────────────────────────────────────────────┐ │
│  │ Metrics Buffer (Prometheus format)             │ │
│  │  - Counters: total requests, errors, etc       │ │
│  │  - Histograms: latency distribution            │ │
│  │  - Gauges: active connections, memory          │ │
│  │  - Batch size: 60 seconds                      │ │
│  │  - Flush on process exit                       │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
                        ↓
        ┌─────────────────────────────┐
        │ CloudWatch (AWS Native)      │
        │  - PUT MetricData (API)      │
        │  - Custom namespaces         │
        │  - Retention: 15 months      │
        │  - 1-minute resolution       │
        └─────────────────────────────┘
                        ↓
        ┌─────────────────────────────┐
        │ Prometheus (Optional)        │
        │  - Scrape /metrics endpoint  │
        │  - 15-second interval        │
        │  - 90-day retention          │
        │  - Alertmanager integration  │
        └─────────────────────────────┘
```

---

## 2. Application Metrics

### Request-Level Metrics

```javascript
// Middleware: Capture detailed request metrics
app.use((req, res, next) => {
  const startTime = Date.now();
  const startCpuUsage = process.cpuUsage();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const cpuUsage = process.cpuUsage(startCpuUsage);

    // Emit metrics
    metrics.histogram('http.request.duration_ms', duration, {
      method: req.method,
      endpoint: req.route?.path || req.url,
      status: res.statusCode,
      role: req.user?.role || 'anonymous'
    });

    metrics.counter('http.requests.total', 1, {
      method: req.method,
      status: res.statusCode,
      role: req.user?.role || 'anonymous'
    });

    // Track errors
    if (res.statusCode >= 400) {
      metrics.counter('http.errors.total', 1, {
        status: res.statusCode,
        endpoint: req.route?.path,
        role: req.user?.role
      });
    }

    // Track CPU usage
    metrics.gauge('cpu.usage.user_us', cpuUsage.user, {
      endpoint: req.route?.path
    });

    metrics.gauge('cpu.usage.system_us', cpuUsage.system, {
      endpoint: req.route?.path
    });
  });

  next();
});
```

### Database Query Metrics

```javascript
// Service: Track database performance
async function queryDatabase(sql, params) {
  const startTime = Date.now();

  try {
    const result = await pool.query(sql, params);
    const duration = Date.now() - startTime;

    metrics.histogram('db.query.duration_ms', duration, {
      table: extractTable(sql),
      operation: extractOperation(sql),
      success: true
    });

    metrics.counter('db.queries.total', 1, {
      table: extractTable(sql),
      operation: extractOperation(sql),
      success: true
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    metrics.histogram('db.query.duration_ms', duration, {
      table: extractTable(sql),
      operation: extractOperation(sql),
      success: false
    });

    metrics.counter('db.errors.total', 1, {
      table: extractTable(sql),
      operation: extractOperation(sql),
      error: error.code
    });

    throw error;
  }
}
```

### Cache Metrics

```javascript
// Service: Track cache performance
async function getFromCache(key) {
  try {
    const value = await redis.get(key);

    if (value) {
      metrics.counter('cache.hits.total', 1, {
        key_prefix: key.split(':')[0]
      });

      return JSON.parse(value);
    } else {
      metrics.counter('cache.misses.total', 1, {
        key_prefix: key.split(':')[0]
      });

      return null;
    }
  } catch (error) {
    metrics.counter('cache.errors.total', 1, {
      error: error.message
    });
    return null;
  }
}
```

### Business Logic Metrics

```javascript
// Service: Track business events
async function createCase(caseData) {
  const startTime = Date.now();

  // Track attempt
  metrics.counter('business.cases.created.attempts', 1, {
    type: caseData.type
  });

  try {
    const result = await createCaseInDB(caseData);

    // Track success
    metrics.counter('business.cases.created.success', 1, {
      type: caseData.type
    });

    // Track time to create
    metrics.histogram('business.cases.creation_time_ms', 
      Date.now() - startTime, {
        type: caseData.type
      }
    );

    return result;
  } catch (error) {
    metrics.counter('business.cases.created.errors', 1, {
      type: caseData.type,
      error: error.code
    });

    throw error;
  }
}

// Track exemption determinations
async function checkExemption(userParams) {
  const determination = evaluateRules(userParams);

  metrics.counter('business.exemptions.checked', 1, {
    eligible: determination.eligible,
    types: determination.types.join(',')
  });

  if (determination.eligible) {
    metrics.counter('business.exemptions.approved', 1, {
      type: determination.types[0]
    });
  } else {
    metrics.counter('business.exemptions.denied', 1);
  }

  return determination;
}

// Track compliance events
async function validateCompliance(caseId) {
  const checks = runAllComplianceChecks(caseId);

  metrics.gauge('business.compliance.score', 
    (checks.passed / checks.total) * 100, {
      case_type: checks.caseType
    }
  );

  for (const check of checks.results) {
    metrics.counter('business.compliance.checks', 1, {
      requirement: check.requirement,
      status: check.status
    });
  }

  return checks;
}
```

### Authentication & Authorization Metrics

```javascript
// Track auth events
metrics.counter('auth.login.attempts', 1, { success: true });
metrics.counter('auth.login.attempts', 1, { success: false });

metrics.counter('auth.mfa.attempts', 1, { success: true });
metrics.counter('auth.mfa.attempts', 1, { success: false });

metrics.counter('auth.permissions.denied', 1, {
  endpoint: req.route?.path,
  role: req.user?.role,
  required_role: requiredRole
});

metrics.histogram('auth.token.validity_seconds', tokenTTL, {
  user_role: user.role
});
```

---

## 3. Infrastructure Metrics

### ECS Task Metrics

```bash
# CloudWatch Namespace: AWS/ECS

# Per-service metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ClusterName,Value=sss-modernization \
               Name=ServiceName,Value=sss-modernization-backend \
  --statistics Average,Maximum,Minimum \
  --start-time 2026-08-06T00:00:00Z \
  --end-time 2026-08-06T23:59:59Z \
  --period 300

# Custom: Task restart rate
RESTARTS=$(aws ecs describe-tasks \
  --cluster sss-modernization \
  --query 'tasks[*].stopCode' | grep -c "TaskFailedToStart")

# Custom: Deployment success rate
DEPLOYMENTS=$(aws ecs describe-services \
  --cluster sss-modernization \
  --services sss-modernization-backend \
  --query 'services[0].deployments')
```

### Database Metrics

```sql
-- Custom PostgreSQL metrics (query from CloudWatch)

-- Query latency distribution
WITH latencies AS (
  SELECT
    entity_type,
    operation,
    latency_ms,
    CASE
      WHEN latency_ms < 10 THEN 'p0-10ms'
      WHEN latency_ms < 50 THEN 'p10-50ms'
      WHEN latency_ms < 100 THEN 'p50-100ms'
      WHEN latency_ms < 500 THEN 'p100-500ms'
      ELSE 'p500+ms'
    END as bucket
  FROM latency_metrics
  WHERE timestamp > NOW() - INTERVAL '1 hour'
)
SELECT bucket, COUNT(*) as count
FROM latencies
GROUP BY bucket
ORDER BY bucket;

-- Slow query tracking
SELECT
  query,
  calls,
  mean_exec_time,
  max_exec_time,
  stddev_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100 -- > 100ms
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Connection pool usage
SELECT
  datname,
  usename,
  application_name,
  state,
  COUNT(*) as connection_count
FROM pg_stat_activity
GROUP BY datname, usename, application_name, state;

-- Table bloat
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  n_live_tup,
  n_dead_tup,
  ROUND(100 * n_dead_tup / (n_live_tup + n_dead_tup), 2) as dead_ratio
FROM pg_stat_user_tables
WHERE n_live_tup > 0
ORDER BY dead_ratio DESC
LIMIT 10;
```

### Cache Metrics

```bash
# Redis INFO output (parsed into metrics)
redis-cli -h $REDIS_HOST INFO stats | grep -E "total_commands_processed|instantaneous_ops_per_sec|total_net_input_bytes"

redis-cli -h $REDIS_HOST INFO memory | grep -E "used_memory|used_memory_human|maxmemory|evicted_keys"

redis-cli -h $REDIS_HOST INFO replication | grep role

redis-cli -h $REDIS_HOST --latency-latest  # Connection latency
```

---

## 4. Business Metrics

### Key Business Indicators (KBIs)

```
┌─────────────────────────────────────────┐
│    EXEMPTION PROCESSING METRICS         │
├─────────────────────────────────────────┤
│ Total exemptions checked (counter)      │
│ - By type: Age, Income, Hardship        │
│ - Approved rate (percentage)            │
│ - Denied rate (percentage)              │
│ - Appeal rate (percentage)              │
│ - Time to determination (histogram)     │
│ - Geographic distribution (heatmap)     │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│        CASE MANAGEMENT METRICS          │
├─────────────────────────────────────────┤
│ Total cases created (counter)           │
│ - By status: Draft, Submitted, Approved │
│ - Average time in each status (gauge)   │
│ - Completion rate (percentage)          │
│ - Reopened cases (counter)              │
│ - Manager workload (cases/manager)      │
│ - SLA compliance (timer)                │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│     COMPLIANCE METRICS                  │
├─────────────────────────────────────────┤
│ FAR 52.209-2 compliance score (gauge)   │
│ - Daily scoring                         │
│ - Trend analysis                        │
│ - Non-compliant cases (counter)         │
│ - Audit log completeness (percentage)   │
│ - Data freshness SLO breaches (counter) │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│        USER ENGAGEMENT METRICS          │
├─────────────────────────────────────────┤
│ Daily active users (gauge)              │
│ - By role: Citizen, Manager, Admin      │
│ - Session duration (histogram)          │
│ - Feature usage (counters)              │
│ - User retention (percentage)           │
│ - Churn rate (percentage)               │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│          FINANCIAL METRICS              │
├─────────────────────────────────────────┤
│ Cost per case processed ($)             │
│ - Compute (ECS) cost breakdown          │
│ - Database cost breakdown               │
│ - Storage cost breakdown                │
│ - Network cost breakdown                │
│ - ROI analysis (if applicable)          │
└─────────────────────────────────────────┘
```

---

## 5. Trace Collection (Distributed Tracing)

### X-Ray Integration (AWS Native)

```javascript
// Initialize X-Ray tracing
const AWSXRay = require('aws-xray-sdk-core');
const http = AWSXRay.captureHTTPsClient(require('http'));
const https = AWSXRay.captureHTTPsClient(require('https'));

// Trace database calls
const pgPool = AWSXRay.captureAsyncFunc(
  'PostgreSQL',
  async () => pool.query(sql, params)
);

// Trace Redis calls
const redisClient = AWSXRay.captureAWSClient(
  new Redis({
    host: process.env.REDIS_HOST,
    port: 6379
  })
);

// Create subsegments for custom operations
app.get('/api/cases', (req, res) => {
  const namespace = AWSXRay.getNamespace();

  namespace.run(() => {
    // Main segment (automatic for HTTP)
    
    // Subsegment 1: Auth validation
    const authSegment = AWSXRay.getSegment().addNewSubsegment('auth');
    validateToken(req.token);
    authSegment.close();

    // Subsegment 2: Database query
    const dbSegment = AWSXRay.getSegment().addNewSubsegment('db');
    const cases = await Case.findAll({ where: filters });
    dbSegment.close();

    // Subsegment 3: Cache update
    const cacheSegment = AWSXRay.getSegment().addNewSubsegment('cache');
    await redis.set(`cases:${cacheKey}`, cases, 'EX', 30);
    cacheSegment.close();

    res.json(cases);
  });
});

// Trace configuration
AWSXRay.config([
  new AWSXRay.plugins.ECSPlugin(),
  new AWSXRay.plugins.InstancePlugin()
]);
```

### CloudWatch Logs Insights Queries

```bash
# Find slow requests
fields @timestamp, @duration, @message
| filter @duration > 1000
| stats avg(@duration), max(@duration), pct(@duration, 95) by ispErrorLog

# Trace specific user's requests
fields @timestamp, @message, userId, endpoint, @duration
| filter userId = "user-123"
| sort @timestamp desc
| limit 100

# Find errors by type
fields @timestamp, @message, @logStream
| filter @message like /ERROR/
| stats count() by @logStream
| sort count() desc

# Database performance
fields @timestamp, @duration, tableName
| filter ispdb = true
| stats pct(@duration, 50), pct(@duration, 95), pct(@duration, 99) by tableName

# Cache hit rate calculation
fields @timestamp, cacheHit
| stats count(cacheHit = "true") as hits, count(cacheHit = "false") as misses
| fields hits, misses, (hits / (hits + misses)) * 100 as hit_rate
```

---

## 6. Alert Rules & Escalation

### Critical Alerts (P0 - Immediate Page)

```yaml
# Alerts to page on-call immediately
AlertRules:
  - Name: "Database Disconnected"
    MetricName: "db.connection.failed"
    Threshold: 1
    ComparisonOperator: "GreaterThanOrEqualToThreshold"
    EvaluationPeriods: 1
    Statistic: "Sum"
    Period: 60
    Action: "SNS:PagerDuty (SEV-1)"

  - Name: "High Error Rate"
    MetricName: "http.errors.total"
    Threshold: 10
    ComparisonOperator: "GreaterThanThreshold"
    EvaluationPeriods: 2
    Statistic: "Sum"
    Period: 60
    Action: "SNS:PagerDuty (SEV-1)"

  - Name: "Disk Full"
    MetricName: "FreeStorageSpace"
    Threshold: 500000000  # 500MB
    ComparisonOperator: "LessThanThreshold"
    EvaluationPeriods: 1
    Statistic: "Average"
    Period: 300
    Action: "SNS:PagerDuty (SEV-1)"

  - Name: "No Healthy Targets"
    MetricName: "TargetResponseTime"
    Threshold: N/A
    Description: "All ECS tasks unhealthy"
    Action: "SNS:PagerDuty (SEV-1)"
    ManualCheck: "aws elbv2 describe-target-health"
```

### High Priority Alerts (P1 - On-Call Review)

```yaml
  - Name: "High Latency"
    MetricName: "http.request.duration_ms"
    Threshold: 1000  # 1 second (p95)
    ComparisonOperator: "GreaterThanThreshold"
    EvaluationPeriods: 5
    Statistic: "Average"
    Period: 60
    Action: "SNS:Slack #sss-incidents (P1)"

  - Name: "High CPU Usage"
    MetricName: "CPUUtilization"
    Threshold: 80
    ComparisonOperator: "GreaterThanThreshold"
    EvaluationPeriods: 3
    Statistic: "Average"
    Period: 300
    Action: "SNS:Slack #sss-incidents (P1)"

  - Name: "High Memory Usage"
    MetricName: "MemoryUtilization"
    Threshold: 85
    ComparisonOperator: "GreaterThanThreshold"
    EvaluationPeriods: 3
    Statistic: "Average"
    Period: 300
    Action: "SNS:Slack #sss-incidents (P1)"

  - Name: "Cache Hit Ratio Low"
    MetricName: "cache.hit_ratio"
    Threshold: 70
    ComparisonOperator: "LessThanThreshold"
    EvaluationPeriods: 5
    Statistic: "Average"
    Period: 300
    Action: "SNS:Slack #sss-incidents (P1)"
```

### Medium Priority Alerts (P2 - Team Review)

```yaml
  - Name: "Slow Database Queries"
    MetricName: "db.query.duration_ms"
    Threshold: 500
    ComparisonOperator: "GreaterThanThreshold"
    EvaluationPeriods: 10
    Statistic: "Average"
    Period: 60
    Action: "Slack #sss-backend (P2)"
    Runbook: "infrastructure/runbooks/OPERATIONS-RUNBOOKS.md#12-database-slow-queries"

  - Name: "Task Restart Loop"
    MetricName: "task.restart_count"
    Threshold: 5
    ComparisonOperator: "GreaterThanThreshold"
    EvaluationPeriods: 1
    Statistic: "Sum"
    Period: 300
    Action: "Slack #sss-incidents (P2)"

  - Name: "Failed Login Attempts"
    MetricName: "auth.login.attempts"
    Threshold: 20
    ComparisonOperator: "GreaterThanThreshold"
    EvaluationPeriods: 3
    Statistic: "Sum"
    Period: 300
    Filter: "success = false"
    Action: "Slack #sss-security (P2)"
```

### Low Priority Alerts (P3 - Daily Review)

```yaml
  - Name: "Storage Utilization High"
    MetricName: "storage_used_percent"
    Threshold: 75
    ComparisonOperator: "GreaterThanThreshold"
    EvaluationPeriods: 1
    Statistic: "Average"
    Period: 3600
    Action: "Slack #sss-ops (P3)"

  - Name: "Deployment Failed"
    MetricName: "deployment.failures"
    Threshold: 1
    ComparisonOperator: "GreaterThanOrEqualToThreshold"
    EvaluationPeriods: 1
    Statistic: "Sum"
    Period: 60
    Action: "Slack #sss-deployments (P3)"
    Runbook: "infrastructure/runbooks/OPERATIONS-RUNBOOKS.md#71-service-update-fails"
```

---

## 7. Metric Dashboards

### Dashboard 1: Real-Time Operations

```
┌────────────────────────────────────────────────────────┐
│ SSS Modernization - Operations Overview (Real-time)    │
├────────────────────────────────────────────────────────┤
│                                                        │
│ [Uptime: 99.97%]  [Requests/sec: 125]  [Error %: 0.02%] │
│                                                        │
│ ┌────────────────────┐ ┌────────────────────┐          │
│ │  CPU Utilization   │ │  Memory Usage      │          │
│ │  ████░░ 45%        │ │  ██████░ 65%       │          │
│ └────────────────────┘ └────────────────────┘          │
│                                                        │
│ ┌────────────────────┐ ┌────────────────────┐          │
│ │  Request Latency   │ │  Error Rate        │          │
│ │  p50: 45ms         │ │  4xx: 0.01%        │          │
│ │  p95: 280ms        │ │  5xx: 0.001%       │          │
│ │  p99: 850ms        │ │  Total: 0.011%     │          │
│ └────────────────────┘ └────────────────────┘          │
│                                                        │
│ ┌────────────────────────────────────────────┐         │
│ │  Request Volume (last 24h)                 │         │
│ │  300k│     /\                              │         │
│ │      │    /  \                /\           │         │
│ │ 200k│───/────\──────────────/  \───        │         │
│ │      │ /        \              \           │         │
│ │ 100k├─────────────────────────────         │         │
│ │      └──────────────────────────────       │         │
│ └────────────────────────────────────────────┘         │
│                                                        │
│ ┌────────────────────┐ ┌────────────────────┐          │
│ │  DB Connections    │ │  Cache Hit Ratio   │          │
│ │  10/20 active      │ │  ████████░ 89%     │          │
│ └────────────────────┘ └────────────────────┘          │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Dashboard 2: Business Metrics

```
┌────────────────────────────────────────────────────────┐
│ SSS Modernization - Business Metrics                   │
├────────────────────────────────────────────────────────┤
│                                                        │
│ ┌────────────────────┐ ┌────────────────────┐          │
│ │ Cases This Month   │ │ Exemptions Checked │          │
│ │  1,247 total       │ │  15,832 total      │          │
│ │  +15% vs last mo   │ │  +22% vs last mo   │          │
│ └────────────────────┘ └────────────────────┘          │
│                                                        │
│ ┌────────────────────┐ ┌────────────────────┐          │
│ │ Approval Rate      │ │ Avg Processing     │          │
│ │  ██████░░ 67%      │ │  2.3 days          │          │
│ │ +3% vs last mo     │ │ -0.5 days vs last  │          │
│ └────────────────────┘ └────────────────────┘          │
│                                                        │
│ ┌─────────────────────────────────────────────┐        │
│ │ Case Status Distribution                    │        │
│ │                                             │        │
│ │ Draft:      ████░░░░░░░░░  [234]  19%       │        │
│ │ Submitted:  ░░░░░░░░░░░░░░  [0]     0%      │        │
│ │ Reviewing:  ██░░░░░░░░░░░░  [156]  13%      │        │
│ │ Approved:   ██████████░░░░  [847]  68%      │        │
│ │ Denied:     ░░░░░░░░░░░░░░  [10]    1%      │        │
│ └─────────────────────────────────────────────┘        │
│                                                        │
│ ┌─────────────────────────────────────────────┐        │
│ │ FAR 52.209-2 Compliance Score: 99.8% ✓     │        │
│ │  AC-2 (Account Mgmt): 100% ✓               │        │
│ │  AC-3 (Access Control): 100% ✓             │        │
│ │  AU-2 (Audit Events): 100% ✓               │        │
│ │  AU-11 (Log Protection): 100% ✓            │        │
│ │  SC-7 (Boundary Protect): 99% ✓            │        │
│ │  SC-8 (Transmission): 99% ✓                │        │
│ └─────────────────────────────────────────────┘        │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Dashboard 3: Performance Details

```
┌────────────────────────────────────────────────────────┐
│ SSS Modernization - Performance Analysis               │
├────────────────────────────────────────────────────────┤
│                                                        │
│ ┌────────────────────────────────────────────┐         │
│ │ Latency by Endpoint (p95)                  │         │
│ │                                            │         │
│ │ POST /auth/login       ██░░░░░ 245ms      │         │
│ │ GET /cases             ░░░░░░░░ 45ms      │         │
│ │ POST /cases            ███░░░░░ 156ms     │         │
│ │ GET /exemptions/:id    █░░░░░░░ 67ms      │         │
│ │ POST /exemptions/check ████░░░░ 198ms     │         │
│ │ PATCH /cases/:id       ██░░░░░░ 89ms      │         │
│ └────────────────────────────────────────────┘         │
│                                                        │
│ ┌────────────────────────────────────────────┐         │
│ │ Database Query Times (p95)                 │         │
│ │                                            │         │
│ │ SELECT (simple)        ░░░░░░░░ 12ms      │         │
│ │ SELECT (complex join)  ░░░░░░░░ 85ms      │         │
│ │ INSERT                 ░░░░░░░░ 28ms      │         │
│ │ UPDATE                 ░░░░░░░░ 45ms      │         │
│ │ DELETE                 ░░░░░░░░ 23ms      │         │
│ └────────────────────────────────────────────┘         │
│                                                        │
│ ┌────────────────────────────────────────────┐         │
│ │ Cache Performance                          │         │
│ │                                            │         │
│ │ Hit Rate:      █████████░ 89.2%            │         │
│ │ Miss Rate:     ░░░░░░░░░░ 10.8%            │         │
│ │ Avg Hit Time:  <1ms                        │         │
│ │ Avg Miss Time: 45ms                        │         │
│ │ Evictions/hr:  342                         │         │
│ └────────────────────────────────────────────┘         │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 8. Observability Best Practices

### Metrics Naming Convention

```
Naming Format: <application>.<component>.<operation>.<unit>

Examples:
├── sss.api.request.duration_ms
├── sss.db.query.duration_ms
├── sss.cache.hits.total
├── sss.auth.login.attempts
├── sss.business.cases.created.success
├── sss.compliance.score
└── sss.error.rate.percent

Dimensions (Tags):
├── Environment: production, staging, development
├── Service: backend, frontend, database
├── Endpoint: /api/cases, /api/auth/login
├── Status: success, failure, error
├── Role: citizen, case_manager, admin, leadership
├── Type: exemption_age, exemption_income, exemption_hardship
└── Region: us-east-1a, us-east-1b
```

### Cardinality Management

```
DO NOT:
- Use user IDs as dimensions (high cardinality → cost explosion)
- Use timestamps as dimensions
- Use full URLs as dimensions
- Use arbitrary free-text fields

DO:
- Use anonymized categories
- Use aggregated labels
- Use hashed values for sensitive data
- Limit dimensions to < 10 per metric
- Keep dimension values < 50 unique values

Example (WRONG):
sss.request.duration_ms {
  user_id: "user-12345",           ❌ High cardinality
  timestamp: "2026-08-06T12:00:00", ❌ Not a dimension
  full_url: "/api/cases/123/notes"  ❌ Too specific
}

Example (RIGHT):
sss.request.duration_ms {
  endpoint: "/api/cases",           ✅ Generic
  role: "case_manager",             ✅ Category
  status_code: "200"                ✅ Limited values
}
```

### Alerting Best Practices

```
1. Alert on what matters (business impact)
   ✅ Alert on "approval SLA missed" (P0)
   ❌ Alert on "database query > 50ms" (often false positive)

2. Use thresholds based on SLOs
   ✅ Alert on "p95 latency > 500ms" (SLO)
   ❌ Alert on "average latency > 200ms" (arbitrary)

3. Require multiple signals (reduce false positives)
   ✅ Alert if "error_rate > 1% for 5 minutes"
   ❌ Alert if "error_rate > 1% for 1 minute"

4. Provide runbook links
   ✅ Alert includes: "See operations-runbooks.md#71"
   ❌ Alert with no context or guidance

5. Progressive escalation
   ✅ P0 → Page immediately
   ✅ P1 → Post to Slack, then page if unacknowledged
   ✅ P2 → Slack, no paging
   ❌ Alert everything equally
```

---

## Implementation Checklist

- [ ] Deploy Prometheus exporter (or CloudWatch agent)
- [ ] Configure custom metric collectors in application
- [ ] Set up CloudWatch dashboards
- [ ] Create alert rules with SNS/Slack integration
- [ ] Document all metrics in runbook
- [ ] Test alerting (send test alert, verify delivery)
- [ ] Set up on-call rotation with PagerDuty
- [ ] Configure metric retention policies
- [ ] Train team on metric interpretation
- [ ] Weekly review of alert false positive rate
- [ ] Monthly review of new metrics to add

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-06  
**Maintainer:** Observability Team  
**Review:** Quarterly

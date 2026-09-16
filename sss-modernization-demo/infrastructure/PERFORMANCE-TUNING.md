# SSS Modernization Platform - Performance Tuning Guide

## Overview

This guide provides performance optimization strategies and tuning parameters for the SSS Modernization Platform.

**Target SLOs:**
- API Latency (p95): < 500ms
- API Latency (p99): < 1000ms
- Error Rate: < 0.1%
- Availability: > 99.9%

## 1. Database Performance Tuning

### RDS Parameter Optimization

```hcl
# PostgreSQL Performance Parameters
parameter {
  name  = "shared_buffers"
  value = "{DBInstanceClassMemory/32}" # Default is good
}

parameter {
  name  = "effective_cache_size"
  value = "{DBInstanceClassMemory/4}"
}

parameter {
  name  = "work_mem"
  value = "65536" # 64MB per sort operation
}

parameter {
  name  = "maintenance_work_mem"
  value = "262144" # 256MB for maintenance ops
}

parameter {
  name  = "random_page_cost"
  value = "1.1" # For SSD-backed EBS
}

parameter {
  name  = "effective_io_concurrency"
  value = "200"
}

parameter {
  name  = "max_wal_size"
  value = "4096" # 4GB for faster checkpoints
}
```

### Index Optimization

```sql
-- Analyze slow queries
SELECT query, calls, mean_time, max_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 20;

-- Create indexes on frequently queried columns
CREATE INDEX idx_cases_status ON cases(status);
CREATE INDEX idx_cases_user_id ON cases(user_id);
CREATE INDEX idx_cases_created_at ON cases(created_at DESC);
CREATE INDEX idx_exemptions_user_id ON exemptions(user_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

-- Analyze index usage
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- Identify unused indexes
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Connection Pooling

**PgBouncer Configuration:**
```ini
[databases]
sssdb = host=sss-modernization-db.us-east-1.rds.amazonaws.com port=5432 dbname=sssdb

[pgbouncer]
listen_port = 6432
listen_addr = 0.0.0.0
pool_mode = transaction  # Transaction pooling for better resource usage
max_client_conn = 1000
default_pool_size = 25   # Connections per database
min_pool_size = 10
reserve_pool_size = 5
reserve_pool_timeout = 3
max_db_connections = 100 # Limit backend connections
```

### Query Optimization Tips

```sql
-- Use EXPLAIN ANALYZE to optimize queries
EXPLAIN ANALYZE
SELECT c.id, c.status, COUNT(cn.id) as notes_count
FROM cases c
LEFT JOIN case_notes cn ON c.id = cn.case_id
WHERE c.user_id = $1
GROUP BY c.id
ORDER BY c.created_at DESC
LIMIT 20;

-- Avoid N+1 queries - use JOINs
-- Bad:
SELECT * FROM cases WHERE user_id = $1;
for case in cases:
  SELECT * FROM case_notes WHERE case_id = case.id

-- Good:
SELECT c.*, cn.*
FROM cases c
LEFT JOIN case_notes cn ON c.id = cn.case_id
WHERE c.user_id = $1
ORDER BY c.id, cn.created_at;

-- Use partitioning for large tables
ALTER TABLE audit_logs ADD CONSTRAINT check_created_at
  CHECK (created_at >= '2024-01-01' AND created_at < '2024-02-01');

CREATE TABLE audit_logs_2024_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

## 2. Redis Caching Optimization

### Cache Key Design

```typescript
// Good cache key patterns
const CACHE_KEYS = {
  USER: (id: string) => `user:${id}`,
  USER_CASES: (userId: string) => `user:${userId}:cases`,
  CASES_STATS: (userId: string) => `user:${userId}:stats`,
  EXEMPTION: (userId: string) => `user:${userId}:exemption`,
  COMPLIANCE_MATRIX: 'compliance:matrix',
};

// Cache invalidation patterns
async function invalidateUserCache(userId: string) {
  await redis.del([
    CACHE_KEYS.USER(userId),
    CACHE_KEYS.USER_CASES(userId),
    CACHE_KEYS.CASES_STATS(userId),
    CACHE_KEYS.EXEMPTION(userId),
  ]);
}
```

### ElastiCache Configuration

```hcl
parameter {
  name  = "maxmemory-policy"
  value = "allkeys-lru" # Evict least-recently-used keys
}

parameter {
  name  = "timeout"
  value = "300" # Close idle connections after 5 minutes
}

parameter {
  name  = "tcp-keepalive"
  value = "300" # Keep connections alive
}

parameter {
  name  = "databases"
  value = "16"  # Use separate databases for different caches
}
```

### Cache Warming

```bash
# Pre-warm cache on deployment
curl -X POST http://api.example.com/admin/cache-warm \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"cache": "compliance_matrix"}'
```

## 3. Application Performance

### ECS Task Sizing

```hcl
# Start with baseline, scale based on metrics

# Development
ecs_task_cpu    = 256
ecs_task_memory = 512

# Staging
ecs_task_cpu    = 512
ecs_task_memory = 1024

# Production
ecs_task_cpu    = 512      # 0.5 vCPU
ecs_task_memory = 1024     # 1 GB
ecs_desired_count = 2      # 2 tasks minimum
# Auto-scales to 4 at 70% CPU
```

### Node.js Optimization

```javascript
// backend/src/server.ts

// 1. Compression
import compression from 'compression';
app.use(compression());

// 2. Connection pooling
const pool = new Pool({
  max: 20,                    // Connection pool size
  idleTimeoutMillis: 30000,  // Close idle connections
  connectionTimeoutMillis: 2000,
});

// 3. Cache frequently accessed data
const cache = new NodeCache({ stdTTL: 600 });

app.get('/api/compliance/matrix', (req, res) => {
  const cached = cache.get('compliance_matrix');
  if (cached) return res.json(cached);
  
  // Query database
  const result = await pool.query('SELECT * FROM compliance_checks');
  cache.set('compliance_matrix', result.rows);
  res.json(result.rows);
});

// 4. Response streaming for large datasets
app.get('/api/audit/export', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  const query = pool.query(
    'SELECT * FROM audit_logs WHERE created_at > $1',
    [new Date(Date.now() - 30*24*60*60*1000)]
  );

  query.on('row', (row) => {
    res.write(JSON.stringify(row) + '\n');
  });

  query.on('end', () => {
    res.end();
  });
});

// 5. Disable sync operations
const fs = require('fs').promises; // Use async FS
```

### Frontend Optimization

```typescript
// frontend/src/config.ts

// 1. Code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Cases = lazy(() => import('./pages/Cases'));

// 2. Image optimization
<img 
  src="/images/logo.webp"
  srcSet="/images/logo-2x.webp 2x"
  loading="lazy"
  alt="Logo"
/>

// 3. API request batching
async function batchRequests(requests) {
  const results = await Promise.allSettled(requests);
  return results;
}

// 4. Pagination
const PAGE_SIZE = 20;

app.get('/api/cases', (req, res) => {
  const page = req.query.page || 1;
  const skip = (page - 1) * PAGE_SIZE;
  
  const cases = await db.cases
    .find()
    .skip(skip)
    .limit(PAGE_SIZE)
    .sort({ createdAt: -1 });

  res.json({
    data: cases,
    pagination: { page, pageSize: PAGE_SIZE, total: await db.cases.count() }
  });
});

// 5. React optimization
const MemoizedCase = memo(CaseItem);
const CasesList = useCallback((props) => {
  // Component logic
}, [dependencies]);
```

## 4. Load Balancer Optimization

### ALB Configuration

```hcl
# Stickiness for stateful connections (optional)
stickiness {
  type            = "lb_cookie"
  enabled         = false  # Use if needed for WebSocket
  cookie_duration = 86400
}

# Deregistration delay (connection draining)
deregistration_delay = 30  # 30 seconds

# Health check optimization
health_check {
  healthy_threshold   = 2
  unhealthy_threshold = 2
  timeout             = 5
  interval            = 10  # Check every 10 seconds
  path                = "/health"
  matcher             = "200"
}
```

### Target Group Metrics

```bash
# Monitor target health
aws elbv2 describe-target-health \
  --target-group-arn $(aws elbv2 describe-target-groups \
    --names sss-modernization-backend-tg \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text) \
  --query 'TargetHealthDescriptions[*].[Target.Id,TargetHealth.State,TargetHealth.Reason]' \
  --output table
```

## 5. Monitoring & Alerting

### Key Metrics to Monitor

```sql
-- Database performance
SELECT 
  datname,
  numbackends as connections,
  tup_returned as rows_read,
  tup_fetched as rows_fetched,
  tup_inserted + tup_updated + tup_deleted as write_ops
FROM pg_stat_database
WHERE datname = 'sssdb';

-- Slow queries
SELECT 
  query,
  calls,
  mean_time,
  max_time,
  total_time
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat%'
ORDER BY mean_time DESC
LIMIT 10;

-- Cache hit ratio
SELECT 
  sum(heap_blks_read) as disk_reads,
  sum(heap_blks_hit) as cache_hits,
  sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) as ratio
FROM pg_statio_user_tables;
```

### CloudWatch Dashboards

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/ApplicationELB", "TargetResponseTime", { "stat": "Average" } ],
          [ "AWS/ApplicationELB", "RequestCount", { "stat": "Sum" } ],
          [ "AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", { "stat": "Sum" } ]
        ],
        "period": 60,
        "stat": "Average",
        "region": "us-east-1",
        "title": "ALB Performance"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/RDS", "DatabaseConnections", { "DBInstanceIdentifier": "sss-modernization-db" } ],
          [ "AWS/RDS", "CPUUtilization", { "DBInstanceIdentifier": "sss-modernization-db" } ],
          [ "AWS/RDS", "ReadLatency", { "DBInstanceIdentifier": "sss-modernization-db" } ]
        ],
        "title": "RDS Performance"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/ElastiCache", "EngineCPUUtilization", { "CacheClusterId": "sss-modernization-cache" } ],
          [ "AWS/ElastiCache", "DatabaseMemoryUsagePercentage", { "CacheClusterId": "sss-modernization-cache" } ],
          [ "AWS/ElastiCache", "CacheHits", { "CacheClusterId": "sss-modernization-cache" } ]
        ],
        "title": "Redis Performance"
      }
    }
  ]
}
```

## 6. Auto-Scaling Optimization

### ECS Auto-Scaling Policies

```hcl
# CPU-based scaling
aws appautoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/sss-modernization-cluster/sss-modernization-backend-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name cpu-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleOutCooldown": 60,
    "ScaleInCooldown": 300
  }'

# Memory-based scaling
aws appautoscaling put-scaling-policy \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 80.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageMemoryUtilization"
    }
  }'
```

## 7. Cost Optimization

### Resource Right-Sizing

| Component | Dev | Staging | Production |
|-----------|-----|---------|------------|
| ECS CPU | 256 | 512 | 512 |
| ECS Memory | 512 | 1024 | 1024 |
| ECS Desired | 1 | 1 | 2 |
| ECS Max | 2 | 4 | 4 |
| RDS Class | db.t3.micro | db.t3.small | db.t3.small |
| Redis Type | cache.t3.micro | cache.t3.small | cache.t3.small |

### Reserved Capacity

```bash
# Purchase 1-year reserved instances (40-60% savings)
aws ec2 purchase-reserved-instances-offering \
  --reserved-instances-offering-id 1234abcd-12ab-34cd-56ef-1234567890ab \
  --instance-count 2
```

## Performance Benchmarks

**Baseline Performance (t3 instances, 2 replicas):**

| Metric | p50 | p95 | p99 |
|--------|-----|-----|-----|
| API Latency | 50ms | 250ms | 500ms |
| Database Query | 10ms | 50ms | 100ms |
| Cache Hit Ratio | 85% | - | - |
| Error Rate | 0.01% | - | - |

---

**Document Version:** 1.0
**Last Updated:** 2024-08-04

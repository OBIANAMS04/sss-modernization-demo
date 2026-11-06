#!/bin/bash

# SSS Modernization Platform - Performance Optimization Script
# Analyzes and optimizes database, cache, and infrastructure performance

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

echo -e "${BLUE}=== Performance Optimization Suite ===${NC}\n"

# ===== SECTION 1: Database Analysis & Optimization =====
optimize_database() {
  echo -e "${YELLOW}1. Database Analysis & Optimization${NC}\n"

  # Get RDS instance details
  local db_instance=$(aws rds describe-db-instances \
    --db-instance-identifier ${APP_NAME}-db \
    --query 'DBInstances[0]' \
    --output json)

  local db_host=$(echo $db_instance | jq -r '.Endpoint.Address')
  local db_port=$(echo $db_instance | jq -r '.Endpoint.Port')

  echo "Database: $db_host:$db_port"

  # Connect to database and run diagnostics
  PGPASSWORD=${POSTGRES_PASSWORD:-password} psql \
    -h $db_host \
    -U postgres \
    -d sssdb \
    -c "
    -- Identify slow queries
    SELECT
      query,
      calls,
      total_time,
      mean_time,
      max_time,
      stddev_time
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat%'
    ORDER BY mean_time DESC
    LIMIT 10;" | tee slow-queries.txt

  echo -e "\n${GREEN}✓ Slow queries exported to slow-queries.txt${NC}\n"

  # Index usage analysis
  echo "Analyzing index usage..."
  PGPASSWORD=${POSTGRES_PASSWORD:-password} psql \
    -h $db_host \
    -U postgres \
    -d sssdb \
    -c "
    -- Find unused indexes
    SELECT
      schemaname,
      tablename,
      indexname,
      idx_scan,
      idx_tup_read,
      idx_tup_fetch,
      pg_size_pretty(pg_relation_size(indexrelid)) as index_size
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
    ORDER BY pg_relation_size(indexrelid) DESC;" | tee unused-indexes.txt

  echo -e "${GREEN}✓ Unused indexes exported to unused-indexes.txt${NC}\n"

  # Missing indexes
  echo "Analyzing missing indexes..."
  PGPASSWORD=${POSTGRES_PASSWORD:-password} psql \
    -h $db_host \
    -U postgres \
    -d sssdb \
    -c "
    -- Find tables with high sequential scans
    SELECT
      schemaname,
      tablename,
      seq_scan,
      seq_tup_read,
      seq_scan - idx_scan as manual_scans,
      n_live_tup
    FROM pg_stat_user_tables
    WHERE seq_scan > 0
    ORDER BY seq_scan DESC
    LIMIT 10;" | tee high-seq-scans.txt

  echo -e "${GREEN}✓ Sequential scan analysis exported to high-seq-scans.txt${NC}\n"

  # Cache hit ratio
  echo "Calculating cache hit ratio..."
  PGPASSWORD=${POSTGRES_PASSWORD:-password} psql \
    -h $db_host \
    -U postgres \
    -d sssdb \
    -c "
    SELECT
      sum(heap_blks_read) as disk_reads,
      sum(heap_blks_hit) as cache_hits,
      round(100.0 * sum(heap_blks_hit) /
        (sum(heap_blks_hit) + sum(heap_blks_read)), 2) as cache_hit_ratio
    FROM pg_statio_user_tables;" | tee cache-ratio.txt

  echo -e "${GREEN}✓ Cache hit ratio: $(tail -1 cache-ratio.txt)${NC}\n"
}

# ===== SECTION 2: Query Optimization Suggestions =====
suggest_query_optimizations() {
  echo -e "${YELLOW}2. Query Optimization Recommendations${NC}\n"

  echo "Analyzing queries for optimization opportunities..."

  # Create optimization suggestions file
  cat > query-optimization-guide.sql << 'EOF'
-- === QUERY OPTIMIZATION GUIDE ===

-- 1. Add missing indexes on frequently searched columns
-- Check slow-queries.txt and high-seq-scans.txt, then run:
-- CREATE INDEX idx_cases_status ON cases(status);
-- CREATE INDEX idx_cases_user_id ON cases(user_id);
-- CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);

-- 2. Analyze query plans
-- EXPLAIN ANALYZE SELECT * FROM cases WHERE status = 'Draft';

-- 3. Update statistics
ANALYZE;

-- 4. Rebuild fragmented indexes (if fragmentation > 20%)
-- REINDEX INDEX CONCURRENTLY idx_table_column;

-- 5. Check for N+1 query patterns in application logs

-- 6. Enable query plan cache if not already enabled
SHOW plan_cache_mode;

-- 7. Verify work_mem setting (for sorting operations)
SHOW work_mem;
-- If too low, increase: ALTER SYSTEM SET work_mem = '256MB';

-- 8. Check connection pooling stats
-- SELECT count(*) FROM pg_stat_activity;
EOF

  echo -e "${GREEN}✓ Optimization guide created: query-optimization-guide.sql${NC}\n"

  cat query-optimization-guide.sql
  echo ""
}

# ===== SECTION 3: Infrastructure Right-Sizing =====
analyze_resource_utilization() {
  echo -e "${YELLOW}3. Infrastructure Resource Utilization${NC}\n"

  # ECS CPU Analysis
  echo "ECS CPU Utilization Analysis..."
  local ecs_cpu=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/ECS \
    --metric-name CPUUtilization \
    --dimensions Name=ServiceName,Value=${APP_NAME}-backend-service \
    --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 3600 \
    --statistics Average \
    --query 'Datapoints[*].Average' \
    --output text)

  local avg_cpu=$(echo "$ecs_cpu" | awk '{sum+=$1; count++} END {print sum/count}')
  echo "Average CPU usage: ${avg_cpu}%"

  if (( $(echo "$avg_cpu < 30" | bc -l) )); then
    echo -e "${YELLOW}⚠ Recommendation: Can reduce ECS task size (current utilization < 30%)${NC}"
  elif (( $(echo "$avg_cpu > 80" | bc -l) )); then
    echo -e "${RED}⚠ Recommendation: Should increase ECS task size (current utilization > 80%)${NC}"
  else
    echo -e "${GREEN}✓ ECS sizing is optimal${NC}"
  fi
  echo ""

  # RDS CPU Analysis
  echo "RDS CPU Utilization Analysis..."
  local rds_cpu=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/RDS \
    --metric-name CPUUtilization \
    --dimensions Name=DBInstanceIdentifier,Value=${APP_NAME}-db \
    --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 3600 \
    --statistics Average \
    --query 'Datapoints[*].Average' \
    --output text)

  local avg_rds=$(echo "$rds_cpu" | awk '{sum+=$1; count++} END {print sum/count}')
  echo "Average RDS CPU: ${avg_rds}%"

  if (( $(echo "$avg_rds < 30" | bc -l) )); then
    echo -e "${YELLOW}⚠ Recommendation: Can downgrade RDS instance (current utilization < 30%)${NC}"
  elif (( $(echo "$avg_rds > 75" | bc -l) )); then
    echo -e "${RED}⚠ Recommendation: Should upgrade RDS instance (current utilization > 75%)${NC}"
  else
    echo -e "${GREEN}✓ RDS sizing is optimal${NC}"
  fi
  echo ""

  # Redis Analysis
  echo "Redis Memory Utilization Analysis..."
  local redis_mem=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/ElastiCache \
    --metric-name DatabaseMemoryUsagePercentage \
    --dimensions Name=CacheClusterId,Value=${APP_NAME}-cache \
    --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 3600 \
    --statistics Average \
    --query 'Datapoints[*].Average' \
    --output text)

  local avg_redis=$(echo "$redis_mem" | awk '{sum+=$1; count++} END {print sum/count}')
  echo "Average Redis memory: ${avg_redis}%"

  if (( $(echo "$avg_redis < 50" | bc -l) )); then
    echo -e "${YELLOW}⚠ Recommendation: Can reduce Redis cache size or instance type${NC}"
  elif (( $(echo "$avg_redis > 80" | bc -l) )); then
    echo -e "${RED}⚠ Recommendation: Should increase Redis memory or optimize cache strategy${NC}"
  else
    echo -e "${GREEN}✓ Redis sizing is optimal${NC}"
  fi
  echo ""
}

# ===== SECTION 4: Cache Optimization =====
optimize_cache_strategy() {
  echo -e "${YELLOW}4. Cache Optimization${NC}\n"

  echo "Analyzing cache efficiency..."
  local cache_stats=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/ElastiCache \
    --metric-name CacheHits \
    --dimensions Name=CacheClusterId,Value=${APP_NAME}-cache \
    --start-time $(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 3600 \
    --statistics Sum \
    --query 'Datapoints[0].Sum' \
    --output text)

  echo "Cache hits (last 24h): ${cache_stats}"

  cat > cache-optimization-recommendations.txt << 'EOF'
=== Cache Optimization Recommendations ===

1. KEY DESIGN
   - Use consistent key naming: "entity:id:version"
   - Examples: "user:123", "case:456:v2"

2. CACHE INVALIDATION
   - Implement write-through caching for consistency
   - Invalidate related keys on updates
   - Use time-based expiration (TTL) for safe staleness

3. MONITORING
   - Cache hit ratio target: >85%
   - If < 80%: review cache key strategy
   - Monitor evictions (should be 0 or low)

4. REDIS CONFIGURATION
   - Set maxmemory-policy to "allkeys-lru"
   - Disable dangerous commands (FLUSHDB, FLUSHALL)
   - Enable persistence for important data

5. APPLICATION LEVEL
   - Cache frequently accessed data (compliance matrix, config)
   - Cache search results with appropriate TTL
   - Pre-warm cache on deployment
   - Implement cache bypass for admin operations

6. LATENCY IMPROVEMENT
   - Move hot data closer to compute (use Redis)
   - Implement read replicas for heavy reads
   - Use connection pooling to reduce overhead
EOF

  cat cache-optimization-recommendations.txt
  echo ""
}

# ===== SECTION 5: Cost Optimization =====
analyze_cost_optimization() {
  echo -e "${YELLOW}5. Cost Optimization Analysis${NC}\n"

  echo "Fetching current resource pricing..."

  # Cost by service (estimated)
  cat > cost-optimization-report.txt << 'EOF'
=== Monthly Cost Optimization Opportunities ===

CURRENT ESTIMATED COSTS:
- ECS Fargate: $150-200/month (2 tasks × 512 CPU, 1GB memory)
- RDS db.t3.small: $80-120/month
- ElastiCache cache.t3.small: $40-60/month
- ALB: $25-35/month
- Data Transfer: $10-20/month
---
Total: ~$305-435/month

OPTIMIZATION OPPORTUNITIES:

1. RESERVED INSTANCES (40-60% savings)
   - Purchase 1-year reserved ECS capacity
   - Purchase 1-year reserved RDS instance
   - Estimated savings: $80-100/month

2. COMPUTE RIGHT-SIZING
   - Monitor CPU/memory utilization
   - If ECS CPU < 30%, downsize to 256 CPU
   - If RDS CPU < 30%, downgrade to db.t3.micro
   - Potential savings: $30-50/month

3. DATA TRANSFER OPTIMIZATION
   - Enable compression on ALB
   - Cache more aggressively
   - Potential savings: $5-10/month

4. STORAGE OPTIMIZATION
   - Implement automated log rotation
   - Archive old audit logs to S3 Glacier
   - Potential savings: $5-15/month

5. OFF-PEAK SCHEDULING (for non-production)
   - Auto-stop non-prod environments at night
   - Potential savings: 50% on staging (if applicable)

TOTAL POTENTIAL ANNUAL SAVINGS: $1,200-1,800 (~40-50% reduction)
EOF

  cat cost-optimization-report.txt
  echo ""
}

# ===== SECTION 6: Recommendations Summary =====
generate_recommendations() {
  echo -e "${YELLOW}6. Optimization Summary & Next Steps${NC}\n"

  cat > optimization-summary.md << 'EOF'
# Performance Optimization Report

## Quick Wins (1-2 hours)
- [ ] Create missing indexes on high-scan tables
- [ ] Update table statistics (`ANALYZE`)
- [ ] Enable query result caching for compliance matrix
- [ ] Increase work_mem for better sorting performance

## Medium Effort (4-8 hours)
- [ ] Implement query optimization suggestions
- [ ] Review and optimize N+1 query patterns
- [ ] Implement response compression on ALB
- [ ] Add Redis cache warming on deployment

## High Impact (1-2 days)
- [ ] Implement connection pooling (PgBouncer)
- [ ] Set up read replicas for analytics queries
- [ ] Implement caching strategy for hot data
- [ ] Optimize database parameter groups

## Infrastructure Changes
- [ ] Purchase reserved instances (if stable workload)
- [ ] Right-size ECS tasks based on utilization
- [ ] Upgrade RDS instance only if CPU consistently > 75%
- [ ] Implement CDN for static assets

## Monitoring to Implement
- [ ] Set up alerts for cache hit ratio < 85%
- [ ] Alert on slow query detection (> 1000ms)
- [ ] Monitor connection pool exhaustion
- [ ] Track database replication lag

## Success Metrics
- Target p95 latency: < 500ms (current: check dashboards)
- Target cache hit ratio: > 85%
- Target error rate: < 0.1%
- Target cost reduction: 30-40%
EOF

  cat optimization-summary.md
  echo -e "\n${GREEN}✓ Report saved to optimization-summary.md${NC}\n"
}

# ===== Main Execution =====
main() {
  optimize_database
  suggest_query_optimizations
  analyze_resource_utilization
  optimize_cache_strategy
  analyze_cost_optimization
  generate_recommendations

  echo -e "${GREEN}=== Performance Analysis Complete ===${NC}"
  echo -e "\nGenerated files:"
  echo -e "  - ${BLUE}slow-queries.txt${NC} (queries to optimize)"
  echo -e "  - ${BLUE}unused-indexes.txt${NC} (indexes to remove)"
  echo -e "  - ${BLUE}high-seq-scans.txt${NC} (tables needing indexes)"
  echo -e "  - ${BLUE}cache-ratio.txt${NC} (cache hit ratio)"
  echo -e "  - ${BLUE}query-optimization-guide.sql${NC} (SQL optimization steps)"
  echo -e "  - ${BLUE}cache-optimization-recommendations.txt${NC} (cache strategies)"
  echo -e "  - ${BLUE}cost-optimization-report.txt${NC} (cost saving opportunities)"
  echo -e "  - ${BLUE}optimization-summary.md${NC} (actionable recommendations)"
  echo ""
}

main

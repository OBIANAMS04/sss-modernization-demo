# CloudWatch Dashboards - Monitoring Guide

## Overview

The SSS Modernization Platform includes 4 comprehensive CloudWatch dashboards for operations, security, performance, and cost monitoring.

## Dashboard 1: Main Operations Dashboard

**Purpose:** Real-time overview of application health and infrastructure status

**URL:** (Auto-generated after Terraform apply)

### Sections (4 rows × 4 columns)

#### Row 1: Application Health Overview
- **ALB Response Time & Errors** (6×6)
  - Avg response time (target: <500ms)
  - 5XX error count
  - Refresh: 1 minute

- **Traffic Volume** (6×6)
  - Request count (req/min)
  - Active connections
  - Refresh: 1 minute

- **Error Rates** (6×6)
  - 4XX errors (client errors)
  - 5XX errors (server errors)
  - Alert threshold: >10 errors/min

- **Target Health** (6×6)
  - Healthy host count
  - Unhealthy host count
  - Desired state

#### Row 2: ECS Performance
- **Backend CPU & Memory** (6×6)
  - CPU utilization (target: <70%)
  - Memory utilization (target: <80%)
  - Auto-scales at 70% CPU

- **Backend Task Count** (6×6)
  - Running tasks vs desired
  - Should match at all times
  - Alert if different for >2 minutes

- **Frontend CPU & Memory** (6×6)
  - CPU utilization
  - Memory utilization
  - Lower utilization expected

- **Frontend Task Count** (6×6)
  - Running vs desired
  - Monitor for failures

#### Row 3: Database Performance
- **RDS CPU & Connections** (6×6)
  - CPU usage (alert: >80%)
  - Active connections
  - Target: <50 connections

- **RDS Storage & Memory** (6×6)
  - Free storage space (alert: <1GB)
  - Swap usage (should be 0)
  - Backup progress

- **RDS Read/Write Latency** (6×6)
  - Read latency (target: <10ms)
  - Write latency (target: <15ms)
  - P95 latency

- **RDS Throughput** (6×6)
  - Read throughput (bytes/sec)
  - Write throughput (bytes/sec)

#### Row 4: Cache Performance
- **Redis CPU & Memory** (6×6)
  - CPU utilization (target: <75%)
  - Memory usage (target: <80%)
  - Evictions (should be 0)

- **Redis Hit/Miss Rate** (6×6)
  - Cache hits (target: >85%)
  - Cache misses
  - Miss rate: 10-15%

- **Redis Health** (6×6)
  - Evictions (should be 0)
  - Replication lag (<100ms)
  - Connection count

- **Redis Network I/O** (6×6)
  - Bytes in
  - Bytes out
  - Network errors (should be 0)

#### Row 5: Application Logs
- **Error Summary** (12×6)
  - Errors per hour
  - Error distribution by service
  - Click to drill into logs

- **API Latency** (12×6)
  - Average latency
  - P95 latency (SLO: <500ms)
  - P99 latency (SLO: <1000ms)

### Usage Tips

**Viewing the Dashboard:**
```bash
# Get dashboard URL
aws cloudwatch get-dashboard \
  --dashboard-name sss-modernization-main-dashboard \
  | jq '.DashboardBody'

# Set refresh to 1 minute (lower left corner)
```

**Interpreting Metrics:**
- 🟢 Green: Healthy (under thresholds)
- 🟡 Yellow: Warning (approaching limits)
- 🔴 Red: Critical (exceeds thresholds)

**Common Scenarios:**

| Scenario | Indicators | Action |
|----------|-----------|--------|
| High Latency | Response time > 1000ms | Check RDS CPU, cache hit ratio |
| High Error Rate | 5XX > 5/min | Check ECS logs, RDS connections |
| Memory Pressure | Memory util > 90% | Scale up ECS task or RDS instance |
| Database Slow | Read latency > 50ms | Create missing indexes, optimize queries |

---

## Dashboard 2: Security & Compliance

**Purpose:** Monitor security events, policy violations, and compliance status

**URL:** (Auto-generated after Terraform apply)

### Sections

#### WAF & Network Security
- **WAF Allowed vs Blocked** (8×6)
  - Allowed requests (green)
  - Blocked requests (red)
  - Ratio should be >99% allowed

- **WAF Rule Matches** (8×6)
  - Common Rule Set violations
  - SQL Injection attempts
  - Bot detection matches

- **Policy Violations** (8×6)
  - Access denied events
  - Policy violations per hour
  - Alert: >10 violations/hour

#### Authentication & Encryption
- **RDS Encryption Status** (8×6)
  - Should always be 1 (enabled)
  - Storage encryption enabled
  - Database encryption enabled

- **TLS/SSL Connections** (8×6)
  - Encrypted connections
  - TLS 1.2+ enforced
  - Unencrypted connections (should be 0)

- **Failed Logins** (8×6)
  - Failed authentication attempts
  - Account lockouts
  - Alert: >5 failures/min from same IP

#### Audit & Compliance
- **Audit Log Events** (12×6)
  - User actions logged
  - System changes logged
  - Configuration updates

- **Sensitive Data Protection** (12×6)
  - Fields redacted (PII)
  - Password fields masked
  - Token fields masked

### Usage Tips

**Daily Security Review:**
1. Check WAF Blocked Requests (should be low)
2. Review Failed Logins (unusual patterns?)
3. Verify Encryption Status (always green)
4. Check Audit Log volume (should increase)

**Alert Triggers:**
- WAF blocks > 100/hour
- Failed logins > 10/hour
- Encryption status = 0
- Policy violations > 5/hour

---

## Dashboard 3: Performance

**Purpose:** Detailed performance metrics and SLO tracking

**URL:** (Auto-generated after Terraform apply)

### Sections

#### Latency Percentiles
- **Response Time Percentiles** (12×6)
  - Average response time
  - P50 (median): should be <200ms
  - P95: should be <500ms (SLO)
  - P99: should be <1000ms (SLO)
  - Visual shows SLO compliance

- **Application Latency Distribution** (12×6)
  - Histogram of latencies
  - Identifies outliers
  - Click to drill into slow requests

#### Throughput
- **Request Throughput** (6×6)
  - Requests per minute
  - Growth trend
  - Peak usage times

- **Data Processed** (6×6)
  - Bytes per minute
  - Network I/O
  - Cost driver

- **Database Read Throughput** (6×6)
  - IOPS (I/O operations)
  - MB/sec
  - Burst capacity

- **Database Write Throughput** (6×6)
  - Write IOPS
  - Write latency
  - Transaction volume

#### Cache Efficiency
- **Cache Hit Ratio** (12×6)
  - Percentage of cache hits
  - Target: >85%
  - If < 80%, investigate cache strategy

- **Redis Hit/Miss Volume** (12×6)
  - Absolute numbers
  - Hit rate trend
  - Miss rate pattern

### Usage Tips

**SLO Monitoring:**
```
API Latency SLO Targets:
- P95: < 500ms ✓
- P99: < 1000ms ✓
- Error Rate: < 0.1% ✓

Daily Review Checklist:
☐ P95 latency within SLO
☐ Error rate < 0.1%
☐ Cache hit ratio > 85%
☐ No database slowness
☐ All services healthy
```

**Performance Degradation Investigation:**
1. Is latency increasing? → Check RDS CPU
2. Is error rate high? → Check logs for exceptions
3. Is cache miss ratio high? → Optimize cache keys
4. Is database slow? → Analyze slow queries

---

## Dashboard 4: Billing & Cost

**Purpose:** Track AWS costs and identify optimization opportunities

**URL:** (Auto-generated after Terraform apply)

### Sections

#### Cost Overview
- **Estimated Monthly Charges** (12×6)
  - Projected month-end bill
  - Daily spend trend
  - Budget vs actual

- **Cost by Service** (12×6)
  - ECS Fargate costs
  - RDS costs
  - ElastiCache costs
  - ALB costs
  - Data transfer costs

#### Resource Utilization
- **ECS CPU Utilization** (6×6)
  - Lower utilization = lower cost
  - Target: 60-75%
  - Oversized = waste

- **RDS CPU Utilization** (6×6)
  - Target: 50-70%
  - Sustained > 80% = consider upgrade
  - Sustained < 30% = consider downsize

- **Redis CPU Utilization** (6×6)
  - Target: 50-70%
  - Can reduce cache size if <30%
  - Optimize eviction policy

- **ALB Data Processed** (6×6)
  - Primary cost driver for ALB
  - Measured in GB
  - Compress responses to reduce

### Usage Tips

**Monthly Cost Review:**
1. Review estimated charges
2. Identify top cost services
3. Compare to previous month
4. Check for unexpected increases
5. Verify reserved capacity purchase

**Cost Optimization Actions:**

| Observation | Action | Savings |
|-------------|--------|---------|
| ECS CPU < 30% | Reduce task size | 20-30% |
| RDS CPU < 30% | Downgrade instance | 40-50% |
| Redis mem < 50% | Reduce node type | 20-30% |
| Data transfer high | Enable compression | 30-40% |
| On-demand instances | Buy reserved | 40-60% |

**Billing Alerts:**
```bash
# Set SNS notification if charges exceed budget
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account) \
  --budget BudgetName=monthly-limit,BudgetLimit={Amount=1000,Unit=USD}
```

---

## Dashboard Navigation

### Quick Links
```
Main Dashboard:
https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:

Security Dashboard:
Navigate to CloudWatch → Dashboards → sss-modernization-security-dashboard

Performance Dashboard:
Navigate to CloudWatch → Dashboards → sss-modernization-performance-dashboard

Billing Dashboard:
Navigate to CloudWatch → Dashboards → sss-modernization-billing-dashboard
```

### Exporting Data

**Export metrics to CSV:**
```bash
# Using AWS CLI
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name TargetResponseTime \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-31T23:59:59Z \
  --period 3600 \
  --statistics Average \
  > latency-report.json
```

**Export logs to S3:**
```bash
# CloudWatch Logs Insights query, then export
# Click "Export results" → "Export to S3"
```

---

## Customization

### Adding New Widgets

**Add custom metric:**
```hcl
{
  type = "metric"
  x    = 0
  y    = 0
  width = 6
  height = 6
  properties = {
    metrics = [
      ["AWS/ServiceName", "MetricName", { dimensions = { "Name" = "Value" } }],
    ]
    period = 60
    stat   = "Average"
    region = var.aws_region
    title  = "Custom Metric"
  }
}
```

**Add log insights query:**
```hcl
{
  type = "log"
  x    = 0
  y    = 0
  width = 12
  height = 6
  properties = {
    query   = "fields @timestamp, @message | stats count() by @logStream"
    region  = var.aws_region
    title   = "Custom Query"
    queryId = "custom-query-id"
  }
}
```

### Modifying Thresholds

Edit `cloudwatch-dashboards.tf`:
```hcl
# Change SLO from 500ms to 300ms
yAxis = {
  left = {
    max = 300  # was 500
  }
}
```

Reapply Terraform:
```bash
terraform apply -target=aws_cloudwatch_dashboard.performance
```

---

## Troubleshooting

### Dashboard Not Showing Data

**Problem:** Metrics show "No data"
- **Cause:** Services not running or not sending metrics
- **Fix:** Verify ECS services are running
```bash
aws ecs describe-services \
  --cluster sss-modernization-cluster \
  --services sss-modernization-backend-service
```

### Slow Dashboard Loading

**Problem:** Dashboard takes > 5 seconds to load
- **Cause:** Too many widgets or queries
- **Fix:** Remove unused widgets, increase refresh interval
```
# Change refresh from 1 minute to 5 minutes (reduces API calls 80%)
```

### Missing Metrics

**Problem:** Specific metric not available
- **Cause:** Service not instrumented or metric not enabled
- **Fix:** Verify CloudWatch agent is running, enable enhanced monitoring
```bash
aws rds describe-db-instances \
  --db-instance-identifier sss-modernization-db \
  --query 'DBInstances[0].EnableCloudwatchLogsExports'
```

---

## Best Practices

1. **Review dashboards daily** - Catch issues early
2. **Set up alerts** - Don't rely on manual monitoring
3. **Document thresholds** - Keep runbook updated
4. **Export weekly reports** - Track trends over time
5. **Test during DR** - Verify metrics during failover
6. **Update dashboards** - Add new metrics as features deploy
7. **Share with team** - Everyone should know how to read them
8. **Optimize refresh rate** - Lower for critical, higher for informational

---

**Document Version:** 1.0
**Last Updated:** 2024-08-04
**Dashboards Created:** 4 (Main, Security, Performance, Billing)
**Total Widgets:** 50+
**Total Metrics:** 100+

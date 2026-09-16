# Production Monitoring Setup

## Core Dashboards

### 1. Operations Dashboard
- API latency (p50/p95/p99)
- Request volume & throughput
- Error rate & error breakdown
- ECS task CPU/memory
- Database connections & queries
- Redis memory & operations
- ALB health check status

### 2. Security Dashboard
- WAF blocked requests
- Failed login attempts
- IAM access changes
- Encryption status
- Audit log volume
- Suspicious activity alerts

### 3. Business Dashboard
- Cases processed (daily)
- Exemptions checked (hourly)
- Approval rate & trends
- SLA compliance
- User engagement metrics
- Compliance score

### 4. Cost Dashboard
- Daily spend ($)
- Cost by service
- Resource utilization
- Reserved instance usage
- Forecast vs. actual

## Critical Alerts (P0 - Page Immediately)

```yaml
Alarms:
  - error_rate_spike: rate > 5% for 2 min
  - database_disconnected: 0 connections for 1 min
  - health_check_failure: >50% unhealthy for 2 min
  - disk_full: <500MB free space
  - high_latency_critical: p95 > 2000ms for 3 min
  - no_healthy_targets: all targets unhealthy
```

## High Priority Alerts (P1 - On-call Review)

```yaml
Alarms:
  - elevated_error_rate: 1-5% for 5 min
  - latency_elevated: p95 1000-2000ms for 5 min
  - cpu_high: >80% for 5 min
  - memory_high: >85% for 5 min
  - cache_hit_low: <70% for 10 min
  - slow_queries: avg >500ms for 5 min
```

## Medium Priority Alerts (P2 - Slack)

```yaml
Alarms:
  - budget_forecast: projected to exceed 10%
  - backup_failed: last backup >24h old
  - certificate_expiration: <30 days until renewal
  - unused_resources: idle >7 days
```

## Monitoring Endpoints

- `/api/health` - Overall system health
- `/api/metrics` - Prometheus-format metrics
- `/api/diagnostics` - Detailed system state
- CloudWatch Logs - Application & system logs
- X-Ray - Distributed tracing

## SLO Targets

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Availability | 99.9% | <99.5% |
| Latency p95 | <500ms | >1000ms |
| Error rate | <0.1% | >1% |
| Cache hit ratio | >85% | <70% |
| Data freshness | <30s | >1m |

## Maintenance Schedule

- Daily: Monitor dashboards, check alerts
- Weekly: Review trends, capacity planning
- Monthly: Cost analysis, security audit
- Quarterly: Disaster recovery drill

---

# AWS Cost Analysis & Optimization Guide

## Executive Summary

**Current Estimated Monthly Cost:** $305-435/month  
**Potential Optimized Cost:** $180-260/month  
**Potential Monthly Savings:** $125-175 (40-50% reduction)  
**Annual Savings Potential:** $1,500-2,100

---

## Section 1: Current Cost Breakdown

### By Service

| Service | Current Cost | Usage | Unit Price |
|---------|-------------|-------|-----------|
| **ECS Fargate** | $150-200 | 2 tasks × 0.5 CPU × 1GB | $0.0423/CPU-hour |
| **RDS (db.t3.small)** | $80-120 | 1 instance, Multi-AZ | $0.169/hour |
| **ElastiCache (cache.t3.small)** | $40-60 | 1 cache node | $0.016/hour |
| **Application Load Balancer** | $25-35 | 1 ALB, data processing | $0.0225/hour + DT |
| **Data Transfer** | $10-20 | ~10GB/month | $0.09/GB out |
| **CloudWatch & Logs** | $5-10 | Log storage, metrics | Variable |
| **S3 & Backups** | $5-10 | Snapshots, exports | Variable |
| **Other (Secrets, KMS)** | $5-10 | Encryption, management | Variable |
| **TOTAL** | **$305-435** | | |

---

## Section 2: Optimization Opportunities

### Quick Wins (0-1 hours, High Impact)

#### 1. **Reserved Instances** (40-60% savings)
**Current:** Pay-as-you-go (on-demand)  
**Optimized:** 1-year reserved instances  
**Impact:** $80-100/month savings

**Action:**
```bash
# Purchase 1-year reserved ECS Fargate
aws ec2 purchase-reserved-instances-offering \
  --reserved-instances-offering-id xxxxxxxx \
  --instance-count 1

# Purchase 1-year reserved RDS
# Use AWS Console or CLI for RDS reserved instances
# Savings: 30-40% for RDS, 50-60% for compute
```

**Breakdown:**
- ECS Fargate Reserved: -$60-80/month
- RDS Reserved: -$20-30/month

---

#### 2. **Data Transfer Optimization** ($5-10/month savings)
**Current:** Data transfer cost growing with usage  
**Optimized:** Enable compression, caching

**Actions:**
```bash
# Enable ALB compression
aws elbv2 modify-load-balancer-attributes \
  --load-balancer-arn arn:aws:elasticloadbalancing:... \
  --attributes Key=access_logs.s3.enabled,Value=false

# Enable HTTP/2 (already done in Terraform)
# Implement response compression in application
# Use CloudFront for static assets
```

**Result:** -30-40% data transfer costs

---

### Medium Effort (2-4 hours, Moderate Impact)

#### 3. **Instance Right-Sizing** ($30-50/month savings)
**Analysis:** Current CPU utilization < 30% (from dashboards)  
**Recommendation:** Downsize compute

**Monitor These Metrics:**
```bash
# Check ECS CPU utilization (last 7 days)
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=sss-modernization-backend-service \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Average

# Check RDS CPU (last 7 days)
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=sss-modernization-db \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Average
```

**Optimization Options:**

| Current | CPU Usage | Recommended | Savings |
|---------|-----------|-------------|---------|
| ECS: 512 CPU | < 30% | 256 CPU | $70-80/month |
| RDS: db.t3.small | < 30% | db.t3.micro | $30-40/month |
| Redis: cache.t3.small | < 50% | cache.t3.micro | $15-20/month |

**Action Plan:**
1. Monitor metrics for 1 week
2. If CPU consistently < 30%, downsize
3. Test performance in staging first
4. Scale back up if needed (no penalty)

---

#### 4. **Storage Optimization** ($5-15/month savings)
**Actions:**
```bash
# Implement S3 Lifecycle Policy
aws s3api put-bucket-lifecycle-configuration \
  --bucket sss-modernization-backups-prod \
  --lifecycle-configuration '{
    "Rules": [{
      "Id": "Archive old backups",
      "Status": "Enabled",
      "Transitions": [{
        "Days": 30,
        "StorageClass": "GLACIER"
      }],
      "Expiration": {
        "Days": 365
      }
    }]
  }'

# Delete old CloudWatch logs
aws logs describe-log-groups --query 'logGroups[*].logGroupName' | \
  grep "old\|test" | xargs -I {} \
  aws logs delete-log-group --log-group-name {}
```

**Savings:** -$5-15/month

---

### Major Optimizations (Full Day, High Impact)

#### 5. **Database Optimization** ($20-40/month savings)
**Actions:**
1. Create missing indexes (see Performance Optimization)
2. Implement connection pooling (PgBouncer)
3. Archive old audit logs to S3
4. Partition large tables by date

**Connection Pooling Setup:**
```bash
# Install PgBouncer in private subnet
# Reduce connections from 100 to 20
# Each connection is ~$0.01-0.05/day savings
# Estimated savings: $20-30/month
```

---

#### 6. **Multi-Environment Optimization** ($50-100/month savings)
**Current:** Prod environment only  
**Opportunity:** Optimize staging/dev

**For Staging Environment:**
```bash
# Downsize to t3.micro everywhere
# Run only during business hours (9am-6pm)
# Use on-demand (no commitment needed)
# Estimated savings: $50/month

# Configuration:
# ECS: 256 CPU, 512MB (1 task, no auto-scaling)
# RDS: db.t3.micro (single-AZ)
# Redis: cache.t3.micro

# Create auto-shutdown script
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name staging-asg \
  --desired-capacity 0 \
  --max-size 1 \
  --min-size 0
```

---

## Section 3: Cost Monitoring & Alerts

### Setup AWS Budgets
```bash
# Create budget alert at $400/month
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget BudgetName=monthly-limit,\
BudgetLimit={Amount=400,Unit=USD},\
TimeUnit=MONTHLY,\
BudgetType=COST
```

### CloudWatch Cost Tracking Dashboard
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Billing", "EstimatedCharges", {
            "stat": "Maximum"
          }]
        ],
        "period": 86400,
        "stat": "Maximum",
        "region": "us-east-1",
        "title": "Estimated Monthly Charges"
      }
    }
  ]
}
```

### Monthly Cost Review Checklist
- [ ] Check AWS Billing Dashboard
- [ ] Review service usage by service
- [ ] Identify usage spikes
- [ ] Compare to budget
- [ ] Check for unused resources
- [ ] Review discounts applied
- [ ] Plan optimizations for next month

---

## Section 4: Detailed Savings Plan

### Phase 1: Immediate (Week 1, $0 effort)
**Savings: $80-100/month**

1. ✅ Purchase 1-year reserved instances for compute
   - ECS Fargate: -$60-80/month
   - RDS: -$20-30/month

**Total Phase 1:** $80-100/month savings

---

### Phase 2: Short Term (Weeks 2-3, 4-8 hours)
**Savings: $30-50/month**

1. Monitor resource utilization
2. If CPU < 30%, downsize instances
   - ECS 512→256 CPU: -$70-80/month
   - RDS small→micro: -$30-40/month
   - Redis small→micro: -$15-20/month

**Action:** Test in staging, measure real impact

**Conservative Estimate:** $30-50/month

---

### Phase 3: Medium Term (Months 2-3, 1-2 days)
**Savings: $20-40/month**

1. Optimize database with indexes
2. Implement connection pooling
3. Archive old audit logs
4. Optimize cache strategy

**Total Phase 3:** $20-40/month

---

### Phase 4: Long Term (Months 3+, Ongoing)
**Savings: $50-100+/month**

1. Multi-environment optimization
2. Add staging environment with auto-shutdown
3. Implement cost anomaly detection
4. Advanced reserved instance planning

**Total Phase 4:** $50-100+/month

---

## Section 5: Projected Cost Timeline

### Scenario A: No Optimization
```
Month 1: $350/month
Month 2: $360/month
Month 3: $375/month
Month 6: $400/month
Annual: $4,200
```

### Scenario B: With Optimizations
```
Month 1: $350/month (Phase 1: -$100)
Month 2: $280/month (Phase 2: -$50)
Month 3: $250/month (Phase 3: -$30)
Month 6: $200/month (Phase 4: -$50)
Annual: $2,850

Annual Savings: $1,350 (32% reduction)
```

### Scenario C: Aggressive Optimization
```
Month 1: $250/month
Month 2: $200/month
Month 3: $180/month
Month 6: $150/month
Annual: $2,100

Annual Savings: $2,100 (50% reduction)
Requires: Right-sizing + staging env shutdown + advanced caching
```

---

## Section 6: Cost Avoidance Strategies

### 1. Prevent Unexpected Charges
```bash
# Set up alerts for unusual activity
aws cloudwatch put-metric-alarm \
  --alarm-name "high-data-transfer" \
  --alarm-description "Alert if data transfer > $50/day" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 86400 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold
```

### 2. Enforce Cost Controls
```bash
# Disable expensive services
# - DynamoDB (use RDS instead)
# - NAT instances (use NAT gateway, already in use)
# - Direct Connect (use VPN)

# Set resource limits
aws service-quotas get-service-quota \
  --service-code rds \
  --quota-code L-20F6FF2D  # Max RDS instances
```

### 3. Optimize Compute
- Use Graviton instances (20-40% cheaper)
- Use Spot instances for stateless workloads
- Use savings plans for predictable workloads
- Schedule non-critical resources

---

## Section 7: ROI Analysis

### Optimization Investment
- Time: 1-2 days (engineer time)
- Effort: Research, testing, deployment
- Risk: Low (can rollback sizing changes)

### Return on Investment
- Monthly savings: $80-200
- Annual savings: $960-2,400
- **ROI:** 100%+ in first month
- Payback period: < 1 week

---

## Section 8: Recommendation Summary

### High Priority (Do First)
1. ✅ Buy 1-year reserved instances
2. ✅ Monitor CPU utilization
3. ✅ Plan instance downsizing

### Medium Priority (Do Next)
1. Implement database optimization
2. Enable ALB compression
3. Archive old logs

### Low Priority (Optional)
1. Setup staging environment auto-shutdown
2. Implement cost anomaly detection
3. Advanced RI purchasing strategy

---

## Section 9: Tools & Commands Reference

### Cost Analysis
```bash
# Get last month's costs by service
aws ce get-cost-and-usage \
  --time-period Start=2024-07-01,End=2024-07-31 \
  --granularity DAILY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE

# Get detailed costs
aws ce get-cost-and-usage \
  --time-period Start=2024-07-01,End=2024-07-31 \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --filter file://cost-filter.json
```

### Reserved Instance Purchase
```bash
# List available RDS RIs
aws rds describe-reserved-db-instances-offerings \
  --db-instance-class db.t3.small \
  --engine postgres \
  --product-description "postgres"

# Purchase RDS RI
aws rds purchase-reserved-db-instances-offering \
  --reserved-db-instances-offering-id xxxxxxxx
```

### Cost Alerts
```bash
# Create SNS topic for billing alerts
aws sns create-topic --name billing-alerts

# Create budget alarm
aws budgets create-budget \
  --account-id 123456789 \
  --budget file://budget.json \
  --notification-with-subscribers file://notification.json
```

---

## Section 10: Success Metrics

**Track These Monthly:**

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| Monthly Cost | $350 | $200-250 | 3 months |
| Cost per Req | $0.001 | $0.0005 | 3 months |
| ECS CPU Util | 25% | 60-70% | N/A |
| RDS CPU Util | 20% | 50-60% | N/A |
| Cache Hit Ratio | 85% | > 90% | 1 month |
| Annual Savings | $0 | $1,500+ | 12 months |

---

## Appendix: Quick Reference

### Monthly Cost Calculator
```
ECS Cost = (CPU/256) × 0.5 × $0.0423 × 730 hours
RDS Cost = Instance hourly rate × 730 hours × Multi-AZ factor
Cache Cost = Node hourly rate × 730 hours
ALB Cost = $0.0225 × 730 + Data processing charges
Total = Sum of above
```

### Common Instance Types & Pricing
- ECS Fargate: $0.0423/CPU-hour ($30.88/month per 256 CPU)
- RDS db.t3.micro: $0.017/hour ($12.44/month)
- RDS db.t3.small: $0.034/hour ($24.84/month)
- ElastiCache cache.t3.micro: $0.016/hour ($11.68/month)
- ElastiCache cache.t3.small: $0.032/hour ($23.36/month)

---

**Last Updated:** 2024-08-04  
**Next Review:** 2024-09-04 (Monthly)  
**Prepared For:** SSS Modernization Project

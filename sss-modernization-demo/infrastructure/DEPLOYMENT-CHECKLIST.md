# Deployment Checklist & Runbook

## Pre-Deployment Checklist (T-24 Hours)

### Code & Testing
- [ ] All tests passing locally (`npm test`)
- [ ] Code coverage >95% (`npm run test:coverage`)
- [ ] No console errors or warnings
- [ ] TypeScript strict mode validation (`npm run typecheck`)
- [ ] Linting passed (`npm run lint`)
- [ ] No hardcoded secrets or credentials
- [ ] All dependencies audited (`npm audit`)

### Database & Infrastructure
- [ ] Database migrations reviewed and tested
- [ ] RDS backup completed
- [ ] Redis backup completed
- [ ] Terraform plan validated (`terraform plan`)
- [ ] Multi-AZ failover tested
- [ ] Disaster recovery procedures verified

### Security & Compliance
- [ ] Security scanning passed (Trivy, npm audit)
- [ ] OWASP compliance verified
- [ ] SSL certificates valid
- [ ] WAF rules reviewed and tested
- [ ] Secrets Manager credentials rotated
- [ ] IAM roles audited

### Documentation & Communication
- [ ] Release notes written
- [ ] Changelog updated
- [ ] Team notified of deployment window
- [ ] Stakeholders informed of changes
- [ ] Runbook reviewed by team
- [ ] Rollback procedure documented

---

## Deployment Procedure (T-0)

### Phase 1: Pre-Deployment Validation (5 minutes)

```bash
#!/bin/bash
set -e

echo "=== Pre-Deployment Validation ==="

# 1. Verify AWS credentials
aws sts get-caller-identity

# 2. Check current system health
curl -s https://api.sss-modernization.example.com/api/health | jq .

# 3. Verify database connectivity
aws rds describe-db-instances \
  --db-instance-identifier sss-modernization-db \
  --query 'DBInstances[0].DBInstanceStatus'

# 4. Verify cache connectivity
redis-cli -h <redis-endpoint> PING

# 5. Check ECS cluster status
aws ecs describe-clusters \
  --clusters sss-modernization \
  --query 'clusters[0].status'

# 6. Verify current task definition
aws ecs describe-task-definition \
  --task-definition sss-modernization-backend \
  --query 'taskDefinition.revision'

echo "✅ All pre-deployment checks passed"
```

### Phase 2: Infrastructure Deployment (15-20 minutes)

```bash
#!/bin/bash
set -e

echo "=== Infrastructure Deployment ==="

cd infrastructure/terraform

# 1. Pull latest changes
git pull origin main

# 2. Validate Terraform
terraform validate

# 3. Plan changes
terraform plan -var-file=prod.tfvars -out=tfplan

# 4. Review plan (manual step)
echo "Review the plan above. Press Enter to continue..."
read

# 5. Apply changes
terraform apply tfplan

# 6. Wait for infrastructure to stabilize
sleep 30

echo "✅ Infrastructure deployed successfully"
```

### Phase 3: Application Deployment (10-15 minutes)

```bash
#!/bin/bash
set -e

echo "=== Application Deployment ==="

# 1. Build Docker images
docker build -t sss-modernization-backend:latest backend/
docker build -t sss-modernization-frontend:latest frontend/

# 2. Push to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker tag sss-modernization-backend:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/sss-modernization-backend:$(git rev-parse --short HEAD)
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/sss-modernization-backend:$(git rev-parse --short HEAD)

docker tag sss-modernization-frontend:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/sss-modernization-frontend:$(git rev-parse --short HEAD)
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/sss-modernization-frontend:$(git rev-parse --short HEAD)

# 3. Update ECS services
aws ecs update-service \
  --cluster sss-modernization \
  --service sss-modernization-backend \
  --force-new-deployment

aws ecs update-service \
  --cluster sss-modernization \
  --service sss-modernization-frontend \
  --force-new-deployment

echo "✅ Application deployment initiated"
```

### Phase 4: Health Verification (5-10 minutes)

```bash
#!/bin/bash
set -e

echo "=== Health Verification ==="

# 1. Wait for ECS tasks to be healthy
echo "Waiting for ECS tasks to stabilize..."
aws ecs wait services-stable \
  --cluster sss-modernization \
  --services sss-modernization-backend sss-modernization-frontend

# 2. Verify ALB target health
for i in {1..10}; do
  HEALTH=$(aws elbv2 describe-target-health \
    --target-group-arn arn:aws:elasticloadbalancing:... \
    --query 'TargetHealthDescriptions[*].TargetHealth.State' \
    --output text)
  
  if [[ "$HEALTH" == "healthy healthy healthy healthy" ]]; then
    echo "✅ All targets healthy"
    break
  fi
  
  echo "⏳ Waiting for targets... ($i/10)"
  sleep 10
done

# 3. Verify API health endpoint
for i in {1..30}; do
  if curl -f https://api.sss-modernization.example.com/api/health; then
    echo "✅ API health check passed"
    break
  fi
  echo "⏳ Waiting for API... ($i/30)"
  sleep 10
done

# 4. Run smoke tests
npm run test:smoke -- --url https://api.sss-modernization.example.com

# 5. Check metrics
echo "Checking metrics..."
ERROR_RATE=$(curl -s http://localhost:9090/api/v1/query?query='http_requests_total{status=~"5.."}' | jq '.data.result[0].value[1]')
echo "Error rate: $ERROR_RATE%"

if (( $(echo "$ERROR_RATE > 1" | bc -l) )); then
  echo "⚠️ High error rate detected"
  exit 1
fi

echo "✅ All health checks passed"
```

### Phase 5: Monitoring & Validation (Ongoing)

```bash
#!/bin/bash

echo "=== Post-Deployment Monitoring ==="

# Monitor for 30 minutes
for i in {1..30}; do
  echo "[$i/30 min] Checking metrics..."
  
  # Check error rate
  ERROR_RATE=$(curl -s http://localhost:9090/api/v1/query?query='rate(http_requests_total{status=~"5.."}[5m])' | jq '.data.result[0].value[1]')
  
  # Check latency
  LATENCY_P95=$(curl -s http://localhost:9090/api/v1/query?query='histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))' | jq '.data.result[0].value[1]')
  
  # Check database connections
  DB_CONNECTIONS=$(curl -s http://localhost:9090/api/v1/query?query='pg_stat_activity_count' | jq '.data.result[0].value[1]')
  
  echo "Error Rate: ${ERROR_RATE}% | Latency p95: ${LATENCY_P95}ms | DB Connections: ${DB_CONNECTIONS}"
  
  if (( $(echo "$ERROR_RATE > 5" | bc -l) )); then
    echo "❌ Error rate too high - consider rollback"
    exit 1
  fi
  
  sleep 60
done

echo "✅ Deployment stable for 30 minutes"
```

---

## Rollback Procedure (If Issues Detected)

```bash
#!/bin/bash
set -e

echo "=== ROLLBACK INITIATED ==="

# 1. Revert to previous task definition version
PREVIOUS_VERSION=$(($(aws ecs describe-task-definition --task-definition sss-modernization-backend --query 'taskDefinition.revision' --output text) - 1))

aws ecs update-service \
  --cluster sss-modernization \
  --service sss-modernization-backend \
  --task-definition sss-modernization-backend:$PREVIOUS_VERSION \
  --force-new-deployment

# 2. Wait for rollback to complete
aws ecs wait services-stable \
  --cluster sss-modernization \
  --services sss-modernization-backend

# 3. Verify rollback
curl -s https://api.sss-modernization.example.com/api/health | jq .

# 4. Notify team
echo "⚠️ Rollback completed. Investigating failure..."

# 5. Preserve logs for investigation
aws logs create-export-task \
  --log-group-name /ecs/sss-modernization-backend \
  --from $(date -d '30 minutes ago' +%s)000 \
  --to $(date +%s)000 \
  --destination sss-modernization-logs \
  --destination-prefix rollback-investigation
```

---

## Post-Deployment Checklist (T+1 Hour)

- [ ] Error rate < 0.1%
- [ ] Latency p95 < 500ms
- [ ] All health checks passing
- [ ] Database connections stable
- [ ] Cache hit ratio > 85%
- [ ] Compliance checks passing
- [ ] Audit logs being recorded
- [ ] Backups completed successfully
- [ ] All monitoring dashboards normal
- [ ] No critical alerts triggered

---

## Deployment Rollback Triggers

**IMMEDIATE ROLLBACK if:**
- Error rate > 5%
- Latency p95 > 2 seconds
- Database connection failures
- Authentication not working
- Compliance violations detected
- Data corruption detected
- Unable to reach >50% of targets

**MONITOR & INVESTIGATE if:**
- Error rate 1-5%
- Latency p95 1-2 seconds
- Cache hit ratio < 70%
- Increased memory usage >20%

---

## Communication Template

**During Deployment:**
```
🚀 Deployment in progress
- Phase: [Infrastructure/Application/Health Verification]
- ETA: [time]
- Status: [status]
```

**On Completion:**
```
✅ Deployment complete
- Deployed: v[version]
- Commit: [SHA]
- Duration: [time]
- Metrics: All green
```

**On Rollback:**
```
⚠️ Rollback initiated
- Reason: [reason]
- Previous version: v[version]
- Status: Rolling back
```

---

**Total Deployment Time:** 45-60 minutes  
**RTO Target:** <5 minutes  
**RPO Target:** <1 minute

# SSS Modernization Platform - Security Controls

## Executive Summary

The SSS Modernization Platform implements defense-in-depth security across network, data, application, and compliance layers. All systems are designed to meet FAR 52.209-2, NIST 800-53, and PCI DSS compliance requirements.

## Security Layers

### 1. Perimeter Security (WAF)

**AWS WAF Configuration:**
- ✅ OWASP Top 10 protection
- ✅ SQL Injection prevention (WAF SQLi RuleSet)
- ✅ XSS protection (AWS Managed Common Rules)
- ✅ Known bad inputs detection
- ✅ Rate limiting: 2,000 requests/min per IP
- ✅ Geo-blocking: Configurable by country
- ✅ CloudWatch logging for all WAF events

**Testing:**
```bash
# Test rate limiting
for i in {1..2100}; do curl -s http://$ALB_DNS/ & done

# Verify WAF blocks exceed
aws logs tail /aws/waf/sss-modernization --follow | grep BlockedRequests
```

### 2. Network Security

**VPC Architecture:**
- ✅ Multi-AZ deployment (2 availability zones)
- ✅ Public subnets: ALB only
- ✅ Private subnets: ECS tasks, RDS, Redis
- ✅ NAT Gateway for private subnet outbound
- ✅ Security groups with least-privilege rules

**Security Groups:**

| Service | Ingress | Egress |
|---------|---------|--------|
| ALB | 80 (HTTP), 443 (HTTPS) | All outbound |
| ECS Tasks | 3000/5000 (from ALB) | All outbound |
| RDS | 5432 (from ECS) | All outbound |
| Redis | 6379 (from ECS) | All outbound |

**Validation:**
```bash
# Verify security group rules
aws ec2 describe-security-groups \
  --group-ids sg-xxxxxx \
  --query 'SecurityGroups[0].IpPermissions'

# Test connectivity (positive: should succeed)
telnet <ecs-private-ip> 3000

# Test connectivity (negative: should fail)
telnet <rds-ip> 5432  # From internet (should timeout)
```

### 3. Data Protection

**Encryption at Rest:**
- ✅ RDS: AES-256 encryption enabled
- ✅ EBS: Default encryption enabled
- ✅ Redis: At-rest encryption enabled
- ✅ S3 (Terraform state): AES-256 encryption
- ✅ Secrets Manager: KMS encryption

**Encryption in Transit:**
- ✅ ALB → Client: TLS 1.2+ required
- ✅ ALB → ECS: HTTP (internal network)
- ✅ ECS → RDS: SSL/TLS required
- ✅ ECS → Redis: TLS encryption enabled
- ✅ All connections: Certificate validation

**Certificate Management:**
```bash
# View SSL certificate
aws acm describe-certificate --certificate-arn <ARN>

# Monitor certificate expiration
aws acm describe-certificate \
  --certificate-arn <ARN> \
  --query 'Certificate.NotAfter'

# Auto-renewal: ACM manages this automatically
```

**Secrets Management:**

All credentials stored in AWS Secrets Manager:
- RDS credentials
- Redis password
- JWT signing key
- API tokens

**Rotation:**
```bash
# Enable automatic secret rotation
aws secretsmanager rotate-secret \
  --secret-id sss-modernization-rds-credentials \
  --rotation-rules AutomaticallyAfterDays=30
```

### 4. Application Security

**Authentication & Authorization:**
- ✅ JWT tokens with 1-hour expiration
- ✅ Bcrypt password hashing (12 rounds)
- ✅ Multi-factor authentication (TOTP)
- ✅ Role-based access control (RBAC)
- ✅ Attribute-based access control (ABAC)
- ✅ API rate limiting per role

**Input Validation:**
- ✅ All API inputs validated
- ✅ Type checking (TypeScript strict mode)
- ✅ String length limits enforced
- ✅ Special character escaping
- ✅ SQL injection prevention (parameterized queries)

**Audit Logging:**
- ✅ All API requests logged
- ✅ User actions immutably logged
- ✅ Sensitive data redacted ([REDACTED])
- ✅ 30-day retention in CloudWatch
- ✅ 365-day retention in S3

**Session Management:**
- ✅ Secure session cookies (HttpOnly, Secure, SameSite)
- ✅ Redis-backed session storage
- ✅ Automatic session expiration (1 hour)
- ✅ Concurrent session limits per user

### 5. Compliance & Audit

**FAR 52.209-2 Controls:**
```
☑ AC-2: Account Management (IAM roles)
☑ AC-3: Access Control (Security groups, RBAC)
☑ AU-2: Audit Events (CloudWatch Logs)
☑ AU-11: Audit Retention (30-day minimum)
☑ SC-7: Boundary Protection (VPC, WAF)
☑ SC-8: Transmission Confidentiality (TLS)
```

**NIST 800-53 Controls:**
```
☑ AC-2: Account Management
☑ AC-3: Access Enforcement
☑ AC-6: Least Privilege
☑ AU-2: Audit Events
☑ AU-11: Audit Retention
☑ IA-2: Authentication
☑ IA-4: Identifier Management
☑ SC-7: Boundary Protection
☑ SC-8: Transmission Confidentiality
☑ SC-13: Cryptographic Protection
```

**Compliance Checks:**
```bash
# Run AWS Config rules (enable separately)
aws configservice put-config-rule --config-rule '{
  "ConfigRuleName": "encrypted-volumes",
  "Source": {
    "Owner": "AWS",
    "SourceIdentifier": "encrypted-volumes"
  }
}'

# Check RDS encryption
aws rds describe-db-instances \
  --query 'DBInstances[*].[DBInstanceIdentifier,StorageEncrypted]'

# Check VPC Flow Logs
aws ec2 describe-flow-logs \
  --filter 'Name=resource-id,Values=vpc-xxxxx'
```

### 6. Monitoring & Alerting

**CloudWatch Dashboards:**
- ✅ Application health (ECS metrics)
- ✅ Database performance (RDS metrics)
- ✅ Cache metrics (ElastiCache metrics)
- ✅ Network latency (ALB metrics)
- ✅ Security events (WAF metrics)

**Critical Alarms:**
```
CRITICAL
├─ ALB unhealthy targets
├─ RDS CPU > 80%
├─ RDS storage < 1 GB
├─ ElastiCache memory > 80%
├─ WAF rate limit exceeded
└─ Failed login attempts > 10/min

WARNING
├─ RDS connections high
├─ ElastiCache evictions > 0
├─ API latency > 500ms
├─ Error rate > 1%
└─ Database slow queries
```

**Log Analysis:**
```bash
# Search for failed login attempts
aws logs filter-log-events \
  --log-group-name /ecs/sss-modernization \
  --filter-pattern "LOGIN_FAILED"

# Search for policy violations
aws logs filter-log-events \
  --log-group-name /ecs/sss-modernization \
  --filter-pattern "POLICY_DENIED"

# Search for data access
aws logs filter-log-events \
  --log-group-name /ecs/sss-modernization \
  --filter-pattern "SENSITIVE_DATA"
```

### 7. Incident Response

**Incident Response Plan:**

1. **Detection**: CloudWatch alarms trigger
2. **Containment**: Auto-scaling adjusts capacity
3. **Investigation**: Logs reviewed in CloudWatch
4. **Remediation**: Services redeployed or rolled back
5. **Recovery**: Traffic routed to healthy instances
6. **Postmortem**: Root cause analysis

**Automated Responses:**

```hcl
# Auto-scaling on CPU high
target_tracking_scaling_policy {
  target_value = 70.0
  predefined_metric_type = "ECSServiceAverageCPUUtilization"
}

# Health checks trigger replacement
health_check {
  interval    = 30
  timeout     = 5
  retries     = 3
  startPeriod = 60
}
```

### 8. Backup & Disaster Recovery

**RDS Backups:**
- ✅ Automated daily backups
- ✅ 30-day retention period
- ✅ Multi-AZ failover enabled
- ✅ Backup encryption enabled
- ✅ Cross-region snapshot replication (optional)

**Restore Procedures:**
```bash
# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier sss-modernization-db-restored \
  --db-snapshot-identifier sss-modernization-db-backup-xxxxx

# Promote read replica (optional setup)
aws rds promote-read-replica \
  --db-instance-identifier sss-modernization-db-replica
```

**RTO/RPO Targets:**
```
Recovery Time Objective (RTO):    15 minutes
Recovery Point Objective (RPO):   1 hour (automated backups)
```

## Security Best Practices

### Password Policy

```
✅ Minimum length: 12 characters
✅ Complexity: Uppercase, lowercase, numbers, symbols
✅ Expiration: 90 days
✅ Reuse prevention: Last 5 passwords
✅ Account lockout: 5 failed attempts
✅ Hash algorithm: bcrypt (cost: 12)
```

### API Security

```
✅ Input validation on all endpoints
✅ Rate limiting per user/IP
✅ Request signing (optional)
✅ CORS restrictions
✅ CSRF protection
✅ XSS prevention (Content-Security-Policy)
✅ Clickjacking protection (X-Frame-Options)
```

### Data Classification

```
PUBLIC    → No restrictions
INTERNAL  → Employee access only
CONFIDENTIAL → Limited access (need-to-know)
RESTRICTED  → PII/PHI, requires encryption
SECRET      → Encryption at rest/transit, MFA for access
```

## Security Testing

### Penetration Testing Checklist

- [ ] SQL Injection attempts (WAF + parameterized queries)
- [ ] XSS payload injection (WAF + output encoding)
- [ ] CSRF token validation
- [ ] Authentication bypass attempts
- [ ] Authorization bypass (privilege escalation)
- [ ] Session hijacking attempts
- [ ] Rate limiting enforcement
- [ ] Encryption validation (TLS 1.2+)
- [ ] Certificate pinning (optional)

### Automated Security Scanning

```bash
# OWASP ZAP scan
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://$ALB_DNS

# npm audit
npm audit --prefix backend
npm audit --prefix frontend

# Terraform security scanning
tfsec infrastructure/terraform

# Docker image scanning
aws ecr start-image-scan \
  --repository-name sss-modernization-backend \
  --image-id imageTag=latest
```

## Compliance Validation

```bash
# Create compliance matrix
aws ssm get-parameters-by-path \
  --path "/sss-modernization/compliance" \
  --recursive

# Generate compliance report
aws cloudformation describe-stacks \
  --stack-name sss-modernization-compliance
```

## Contact & Escalation

- **Security Incidents**: security@example.com
- **On-Call Team**: #incident-response Slack
- **Escalation Path**: Security Lead → CISO → CEO
- **Response SLA**: Critical (15 min), High (1 hour), Medium (4 hours)

---

**Last Updated**: 2024-08-04
**Review Frequency**: Quarterly
**Next Review**: 2024-11-04

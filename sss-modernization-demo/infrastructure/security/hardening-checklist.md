# Security Hardening & Compliance Checklist

## Executive Summary
This checklist ensures SSS Modernization Platform meets enterprise security standards and compliance requirements (FAR 52.209-2, NIST 800-53, PCI DSS).

---

## Section 1: Network Security Hardening

### VPC Hardening
- [ ] Enable VPC Flow Logs to CloudWatch
  ```bash
  aws ec2 create-flow-logs \
    --resource-type VPC \
    --resource-ids vpc-xxxxx \
    --traffic-type ALL \
    --log-destination-type cloud-watch-logs \
    --log-group-name /aws/vpc/flowlogs
  ```

- [ ] Enable VPC endpoint for S3 (gateway endpoint)
  ```bash
  aws ec2 create-vpc-endpoint \
    --vpc-id vpc-xxxxx \
    --service-name com.amazonaws.us-east-1.s3 \
    --route-table-ids rtb-xxxxx
  ```

- [ ] Disable default VPC
  ```bash
  aws ec2 describe-vpcs --query 'Vpcs[?IsDefault==true]'
  # Delete if found (not applicable for existing VPC)
  ```

### Security Group Hardening
- [ ] Review all ingress rules (principle of least privilege)
  ```bash
  aws ec2 describe-security-groups \
    --filters Name=vpc-id,Values=vpc-xxxxx
  ```

- [ ] Remove overly permissive rules (0.0.0.0/0)
  ```bash
  # Identify rules
  aws ec2 describe-security-groups \
    --query 'SecurityGroups[*].[GroupId, IpPermissions[?IpRanges[?CidrIp==`0.0.0.0/0`]]]'
  ```

- [ ] Remove unused security groups
  - [ ] ALB security group has only port 80/443
  - [ ] ECS security group has only ALB as source
  - [ ] RDS security group has only ECS as source
  - [ ] Redis security group has only ECS as source

### Network ACLs
- [ ] Verify Network ACLs are not overly permissive
  ```bash
  aws ec2 describe-network-acls \
    --filters Name=vpc-id,Values=vpc-xxxxx
  ```

---

## Section 2: Data Protection Hardening

### Encryption at Rest
- [ ] RDS encryption enabled
  ```bash
  aws rds describe-db-instances \
    --query 'DBInstances[*].[DBInstanceIdentifier, StorageEncrypted]'
  ```

- [ ] EBS volumes encrypted
  ```bash
  aws ec2 describe-volumes \
    --query 'Volumes[*].[VolumeId, Encrypted]'
  ```

- [ ] S3 bucket encryption enabled (backup bucket)
  ```bash
  aws s3api get-bucket-encryption \
    --bucket sss-modernization-backups-prod
  ```

- [ ] KMS key rotation enabled (annual)
  ```bash
  aws kms get-key-rotation-status --key-id alias/sss-modernization
  ```

### Encryption in Transit
- [ ] ALB enforces HTTPS (redirect HTTP)
  - [ ] TLS 1.2+ enforced
  - [ ] Strong cipher suites configured
  - [ ] HTTP/2 enabled

- [ ] RDS SSL/TLS required
  ```bash
  PGPASSWORD=${PASSWORD} psql -h ${RDS_HOST} -c "SHOW ssl;"
  ```

- [ ] Redis TLS encryption enabled
  ```bash
  aws elasticache describe-cache-clusters \
    --query 'CacheClusters[*].[CacheClusterId, TransitEncryptionEnabled]'
  ```

### Secrets Management
- [ ] All credentials in Secrets Manager
  - [ ] RDS credentials
  - [ ] Redis password
  - [ ] JWT signing key
  - [ ] API keys

- [ ] Secrets rotated regularly (90 days)
  ```bash
  aws secretsmanager describe-secret \
    --secret-id sss-modernization-rds-credentials
  ```

- [ ] Secrets Manager encryption with KMS
  ```bash
  aws secretsmanager get-resource-policy \
    --secret-id sss-modernization-rds-credentials
  ```

---

## Section 3: Access Control Hardening

### IAM Hardening
- [ ] Root account MFA enabled
  ```bash
  aws iam list-mfa-devices --user-name root
  ```

- [ ] No root account access keys
  ```bash
  aws iam list-access-keys --user-name root
  ```

- [ ] Users have MFA enabled
  ```bash
  aws iam list-virtual-mfa-devices
  ```

- [ ] No overly permissive IAM policies
  ```bash
  # Check for wildcard permissions
  aws iam get-policy --policy-arn arn:aws:iam::account:policy/name
  ```

- [ ] Service roles follow least privilege
  - [ ] ECS task execution role (read Secrets, ECR pull)
  - [ ] ECS task role (CloudWatch logs, KMS decrypt)
  - [ ] RDS enhanced monitoring role
  - [ ] Lambda execution role (if used)

### RDS Hardening
- [ ] Database parameter group enforces security
  ```sql
  -- Force SSL connections
  SHOW rds.force_ssl;
  
  -- Enable audit logging
  SHOW log_statement;
  
  -- Disable dangerous functions
  SHOW search_path;
  ```

- [ ] Enhanced monitoring enabled
  ```bash
  aws rds describe-db-instances \
    --query 'DBInstances[*].[DBInstanceIdentifier, EnableIAMDatabaseAuthentication]'
  ```

- [ ] IAM database authentication enabled (optional, for MySQL)
  ```bash
  aws rds modify-db-instance \
    --db-instance-identifier sss-modernization-db \
    --enable-iam-database-authentication
  ```

### Application Access Control
- [ ] JWT token validation on every API call
  - [ ] Signature verification
  - [ ] Expiration check (1-hour TTL)
  - [ ] Issuer verification

- [ ] Rate limiting enforced (OPA policies)
  - [ ] 60 req/min for citizens
  - [ ] 300 req/min for case managers
  - [ ] 1000 req/min for admins

- [ ] API endpoint authorization
  - [ ] RBAC enforced on all endpoints
  - [ ] Resource-level authorization verified

---

## Section 4: Audit & Monitoring Hardening

### Audit Logging
- [ ] Immutable audit logs (PostgreSQL constraints)
  ```sql
  SELECT constraint_name FROM information_schema.constraint_column_usage
  WHERE table_name = 'audit_logs' AND constraint_type = 'PRIMARY KEY';
  ```

- [ ] Audit log retention policy
  - [ ] 30 days in CloudWatch Logs
  - [ ] 365 days in S3 Glacier

- [ ] Sensitive data redaction verified
  ```sql
  SELECT details FROM audit_logs WHERE action = 'PASSWORD_CHANGE' LIMIT 1;
  -- Should show [REDACTED], not actual password
  ```

- [ ] Audit log export to S3 (immutable)
  ```bash
  aws logs create-export-task \
    --log-group-name /ecs/sss-modernization \
    --from $(date -d 'yesterday' +%s)000 \
    --to $(date +%s)000 \
    --destination sss-modernization-audit-logs \
    --destination-prefix audit-export
  ```

### CloudTrail
- [ ] CloudTrail enabled for AWS API audit
  ```bash
  aws cloudtrail list-trails --all-regions
  ```

- [ ] CloudTrail logs encrypted and stored in S3
  ```bash
  aws cloudtrail describe-trails \
    --query 'trailList[*].[S3BucketName, KMSKeyId]'
  ```

- [ ] CloudTrail alerting configured
  - [ ] Alert on root account usage
  - [ ] Alert on console login failures
  - [ ] Alert on IAM policy changes

### WAF Hardening
- [ ] WAF logging enabled
  ```bash
  aws wafv2 get-logging-configuration --resource-arn <ALB_ARN>
  ```

- [ ] WAF rules reviewed and updated
  - [ ] OWASP Core Rule Set enabled
  - [ ] SQL Injection rules active
  - [ ] XSS protection enabled
  - [ ] Rate limiting active (2000 req/min)
  - [ ] Geo-blocking configured (if needed)

- [ ] WAF false positives reviewed
  - [ ] Whitelist legitimate traffic (JWT auth)
  - [ ] Adjust rules if needed

---

## Section 5: Vulnerability Management

### Dependency Scanning
- [ ] npm audit regularly
  ```bash
  npm audit --prefix backend
  npm audit --prefix frontend
  ```

- [ ] Address critical vulnerabilities (CVSS > 7.0)
  ```bash
  npm audit --audit-level=moderate
  ```

- [ ] Docker image scanning
  ```bash
  aws ecr start-image-scan \
    --repository-name sss-modernization-backend \
    --image-id imageTag=latest
  ```

- [ ] Trivy scanning (container vulnerabilities)
  ```bash
  trivy image sss-modernization-backend:latest
  ```

### Penetration Testing
- [ ] OWASP ZAP scanning (automated)
  ```bash
  docker run -t owasp/zap2docker-stable zap-baseline.py \
    -t https://sss-modernization.example.com
  ```

- [ ] Manual penetration testing (quarterly)
  - [ ] SQL injection attempts
  - [ ] XSS payloads
  - [ ] CSRF token validation
  - [ ] Authentication bypass
  - [ ] Authorization bypass

- [ ] Chaos engineering (optional)
  ```bash
  # Inject failures into production
  # Verify system resilience and recovery
  ```

---

## Section 6: Compliance Validation

### FAR 52.209-2 Compliance
- [ ] AC-2: Account Management
  - [ ] IAM users created (no root usage)
  - [ ] Roles assigned by responsibility
  - [ ] MFA enabled

- [ ] AC-3: Access Control Enforcement
  - [ ] RBAC implemented (4 roles)
  - [ ] Permission matrix validated
  - [ ] Least privilege verified

- [ ] AU-2: Audit Event Selection
  - [ ] All sensitive operations logged
  - [ ] Audit events documented
  - [ ] Logging enabled

- [ ] AU-11: Audit Information Protection
  - [ ] Audit logs immutable (PG constraints)
  - [ ] Logs encrypted in transit/rest
  - [ ] Access restricted (admins only)

- [ ] SC-7: Boundary Protection
  - [ ] WAF enabled and configured
  - [ ] VPC isolation verified
  - [ ] Security groups restrictive

- [ ] SC-8: Transmission Confidentiality
  - [ ] TLS 1.2+ enforced
  - [ ] All communication encrypted
  - [ ] Certificate validation enabled

### NIST 800-53 Compliance
- [ ] AC-2: Account Management (automated check)
  ```bash
  bash infrastructure/scripts/nist-compliance-check.sh
  ```

- [ ] IA-2: Authentication (MFA, JWT validation)
- [ ] IA-4: Identifier Management (user tracking)
- [ ] SC-13: Cryptographic Protection (encryption)

### PCI DSS Compliance (if processing payments)
- [ ] No credit card data in logs
- [ ] Encryption for cardholder data
- [ ] Access control to payment systems
- [ ] Regular security testing

---

## Section 7: Incident Response

### Incident Response Plan
- [ ] Incident response team identified
  - [ ] Security Lead
  - [ ] Operations Lead
  - [ ] Communications Lead

- [ ] Escalation procedures documented
  - [ ] P0: Security breach (immediate escalation)
  - [ ] P1: Service down (on-call engineer)
  - [ ] P2: Degradation (business hours)

- [ ] Communication plan
  - [ ] Internal notification
  - [ ] Customer notification
  - [ ] Regulatory notification (if required)

- [ ] Post-incident review
  - [ ] Root cause analysis
  - [ ] Lessons learned
  - [ ] Preventive measures

### Security Incident Scenarios
- [ ] Database compromise
  - [ ] How detected (unusual queries, data access patterns)
  - [ ] Response (rotate credentials, audit logs)
  - [ ] Recovery (restore from backup)

- [ ] Credential leak
  - [ ] How detected (monitoring secret usage)
  - [ ] Response (rotate immediately via Secrets Manager)
  - [ ] Recovery (monitor for unauthorized use)

- [ ] DDoS attack
  - [ ] How detected (ALB metrics spike)
  - [ ] Response (WAF auto-scales, DDoS protection)
  - [ ] Recovery (verify logs, document patterns)

---

## Section 8: Security Hardening Commands

### Quick Hardening Script
```bash
#!/bin/bash

# Run all security checks
echo "Running security hardening checks..."

# 1. Check encryption
aws rds describe-db-instances \
  --query 'DBInstances[*].[DBInstanceIdentifier, StorageEncrypted]'

# 2. Check audit logging
aws ec2 describe-flow-logs \
  --query 'FlowLogs[*].[ResourceId, FlowLogStatus]'

# 3. Check WAF
aws wafv2 list-web-acls --scope REGIONAL

# 4. Check IAM users with active keys
aws iam list-users --query 'Users[*].UserName' | \
  while read user; do
    keys=$(aws iam list-access-keys --user-name "$user" \
      --query 'AccessKeyMetadata[*].AccessKeyId')
    [ ! -z "$keys" ] && echo "User $user has access keys: $keys"
  done

# 5. Check MFA
aws iam list-mfa-devices --query 'MFADevices[*].UserName'

# 6. Check S3 bucket encryption
aws s3api get-bucket-encryption --bucket sss-modernization-backups-prod

echo "Security check complete"
```

---

## Section 9: Regular Security Maintenance

### Daily
- [ ] Monitor CloudWatch alarms
- [ ] Check WAF blocked requests
- [ ] Review failed login attempts

### Weekly
- [ ] Review IAM access changes
- [ ] Check for new security advisories
- [ ] Verify backup completion

### Monthly
- [ ] Run security compliance check
- [ ] Rotate credentials (if manual)
- [ ] Review audit logs
- [ ] Update security policies

### Quarterly
- [ ] Penetration testing
- [ ] Vulnerability scanning
- [ ] Disaster recovery test
- [ ] Security training

### Annually
- [ ] External security audit
- [ ] Compliance certification renewal
- [ ] Architecture security review
- [ ] Update threat model

---

## Section 10: Compliance Monitoring Dashboard

**Track These Metrics:**

| Control | Target | Current | Status |
|---------|--------|---------|--------|
| MFA Enabled | 100% | - | ☐ |
| Audit Logs Immutable | 100% | - | ☐ |
| Encryption at Rest | 100% | - | ☐ |
| TLS Enforced | 100% | - | ☐ |
| Secrets Rotated | 90 days | - | ☐ |
| Vulnerabilities (Critical) | 0 | - | ☐ |
| WAF Active | 24/7 | - | ☐ |
| Backup Tested | Monthly | - | ☐ |

---

## Sign-Off

**Security Officer:** ___________________  
**Date:** ___________________  
**Next Review:** ___________________

---

**Document Version:** 1.0  
**Last Updated:** 2024-08-04  
**Compliance:** FAR 52.209-2, NIST 800-53, PCI DSS

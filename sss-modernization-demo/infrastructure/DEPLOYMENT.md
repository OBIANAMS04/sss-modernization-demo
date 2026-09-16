# SSS Modernization Platform - AWS Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the SSS Modernization Platform to AWS using Terraform and the deployment scripts.

## Architecture

```
Internet
    ↓
    ↓ (HTTPS)
┌─────────────────────┐
│   AWS WAF           │
├─────────────────────┤
│   ALB (Multi-AZ)    │
│   - Port 443        │
│   - TLS 1.2+        │
└─────────────────────┘
         ↓
    ┌────┴────┐
    ↓         ↓
┌────────┐ ┌────────┐
│ ECS    │ │ ECS    │
│Backend │ │Frontend│
│Task 1  │ │Task 1  │
└────────┘ └────────┘
    ↓         ↓
┌────────────────────┐
│   PostgreSQL RDS   │
│   (Multi-AZ)       │
│   - Encrypted      │
│   - SSL Required   │
└────────────────────┘
    ↓
┌────────────────────┐
│  Redis Cache       │
│  (ElastiCache)     │
│  - Encrypted       │
│  - Auth Required   │
└────────────────────┘
```

## Prerequisites

### Required Tools

- AWS CLI v2 (latest)
- Terraform >= 1.0
- Docker & Docker Compose
- Git
- Node.js 18+

### AWS Requirements

- AWS Account with appropriate permissions
- S3 bucket for Terraform state (terraform-state)
- DynamoDB table for state locking (terraform-locks)
- ECR repositories for Docker images
- IAM roles for GitHub Actions (OIDC provider)

### IAM Permissions Required

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "rds:*",
        "elasticache:*",
        "ecs:*",
        "ecr:*",
        "elasticloadbalancing:*",
        "cloudwatch:*",
        "logs:*",
        "secretsmanager:*",
        "wafv2:*",
        "iam:*",
        "kms:*"
      ],
      "Resource": "*"
    }
  ]
}
```

## Deployment Steps

### Step 1: Prepare AWS Account

```bash
# Create S3 bucket for Terraform state
aws s3 mb s3://sss-modernization-terraform-state --region us-east-1
aws s3api put-bucket-versioning \
  --bucket sss-modernization-terraform-state \
  --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
  --bucket sss-modernization-terraform-state \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'

# Create DynamoDB table for state locking
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# Create ECR repositories
aws ecr create-repository --repository-name sss-modernization-backend
aws ecr create-repository --repository-name sss-modernization-frontend
```

### Step 2: Configure Terraform Variables

```bash
cd infrastructure/terraform

# Copy example variables
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars with your values
# - Set RDS username and password (use AWS Secrets Manager)
# - Set certificate ARN if using HTTPS
# - Configure other settings as needed
vim terraform.tfvars
```

**Important**: Never commit `terraform.tfvars` to version control!

### Step 3: Initialize and Plan Infrastructure

```bash
# Initialize Terraform
terraform init

# Validate configuration
terraform validate

# Plan infrastructure deployment
terraform plan -out=tfplan_prod

# Review the plan output carefully
```

### Step 4: Apply Infrastructure

```bash
# Apply the infrastructure (requires approval)
terraform apply tfplan_prod

# Note the outputs:
# - vpc_id
# - private_subnet_ids
# - alb_dns_name
# - ecs_cluster_name
# - rds_endpoint
# - redis_endpoint
```

### Step 5: Build and Push Docker Images

```bash
# Return to project root
cd ../..

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# Build images
docker build -t sss-modernization-backend:latest -f backend/Dockerfile backend/
docker build -t sss-modernization-frontend:latest -f frontend/Dockerfile frontend/

# Tag and push to ECR
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGISTRY=$ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

docker tag sss-modernization-backend:latest $REGISTRY/sss-modernization-backend:latest
docker push $REGISTRY/sss-modernization-backend:latest

docker tag sss-modernization-frontend:latest $REGISTRY/sss-modernization-frontend:latest
docker push $REGISTRY/sss-modernization-frontend:latest
```

### Step 6: Deploy Services

```bash
# Use the deployment script
bash infrastructure/scripts/deploy.sh prod all

# Or manually update ECS services
aws ecs update-service \
  --cluster sss-modernization-cluster \
  --service sss-modernization-backend-service \
  --force-new-deployment \
  --region us-east-1

aws ecs update-service \
  --cluster sss-modernization-cluster \
  --service sss-modernization-frontend-service \
  --force-new-deployment \
  --region us-east-1
```

### Step 7: Verify Deployment

```bash
# Get ALB DNS name
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --names sss-modernization-alb \
  --query 'LoadBalancers[0].DNSName' \
  --output text)

# Test backend
curl http://$ALB_DNS/api/health

# Test frontend
curl http://$ALB_DNS/

# Monitor ECS services
aws ecs describe-services \
  --cluster sss-modernization-cluster \
  --services sss-modernization-backend-service sss-modernization-frontend-service
```

## Security Controls

### Network Security

- **VPC**: Isolated network with public/private subnets across 2 AZs
- **Security Groups**: Restricted ingress/egress rules per service
- **NAT Gateway**: Private subnet outbound traffic through NAT
- **ALB**: Terminates HTTPS, enforces TLS 1.2+

### Data Security

- **RDS Encryption**: AES-256 encryption at rest
- **RDS SSL**: All connections require SSL/TLS
- **Redis Encryption**: Encryption at rest and in transit
- **Secrets Manager**: Secure storage for credentials

### Application Security

- **AWS WAF**: Protects against OWASP Top 10 attacks
  - SQL Injection protection
  - Cross-site scripting (XSS) protection
  - Known bad input detection
  - Rate limiting (2000 req/min)
  - Geo-blocking (configurable)

### Compliance & Audit

- **CloudWatch Logs**: All application logs retained for 30 days
- **RDS Query Logs**: SQL query logging enabled
- **Redis Logs**: Engine and slow query logs
- **CloudTrail**: AWS API audit logging (enable separately)

### Monitoring & Alerts

CloudWatch alarms configured for:
- RDS CPU > 80%
- RDS storage < 1 GB
- RDS connections > 80
- ElastiCache CPU > 75%
- ElastiCache memory > 80%
- ALB unhealthy targets
- WAF blocked requests > 100 in 5 min

## Rollback Procedures

### Service Rollback

```bash
# Revert to previous task definition
aws ecs describe-task-definition \
  --task-definition sss-modernization-backend \
  --query 'taskDefinition.{family,revision}' \
  --output text | xargs -I {} echo ecs-task-{}

# Update service with previous revision
aws ecs update-service \
  --cluster sss-modernization-cluster \
  --service sss-modernization-backend-service \
  --task-definition sss-modernization-backend:PREVIOUS_REVISION
```

### Infrastructure Rollback

```bash
# Revert Terraform state
cd infrastructure/terraform
terraform plan -destroy -out=destroy.tfplan
terraform apply destroy.tfplan

# Restore from backup (if available)
aws s3 cp s3://sss-modernization-terraform-state/terraform.tfstate.backup ./
```

## Maintenance

### Database Maintenance

```bash
# RDS automated backups: Daily (30-day retention)
# Manual snapshot before major updates
aws rds create-db-snapshot \
  --db-instance-identifier sss-modernization-db \
  --db-snapshot-identifier sss-modernization-db-backup-$(date +%s)

# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier sss-modernization-db-restored \
  --db-snapshot-identifier sss-modernization-db-backup-12345
```

### Cache Maintenance

```bash
# Clear cache (if needed for testing)
# Note: This will evict all keys - use carefully!
aws elasticache-cli --cluster-name sss-modernization-cache FLUSHALL
```

## Troubleshooting

### Services Not Starting

```bash
# Check ECS task logs
aws logs tail /ecs/sss-modernization --follow

# Inspect task definition
aws ecs describe-task-definition \
  --task-definition sss-modernization-backend

# Check service events
aws ecs describe-services \
  --cluster sss-modernization-cluster \
  --services sss-modernization-backend-service
```

### Database Connection Issues

```bash
# Verify security group allows traffic
aws ec2 describe-security-groups --group-ids sg-xxxxx

# Test connectivity from ECS task
aws ecs execute-command \
  --cluster sss-modernization-cluster \
  --task <TASK_ID> \
  --container backend \
  --command "/bin/bash"

# Check RDS Enhanced Monitoring
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=sss-modernization-db \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 300 \
  --statistics Average
```

### High Latency Issues

```bash
# Check ALB latency metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name TargetResponseTime \
  --dimensions Name=LoadBalancer,Value=app/sss-modernization-alb/* \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 60 \
  --statistics Average

# Check ECS task metrics
aws ecs describe-tasks \
  --cluster sss-modernization-cluster \
  --tasks <TASK_ARNS> \
  --query 'tasks[*].[taskArn,lastStatus,cpu,memory]'
```

## Cost Optimization

### Recommended Settings

```hcl
# Development environment
ecs_task_cpu           = 256
ecs_task_memory        = 512
ecs_desired_count      = 1
elasticache_node_type  = "cache.t3.micro"
rds_instance_class     = "db.t3.micro"

# Production environment (recommended)
ecs_task_cpu           = 512
ecs_task_memory        = 1024
ecs_desired_count      = 2
elasticache_node_type  = "cache.t3.small"
rds_instance_class     = "db.t3.small"
```

### Cost Monitoring

```bash
# Enable AWS Cost Explorer
# Use AWS Budgets to set spending limits
# Review savings plans for compute

# Estimate monthly costs
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics "UnblendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE
```

## Support & Documentation

- Terraform AWS Provider: https://registry.terraform.io/providers/hashicorp/aws/latest
- ECS Best Practices: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/
- RDS Security: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS/
- WAF Rules: https://docs.aws.amazon.com/waf/latest/developerguide/

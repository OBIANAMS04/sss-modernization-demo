# Multi-Region Setup & Disaster Recovery
# Extends primary region (us-east-1) with secondary region (us-west-2)
# RTO: <30 minutes, RPO: <5 minutes

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Primary region provider (us-east-1)
provider "aws" {
  alias  = "primary"
  region = var.primary_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "sss-modernization"
      Region      = "primary"
      BackupRegion = "us-west-2"
    }
  }
}

# Secondary region provider (us-west-2)
provider "aws" {
  alias  = "secondary"
  region = var.secondary_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "sss-modernization"
      Region      = "secondary"
      PrimaryRegion = "us-east-1"
    }
  }
}

# ==============================================================================
# SECONDARY REGION (us-west-2) - STANDBY DATABASE
# ==============================================================================

# RDS Read Replica in secondary region (async replication from primary)
resource "aws_db_instance" "secondary_rds" {
  provider                 = aws.secondary
  identifier               = "${var.app_name}-db-secondary"
  replicate_source_db      = aws_db_instance.primary_rds.identifier
  instance_class           = var.db_instance_class_secondary
  publicly_accessible      = false
  multi_az                 = false  # Read replica, not HA
  skip_final_snapshot      = false
  final_snapshot_identifier = "${var.app_name}-db-secondary-final-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"

  # Monitoring & performance
  enabled_cloudwatch_logs_exports = ["postgresql"]
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_monitoring_secondary.arn

  # Encryption
  storage_encrypted = true
  kms_key_id        = aws_kms_key.secondary_rds.arn

  tags = {
    Name = "${var.app_name}-db-secondary"
    Type = "read-replica"
  }
}

resource "aws_iam_role" "rds_monitoring_secondary" {
  provider = aws.secondary
  name     = "${var.app_name}-rds-monitoring-secondary"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "monitoring.rds.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring_secondary" {
  provider       = aws.secondary
  role           = aws_iam_role.rds_monitoring_secondary.name
  policy_arn     = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_kms_key" "secondary_rds" {
  provider            = aws.secondary
  description         = "KMS key for secondary RDS encryption"
  deletion_window_in_days = 7
  enable_key_rotation = true

  tags = {
    Name = "${var.app_name}-rds-key-secondary"
  }
}

# ==============================================================================
# SECONDARY REGION (us-west-2) - STANDBY REDIS REPLICA
# ==============================================================================

# ElastiCache Redis Read Replica
resource "aws_elasticache_replication_group" "secondary_cache" {
  provider                   = aws.secondary
  replication_group_description = "${var.app_name} secondary cache replica"
  engine                     = "redis"
  engine_version             = var.redis_version
  node_type                  = var.cache_node_type_secondary
  num_cache_clusters         = 1
  automatic_failover_enabled = false  # Read replica, managed by primary
  multi_az_enabled           = true

  # Security
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth_token_secondary.result
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.secondary_cache.arn

  # Networking
  subnet_group_name = aws_elasticache_subnet_group.secondary.name
  security_group_ids = [aws_security_group.secondary_cache.id]

  # Monitoring
  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.secondary_redis.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    enabled          = true
  }

  # Backup
  snapshot_retention_limit = 5
  snapshot_window          = "03:00-05:00"

  tags = {
    Name = "${var.app_name}-cache-secondary"
    Type = "read-replica"
  }

  depends_on = [aws_elasticache_subnet_group.secondary]
}

resource "aws_elasticache_subnet_group" "secondary" {
  provider    = aws.secondary
  name        = "${var.app_name}-cache-subnet-secondary"
  subnet_ids  = aws_subnet.secondary_private[*].id

  tags = {
    Name = "${var.app_name}-cache-subnet-secondary"
  }
}

resource "aws_security_group" "secondary_cache" {
  provider    = aws.secondary
  name        = "${var.app_name}-cache-sg-secondary"
  description = "Redis cache security group (secondary region)"
  vpc_id      = aws_vpc.secondary.id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.secondary.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.app_name}-cache-sg-secondary"
  }
}

resource "random_password" "redis_auth_token_secondary" {
  length  = 32
  special = true
}

resource "aws_secretsmanager_secret" "redis_secondary_credentials" {
  provider = aws.secondary
  name     = "${var.app_name}-redis-credentials-secondary"

  tags = {
    Name = "${var.app_name}-redis-credentials-secondary"
  }
}

resource "aws_secretsmanager_secret_version" "redis_secondary_credentials" {
  provider      = aws.secondary
  secret_id     = aws_secretsmanager_secret.redis_secondary_credentials.id
  secret_string = jsonencode({
    host     = aws_elasticache_replication_group.secondary_cache.primary_endpoint_address
    port     = 6379
    password = random_password.redis_auth_token_secondary.result
    tls      = true
  })
}

resource "aws_kms_key" "secondary_cache" {
  provider            = aws.secondary
  description         = "KMS key for secondary cache encryption"
  deletion_window_in_days = 7
  enable_key_rotation = true

  tags = {
    Name = "${var.app_name}-cache-key-secondary"
  }
}

resource "aws_cloudwatch_log_group" "secondary_redis" {
  provider            = aws.secondary
  name                = "/aws/elasticache/${var.app_name}-secondary"
  retention_in_days   = 30

  tags = {
    Name = "${var.app_name}-redis-logs-secondary"
  }
}

# ==============================================================================
# SECONDARY REGION (us-west-2) - VPC & NETWORKING
# ==============================================================================

resource "aws_vpc" "secondary" {
  provider           = aws.secondary
  cidr_block         = var.secondary_vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support = true

  tags = {
    Name = "${var.app_name}-vpc-secondary"
  }
}

resource "aws_subnet" "secondary_private" {
  provider            = aws.secondary
  count               = length(var.secondary_availability_zones)
  vpc_id              = aws_vpc.secondary.id
  cidr_block          = cidrsubnet(var.secondary_vpc_cidr, 2, count.index + 2)
  availability_zone   = var.secondary_availability_zones[count.index]

  tags = {
    Name = "${var.app_name}-private-secondary-${count.index + 1}"
  }
}

# ==============================================================================
# CROSS-REGION DATA REPLICATION
# ==============================================================================

# S3 bucket for database backups (with cross-region replication)
resource "aws_s3_bucket" "secondary_backups" {
  provider = aws.secondary
  bucket   = "${var.app_name}-backups-secondary-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${var.app_name}-backups-secondary"
  }
}

resource "aws_s3_bucket_versioning" "secondary_backups" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.secondary_backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "secondary_backups" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.secondary_backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.secondary_rds.arn
    }
  }
}

resource "aws_s3_bucket_replication_configuration" "secondary_backups" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.secondary_backups.id

  role = aws_iam_role.s3_replication.arn

  rule {
    status = "Enabled"
    filter {
      prefix = ""
    }
    destination {
      bucket       = "arn:aws:s3:::${var.app_name}-backups-tertiary"
      storage_class = "GLACIER"
      replication_time {
        status = "Enabled"
        time {
          minutes = 15
        }
      }
    }
  }
}

resource "aws_iam_role" "s3_replication" {
  provider = aws.secondary
  name     = "${var.app_name}-s3-replication"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "s3.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "s3_replication" {
  provider = aws.secondary
  name     = "${var.app_name}-s3-replication-policy"
  role     = aws_iam_role.s3_replication.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.secondary_backups.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl"
        ]
        Resource = "${aws_s3_bucket.secondary_backups.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete"
        ]
        Resource = "arn:aws:s3:::${var.app_name}-backups-tertiary/*"
      }
    ]
  })
}

# ==============================================================================
# FAILOVER & MONITORING
# ==============================================================================

# CloudWatch Alarm for replication lag
resource "aws_cloudwatch_metric_alarm" "rds_replication_lag" {
  provider            = aws.primary
  alarm_name          = "${var.app_name}-rds-replication-lag"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "AuroraBinlogReplicaLag"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 60  # Alert if lag > 60 seconds
  alarm_description   = "Alert when RDS replication lag exceeds 1 minute"
  alarm_actions       = [aws_sns_topic.dr_alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.secondary_rds.identifier
  }
}

resource "aws_sns_topic" "dr_alerts" {
  provider = aws.primary
  name     = "${var.app_name}-dr-alerts"

  tags = {
    Name = "${var.app_name}-dr-alerts"
  }
}

resource "aws_sns_topic_subscription" "dr_alerts_email" {
  provider  = aws.primary
  topic_arn = aws_sns_topic.dr_alerts.arn
  protocol  = "email"
  endpoint  = var.dr_alert_email
}

# ==============================================================================
# VARIABLES & DATA SOURCES
# ==============================================================================

variable "primary_region" {
  description = "Primary AWS region"
  type        = string
  default     = "us-east-1"
}

variable "secondary_region" {
  description = "Secondary AWS region for DR"
  type        = string
  default     = "us-west-2"
}

variable "secondary_vpc_cidr" {
  description = "CIDR block for secondary VPC"
  type        = string
  default     = "10.1.0.0/16"
}

variable "secondary_availability_zones" {
  description = "Availability zones in secondary region"
  type        = list(string)
  default     = ["us-west-2a", "us-west-2b"]
}

variable "db_instance_class_secondary" {
  description = "RDS instance class for secondary region"
  type        = string
  default     = "db.t3.small"  # Smaller than primary for cost savings
}

variable "cache_node_type_secondary" {
  description = "ElastiCache node type for secondary region"
  type        = string
  default     = "cache.t3.micro"  # Smaller than primary
}

variable "redis_version" {
  description = "Redis version"
  type        = string
  default     = "7.0"
}

variable "dr_alert_email" {
  description = "Email for DR alerts"
  type        = string
  sensitive   = true
}

data "aws_caller_identity" "current" {}

# ==============================================================================
# FAILOVER PROCEDURES (Documented)
# ==============================================================================

output "failover_instructions" {
  description = "Instructions for manual failover to secondary region"
  value       = <<-EOT
    DISASTER RECOVERY FAILOVER PROCEDURE

    1. ASSESSMENT PHASE
       - Verify primary region is actually down (check AWS status page)
       - Confirm replication lag with CloudWatch metrics
       - Notify stakeholders via dr-alerts SNS topic

    2. PRE-FAILOVER CHECKS
       - Verify secondary RDS read replica is healthy:
         aws rds describe-db-instances --db-instance-identifier ${var.app_name}-db-secondary
       - Verify secondary Redis is synchronized:
         redis-cli -h <secondary-redis-endpoint> INFO replication

    3. PROMOTE SECONDARY RDS (Convert read replica to standalone)
       aws rds promote-read-replica \
         --db-instance-identifier ${var.app_name}-db-secondary \
         --backup-retention-period 7

       Expected time: 5-10 minutes

    4. UPDATE APPLICATION CONFIGURATION
       - Update DATABASE_URL to point to secondary RDS endpoint
       - Update REDIS_URL to point to secondary Redis endpoint
       - Deploy application to secondary region (via Terraform)

    5. PROMOTE SECONDARY REDIS (If using read replica pattern)
       - ElastiCache read replicas automatically become primary if needed
       - Verify replication is now bidirectional

    6. DNS/ROUTE53 FAILOVER
       - Update Route53 weighted routing policy or failover routing
       - Change load balancer target to secondary region ECS tasks
       - Expected propagation time: 2-5 minutes

    7. VALIDATION
       - Verify application is responding from secondary region
       - Run smoke tests on critical workflows
       - Monitor error rates and latency
       - Confirm all data is intact

    8. POST-FAILOVER
       - Investigate root cause of primary region outage
       - Document timeline and impact
       - Plan recovery of primary region
       - Schedule post-mortem review

    ESTIMATED RTO: 30 minutes
    ESTIMATED RPO: <5 minutes

    For detailed runbook: infrastructure/runbooks/DISASTER-RECOVERY.md
  EOT
}

# RDS PostgreSQL Database Configuration

# DB Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "${var.app_name}-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${var.app_name}-db-subnet-group"
  }
}

# RDS Instance - PostgreSQL
resource "aws_db_instance" "main" {
  identifier     = "${var.app_name}-db"
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = var.rds_instance_class

  allocated_storage = var.rds_storage_gb
  storage_type      = "gp3"
  storage_encrypted = var.enable_encryption

  db_name  = var.rds_db_name
  username = var.rds_username
  password = var.rds_password

  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.rds.id]
  parameter_group_name            = aws_db_parameter_group.main.name
  publicly_accessible             = false
  multi_az                        = true
  backup_retention_period         = var.rds_backup_retention
  backup_window                   = "03:00-04:00"
  maintenance_window              = "mon:04:00-mon:05:00"
  copy_tags_to_snapshot           = true
  enable_cloudwatch_logs_exports  = ["postgresql"]
  deletion_protection             = true
  performance_insights_enabled    = true
  performance_insights_retention_period = 7

  tags = {
    Name = "${var.app_name}-db"
  }

  depends_on = [aws_security_group.rds]
}

# DB Parameter Group
resource "aws_db_parameter_group" "main" {
  family = "postgres15"
  name   = "${var.app_name}-db-params"

  # Enforce SSL connections
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Enable query logging for security audit
  parameter {
    name  = "log_statement"
    value = "all"
  }

  # Retention period for logs
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = {
    Name = "${var.app_name}-db-params"
  }
}

# RDS Enhanced Monitoring Role
resource "aws_iam_role" "rds_monitoring" {
  name = "${var.app_name}-rds-monitoring-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# Secrets Manager for RDS Credentials
resource "aws_secretsmanager_secret" "rds_credentials" {
  name                    = "${var.app_name}-rds-credentials"
  recovery_window_in_days = 7

  tags = {
    Name = "${var.app_name}-rds-credentials"
  }
}

resource "aws_secretsmanager_secret_version" "rds_credentials" {
  secret_id = aws_secretsmanager_secret.rds_credentials.id
  secret_string = jsonencode({
    username = var.rds_username
    password = var.rds_password
    engine   = "postgres"
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = var.rds_db_name
  })
}

# CloudWatch Alarms for RDS
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${var.app_name}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Alert when RDS CPU exceeds 80%"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${var.app_name}-rds-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 1000000000  # 1 GB
  alarm_description   = "Alert when RDS free storage < 1GB"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${var.app_name}-rds-connections-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Alert when database connections exceed 80"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }
}

# Outputs
output "rds_endpoint" {
  value       = aws_db_instance.main.endpoint
  description = "RDS endpoint"
  sensitive   = true
}

output "rds_address" {
  value       = aws_db_instance.main.address
  description = "RDS address"
}

output "rds_port" {
  value       = aws_db_instance.main.port
  description = "RDS port"
}

output "rds_database_name" {
  value       = aws_db_instance.main.db_name
  description = "RDS database name"
}

output "rds_credentials_secret_arn" {
  value       = aws_secretsmanager_secret.rds_credentials.arn
  description = "ARN of RDS credentials secret"
}

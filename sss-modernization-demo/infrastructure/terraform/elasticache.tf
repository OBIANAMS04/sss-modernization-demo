# ElastiCache Redis Cluster Configuration

# Cache Subnet Group
resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.app_name}-cache-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${var.app_name}-cache-subnet-group"
  }
}

# ElastiCache Redis Cluster
resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${var.app_name}-cache"
  engine               = "redis"
  engine_version       = "7.0"
  node_type            = var.elasticache_node_type
  num_cache_nodes      = var.elasticache_num_cache_nodes
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.main.name
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.elasticache.id]

  # Enable automatic failover
  automatic_failover_enabled = true

  # Enable encryption at rest
  at_rest_encryption_enabled = var.enable_encryption

  # Enable encryption in transit
  transit_encryption_enabled = var.enable_encryption

  # Enable automatic backups
  snapshot_retention_limit = 5
  snapshot_window          = "03:00-04:00"

  # Enable automatic updates
  auto_minor_version_upgrade = true

  # Enable CloudWatch logging
  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.elasticache_engine.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    enabled          = true
  }

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.elasticache_slow.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    enabled          = true
  }

  tags = {
    Name = "${var.app_name}-cache"
  }

  depends_on = [aws_security_group.elasticache]
}

# Parameter Group
resource "aws_elasticache_parameter_group" "main" {
  family = "redis7"
  name   = "${var.app_name}-cache-params"

  # Disable commands for security
  parameter {
    name  = "disable-commands"
    value = "FLUSHDB,FLUSHALL"
  }

  # Set maxmemory policy
  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  # Enable authentication
  parameter {
    name  = "requirepass"
    value = random_password.redis_auth.result
  }

  tags = {
    Name = "${var.app_name}-cache-params"
  }
}

# Redis authentication password
resource "random_password" "redis_auth" {
  length  = 32
  special = true
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "elasticache_engine" {
  name              = "/aws/elasticache/${var.app_name}/engine"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${var.app_name}-elasticache-engine-logs"
  }
}

resource "aws_cloudwatch_log_group" "elasticache_slow" {
  name              = "/aws/elasticache/${var.app_name}/slow-log"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${var.app_name}-elasticache-slow-logs"
  }
}

# Secrets Manager for Redis Credentials
resource "aws_secretsmanager_secret" "redis_credentials" {
  name                    = "${var.app_name}-redis-credentials"
  recovery_window_in_days = 7

  tags = {
    Name = "${var.app_name}-redis-credentials"
  }
}

resource "aws_secretsmanager_secret_version" "redis_credentials" {
  secret_id = aws_secretsmanager_secret.redis_credentials.id
  secret_string = jsonencode({
    engine   = "redis"
    host     = aws_elasticache_cluster.main.cache_nodes[0].address
    port     = aws_elasticache_cluster.main.port
    password = random_password.redis_auth.result
  })
}

# CloudWatch Alarms for ElastiCache
resource "aws_cloudwatch_metric_alarm" "elasticache_cpu" {
  alarm_name          = "${var.app_name}-cache-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "EngineCPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 75
  alarm_description   = "Alert when ElastiCache CPU exceeds 75%"

  dimensions = {
    CacheClusterId = aws_elasticache_cluster.main.id
  }
}

resource "aws_cloudwatch_metric_alarm" "elasticache_memory" {
  alarm_name          = "${var.app_name}-cache-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseMemoryUsagePercentage"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Alert when ElastiCache memory usage exceeds 80%"

  dimensions = {
    CacheClusterId = aws_elasticache_cluster.main.id
  }
}

resource "aws_cloudwatch_metric_alarm" "elasticache_evictions" {
  alarm_name          = "${var.app_name}-cache-evictions"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Sum"
  threshold           = 100
  alarm_description   = "Alert when cache evictions occur"

  dimensions = {
    CacheClusterId = aws_elasticache_cluster.main.id
  }
}

# Outputs
output "elasticache_endpoint" {
  value       = aws_elasticache_cluster.main.cache_nodes[0].address
  description = "ElastiCache endpoint"
}

output "elasticache_port" {
  value       = aws_elasticache_cluster.main.port
  description = "ElastiCache port"
}

output "redis_credentials_secret_arn" {
  value       = aws_secretsmanager_secret.redis_credentials.arn
  description = "ARN of Redis credentials secret"
}

output "redis_password" {
  value       = random_password.redis_auth.result
  description = "Redis authentication password"
  sensitive   = true
}

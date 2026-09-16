# CloudWatch Dashboards - Comprehensive Monitoring

# Main Operations Dashboard
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.app_name}-main-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      # Row 1: Application Health Overview
      {
        type = "metric"
        x    = 0
        y    = 0
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", { stat = "Average" }],
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", { stat = "Sum" }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "API Health"
          yAxis = {
            left = {
              min = 0
            }
          }
        }
      },
      {
        type = "metric"
        x    = 6
        y    = 0
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", { stat = "Sum" }],
            ["AWS/ApplicationELB", "TargetConnectionCount", { stat = "Average" }],
          ]
          period = 60
          stat   = "Sum"
          region = var.aws_region
          title  = "Traffic Volume"
        }
      },
      {
        type = "metric"
        x    = 12
        y    = 0
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", { stat = "Sum" }],
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", { stat = "Sum" }],
          ]
          period = 60
          stat   = "Sum"
          region = var.aws_region
          title  = "Error Rates"
          yAxis = {
            left = {
              min = 0
            }
          }
        }
      },
      {
        type = "metric"
        x    = 18
        y    = 0
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "UnHealthyHostCount"],
            ["AWS/ApplicationELB", "HealthyHostCount"],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "Target Health"
        }
      },

      # Row 2: ECS Performance
      {
        type = "metric"
        x    = 0
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ECS", "CPUUtilization", { dimensions = { ServiceName = "${var.app_name}-backend-service", ClusterName = "${var.app_name}-cluster" } }],
            ["AWS/ECS", "MemoryUtilization", { dimensions = { ServiceName = "${var.app_name}-backend-service", ClusterName = "${var.app_name}-cluster" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "ECS Backend Resources"
          yAxis = {
            left = {
              max = 100
            }
          }
        }
      },
      {
        type = "metric"
        x    = 6
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ECS", "RunningCount", { dimensions = { ServiceName = "${var.app_name}-backend-service", ClusterName = "${var.app_name}-cluster" } }],
            ["AWS/ECS", "DesiredCount", { dimensions = { ServiceName = "${var.app_name}-backend-service", ClusterName = "${var.app_name}-cluster" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "ECS Backend Tasks"
        }
      },
      {
        type = "metric"
        x    = 12
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ECS", "CPUUtilization", { dimensions = { ServiceName = "${var.app_name}-frontend-service", ClusterName = "${var.app_name}-cluster" } }],
            ["AWS/ECS", "MemoryUtilization", { dimensions = { ServiceName = "${var.app_name}-frontend-service", ClusterName = "${var.app_name}-cluster" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "ECS Frontend Resources"
          yAxis = {
            left = {
              max = 100
            }
          }
        }
      },
      {
        type = "metric"
        x    = 18
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ECS", "RunningCount", { dimensions = { ServiceName = "${var.app_name}-frontend-service", ClusterName = "${var.app_name}-cluster" } }],
            ["AWS/ECS", "DesiredCount", { dimensions = { ServiceName = "${var.app_name}-frontend-service", ClusterName = "${var.app_name}-cluster" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "ECS Frontend Tasks"
        }
      },

      # Row 3: Database Performance
      {
        type = "metric"
        x    = 0
        y    = 12
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", { dimensions = { DBInstanceIdentifier = "${var.app_name}-db" } }],
            ["AWS/RDS", "DatabaseConnections", { dimensions = { DBInstanceIdentifier = "${var.app_name}-db" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "RDS Database CPU & Connections"
        }
      },
      {
        type = "metric"
        x    = 6
        y    = 12
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "FreeStorageSpace", { dimensions = { DBInstanceIdentifier = "${var.app_name}-db" } }],
            ["AWS/RDS", "SwapUsage", { dimensions = { DBInstanceIdentifier = "${var.app_name}-db" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "RDS Storage & Memory"
        }
      },
      {
        type = "metric"
        x    = 12
        y    = 12
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "ReadLatency", { dimensions = { DBInstanceIdentifier = "${var.app_name}-db" } }],
            ["AWS/RDS", "WriteLatency", { dimensions = { DBInstanceIdentifier = "${var.app_name}-db" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "RDS Read/Write Latency"
        }
      },
      {
        type = "metric"
        x    = 18
        y    = 12
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "ReadThroughput", { dimensions = { DBInstanceIdentifier = "${var.app_name}-db" } }],
            ["AWS/RDS", "WriteThroughput", { dimensions = { DBInstanceIdentifier = "${var.app_name}-db" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "RDS Throughput"
        }
      },

      # Row 4: Cache Performance
      {
        type = "metric"
        x    = 0
        y    = 18
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ElastiCache", "EngineCPUUtilization", { dimensions = { CacheClusterId = "${var.app_name}-cache" } }],
            ["AWS/ElastiCache", "DatabaseMemoryUsagePercentage", { dimensions = { CacheClusterId = "${var.app_name}-cache" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "Redis CPU & Memory"
        }
      },
      {
        type = "metric"
        x    = 6
        y    = 18
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ElastiCache", "CacheHits", { dimensions = { CacheClusterId = "${var.app_name}-cache" } }],
            ["AWS/ElastiCache", "CacheMisses", { dimensions = { CacheClusterId = "${var.app_name}-cache" } }],
          ]
          period = 60
          stat   = "Sum"
          region = var.aws_region
          title  = "Redis Hit/Miss Rate"
        }
      },
      {
        type = "metric"
        x    = 12
        y    = 18
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ElastiCache", "Evictions", { dimensions = { CacheClusterId = "${var.app_name}-cache" } }],
            ["AWS/ElastiCache", "ReplicationLag", { dimensions = { CacheClusterId = "${var.app_name}-cache" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "Redis Health"
        }
      },
      {
        type = "metric"
        x    = 18
        y    = 18
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ElastiCache", "NetworkBytesIn", { dimensions = { CacheClusterId = "${var.app_name}-cache" } }],
            ["AWS/ElastiCache", "NetworkBytesOut", { dimensions = { CacheClusterId = "${var.app_name}-cache" } }],
          ]
          period = 60
          stat   = "Sum"
          region = var.aws_region
          title  = "Redis Network I/O"
        }
      },

      # Row 5: Logs Summary
      {
        type = "log"
        x    = 0
        y    = 24
        width = 12
        height = 6
        properties = {
          query   = "fields @timestamp, @message | filter @message like /ERROR/ | stats count() as error_count by @logStream"
          region  = var.aws_region
          title   = "Application Errors (Last Hour)"
          queryId = "errors-query"
        }
      },
      {
        type = "log"
        x    = 12
        y    = 24
        width = 12
        height = 6
        properties = {
          query   = "fields @duration | stats avg(@duration) as avg_latency, pct(@duration, 95) as p95_latency, pct(@duration, 99) as p99_latency"
          region  = var.aws_region
          title   = "API Latency Distribution"
          queryId = "latency-query"
        }
      },
    ]
  })
}

# Security & Compliance Dashboard
resource "aws_cloudwatch_dashboard" "security" {
  dashboard_name = "${var.app_name}-security-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      # WAF Metrics
      {
        type = "metric"
        x    = 0
        y    = 0
        width = 8
        height = 6
        properties = {
          metrics = [
            ["AWS/WAFV2", "AllowedRequests", { WebACL = "${var.app_name}-web-acl", Region = var.aws_region }],
            ["AWS/WAFV2", "BlockedRequests", { WebACL = "${var.app_name}-web-acl", Region = var.aws_region }],
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "WAF Allowed vs Blocked"
        }
      },
      {
        type = "metric"
        x    = 8
        y    = 0
        width = 8
        height = 6
        properties = {
          metrics = [
            ["AWS/WAFV2", "CountedRequests", { Rule = "AWSManagedRulesCommonRuleSet", WebACL = "${var.app_name}-web-acl", Region = var.aws_region }],
            ["AWS/WAFV2", "CountedRequests", { Rule = "AWSManagedRulesSQLiRuleSet", WebACL = "${var.app_name}-web-acl", Region = var.aws_region }],
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "WAF Rule Matches"
        }
      },
      {
        type = "log"
        x    = 16
        y    = 0
        width = 8
        height = 6
        properties = {
          query   = "fields @timestamp, @message | filter @message like /POLICY_DENIED|ACCESS_DENIED/ | stats count() as denial_count"
          region  = var.aws_region
          title   = "Policy Violations (Last Hour)"
          queryId = "policy-violations"
        }
      },

      # Encryption & TLS
      {
        type = "metric"
        x    = 0
        y    = 6
        width = 8
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "StorageEncrypted", { DBInstanceIdentifier = "${var.app_name}-db" }],
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "RDS Encryption Status (1=enabled)"
        }
      },
      {
        type = "log"
        x    = 8
        y    = 6
        width = 8
        height = 6
        properties = {
          query   = "fields @timestamp, @message | filter @message like /TLS|SSL/ | stats count() as ssl_connections"
          region  = var.aws_region
          title   = "Encrypted Connections"
          queryId = "ssl-connections"
        }
      },
      {
        type = "log"
        x    = 16
        y    = 6
        width = 8
        height = 6
        properties = {
          query   = "fields @timestamp, @message | filter @message like /AUTHENTICATION_FAILED|LOGIN_FAILED/ | stats count() as failed_logins by @logStream"
          region  = var.aws_region
          title   = "Failed Authentication Attempts"
          queryId = "auth-failures"
        }
      },

      # Compliance Audit
      {
        type = "log"
        x    = 0
        y    = 12
        width = 12
        height = 6
        properties = {
          query   = "fields @timestamp, @message, user_id | filter @message like /AUDIT_LOG|COMPLIANCE_CHECK/ | stats count() as audit_events by @logStream"
          region  = var.aws_region
          title   = "Audit Log Events"
          queryId = "audit-events"
        }
      },
      {
        type = "log"
        x    = 12
        y    = 12
        width = 12
        height = 6
        properties = {
          query   = "fields @timestamp, @message | filter @message like /\\[REDACTED\\]/ | stats count() as redacted_fields"
          region  = var.aws_region
          title   = "Sensitive Data Redactions (PII Protection)"
          queryId = "redactions"
        }
      },
    ]
  })
}

# Performance Dashboard
resource "aws_cloudwatch_dashboard" "performance" {
  dashboard_name = "${var.app_name}-performance-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      # Latency Percentiles
      {
        type = "metric"
        x    = 0
        y    = 0
        width = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", { stat = "Average" }],
            ["AWS/ApplicationELB", "TargetResponseTime", { stat = "p50" }],
            ["AWS/ApplicationELB", "TargetResponseTime", { stat = "p95" }],
            ["AWS/ApplicationELB", "TargetResponseTime", { stat = "p99" }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "API Response Time Percentiles (SLO: p95<500ms)"
          yAxis = {
            left = {
              min = 0
              max = 1000
            }
          }
        }
      },
      {
        type = "log"
        x    = 12
        y    = 0
        width = 12
        height = 6
        properties = {
          query   = "fields @duration | stats avg(@duration) as avg_ms, pct(@duration, 50) as p50_ms, pct(@duration, 95) as p95_ms, pct(@duration, 99) as p99_ms"
          region  = var.aws_region
          title   = "Application Latency Distribution"
          queryId = "latency-distribution"
        }
      },

      # Throughput
      {
        type = "metric"
        x    = 0
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", { stat = "Sum" }],
          ]
          period = 60
          stat   = "Sum"
          region = var.aws_region
          title  = "Request Throughput (requests/min)"
        }
      },
      {
        type = "metric"
        x    = 6
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "ProcessedBytes", { stat = "Sum" }],
          ]
          period = 60
          stat   = "Sum"
          region = var.aws_region
          title  = "Data Processed (bytes/min)"
        }
      },
      {
        type = "metric"
        x    = 12
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "ReadThroughput", { dimensions = { DBInstanceIdentifier = "${var.app_name}-db" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "Database Read Throughput"
        }
      },
      {
        type = "metric"
        x    = 18
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "WriteThroughput", { dimensions = { DBInstanceIdentifier = "${var.app_name}-db" } }],
          ]
          period = 60
          stat   = "Average"
          region = var.aws_region
          title  = "Database Write Throughput"
        }
      },

      # Cache Efficiency
      {
        type = "log"
        x    = 0
        y    = 12
        width = 12
        height = 6
        properties = {
          query   = "fields @timestamp | stats count() as total_requests, count(select 1 where ispresent(@cache_hit)) as cache_hits | stats (cache_hits/total_requests)*100 as cache_hit_ratio"
          region  = var.aws_region
          title   = "Cache Hit Ratio (Target: >85%)"
          queryId = "cache-ratio"
        }
      },
      {
        type = "metric"
        x    = 12
        y    = 12
        width = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/ElastiCache", "CacheHits", { dimensions = { CacheClusterId = "${var.app_name}-cache" } }],
            ["AWS/ElastiCache", "CacheMisses", { dimensions = { CacheClusterId = "${var.app_name}-cache" } }],
          ]
          period = 60
          stat   = "Sum"
          region = var.aws_region
          title  = "Redis Hit/Miss Volume"
        }
      },
    ]
  })
}

# Billing & Cost Dashboard
resource "aws_cloudwatch_dashboard" "billing" {
  dashboard_name = "${var.app_name}-billing-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      # Monthly Costs by Service
      {
        type = "metric"
        x    = 0
        y    = 0
        width = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/Billing", "EstimatedCharges", { stat = "Average" }],
          ]
          period = 86400
          stat   = "Average"
          region = "us-east-1"
          title  = "Estimated Monthly Charges"
          yAxis = {
            left = {
              min = 0
            }
          }
        }
      },
      {
        type = "log"
        x    = 12
        y    = 0
        width = 12
        height = 6
        properties = {
          query   = "fields servicename, @cost | stats sum(@cost) as total_cost by servicename | sort total_cost desc"
          region  = var.aws_region
          title   = "Cost by Service"
          queryId = "cost-by-service"
        }
      },

      # Resource Utilization
      {
        type = "metric"
        x    = 0
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ECS", "CPUUtilization", { dimensions = { ServiceName = "${var.app_name}-backend-service", ClusterName = "${var.app_name}-cluster" } }],
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "ECS CPU Utilization"
          yAxis = {
            left = {
              max = 100
            }
          }
        }
      },
      {
        type = "metric"
        x    = 6
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", { dimensions = { DBInstanceIdentifier = "${var.app_name}-db" } }],
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "RDS CPU Utilization"
          yAxis = {
            left = {
              max = 100
            }
          }
        }
      },
      {
        type = "metric"
        x    = 12
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ElastiCache", "EngineCPUUtilization", { dimensions = { CacheClusterId = "${var.app_name}-cache" } }],
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "Redis CPU Utilization"
          yAxis = {
            left = {
              max = 100
            }
          }
        }
      },
      {
        type = "metric"
        x    = 18
        y    = 6
        width = 6
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "ProcessedBytes", { stat = "Sum" }],
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "ALB Data Processed"
        }
      },
    ]
  })
}

output "main_dashboard_url" {
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
  description = "URL to main operations dashboard"
}

output "security_dashboard_url" {
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.security.dashboard_name}"
  description = "URL to security & compliance dashboard"
}

output "performance_dashboard_url" {
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.performance.dashboard_name}"
  description = "URL to performance dashboard"
}

output "billing_dashboard_url" {
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.billing.dashboard_name}"
  description = "URL to billing & cost dashboard"
}

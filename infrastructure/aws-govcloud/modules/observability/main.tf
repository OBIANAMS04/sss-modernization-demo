# CloudWatch alarms that mirror the application's service level objectives
# (sss-modernization-demo/backend/src/observability/slo.ts: availability 99.5%, p95 under 2 s,
# per-route 5xx under 1%) plus the infrastructure signals behind them. The log groups themselves are
# created next to what writes to them (network, security, data and compute modules), encrypted and
# with retention.

resource "aws_sns_topic" "alarms" {
  name              = "${var.name_prefix}-alarms"
  kms_master_key_id = var.platform_kms_key_arn

  tags = { Name = "${var.name_prefix}-alarms" }
}

resource "aws_sns_topic_subscription" "email" {
  for_each = var.alarm_emails

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = each.value
}

locals {
  alarm_actions = [aws_sns_topic.alarms.arn]
  db_instances  = { for i, id in var.db_instance_identifiers : tostring(i) => id }
  db_readers    = { for i, id in var.db_instance_identifiers : tostring(i) => id if i > 0 }
}

# --- Load balancer: SLO alarms -------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "alb_5xx_rate" {
  alarm_name          = "${var.name_prefix}-api-5xx-rate"
  alarm_description   = "More than ${var.error_rate_percent}% of API requests ended in a server error (availability objective 99.5%)."
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.error_rate_percent
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  metric_query {
    id          = "rate"
    expression  = "IF(requests > 0, 100 * errors / requests, 0)"
    label       = "5xx percent"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = var.alb_arn_suffix
        TargetGroup  = var.api_target_group_arn_suffix
      }
    }
  }

  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = var.alb_arn_suffix
        TargetGroup  = var.api_target_group_arn_suffix
      }
    }
  }

  tags = { Name = "${var.name_prefix}-api-5xx-rate" }
}

resource "aws_cloudwatch_metric_alarm" "alb_own_5xx" {
  alarm_name          = "${var.name_prefix}-alb-5xx"
  alarm_description   = "The load balancer itself returned 5xx responses (no healthy target, or overloaded)."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  dimensions          = { LoadBalancer = var.alb_arn_suffix }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  tags = { Name = "${var.name_prefix}-alb-5xx" }
}

resource "aws_cloudwatch_metric_alarm" "alb_p95_latency" {
  alarm_name          = "${var.name_prefix}-api-p95-latency"
  alarm_description   = "p95 response time of the API is over ${var.p95_latency_seconds} s (latency objective)."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.api_target_group_arn_suffix }
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.p95_latency_seconds
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  tags = { Name = "${var.name_prefix}-api-p95-latency" }
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_targets" {
  alarm_name          = "${var.name_prefix}-api-unhealthy-targets"
  alarm_description   = "At least one API task is failing its /health check."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.api_target_group_arn_suffix }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  tags = { Name = "${var.name_prefix}-api-unhealthy-targets" }
}

# --- ECS -----------------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "ecs_cpu" {
  alarm_name          = "${var.name_prefix}-api-cpu"
  alarm_description   = "Average API task CPU is over ${var.cpu_percent}% (sizing runs at 50%)."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = { ClusterName = var.cluster_name, ServiceName = var.api_service_name }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.cpu_percent
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  tags = { Name = "${var.name_prefix}-api-cpu" }
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory" {
  alarm_name          = "${var.name_prefix}-api-memory"
  alarm_description   = "Average API task memory is over 80%."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  dimensions          = { ClusterName = var.cluster_name, ServiceName = var.api_service_name }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  tags = { Name = "${var.name_prefix}-api-memory" }
}

resource "aws_cloudwatch_metric_alarm" "ecs_running_tasks" {
  alarm_name          = "${var.name_prefix}-api-running-tasks"
  alarm_description   = "Fewer API tasks are running than the minimum (${var.min_running_tasks}): a zone or a deploy has failed."
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  dimensions          = { ClusterName = var.cluster_name, ServiceName = var.api_service_name }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  comparison_operator = "LessThanThreshold"
  threshold           = var.min_running_tasks
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  tags = { Name = "${var.name_prefix}-api-running-tasks" }
}

# --- Aurora --------------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  for_each = local.db_instances

  alarm_name          = "${var.name_prefix}-db-${each.key}-cpu"
  alarm_description   = "Aurora instance ${each.value} CPU is over ${var.cpu_percent}%."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = each.value }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.cpu_percent
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  tags = { Name = "${var.name_prefix}-db-${each.key}-cpu" }
}

resource "aws_cloudwatch_metric_alarm" "db_connections" {
  for_each = local.db_instances

  alarm_name          = "${var.name_prefix}-db-${each.key}-connections"
  alarm_description   = "Aurora instance ${each.value} has more than ${var.db_connections_threshold} connections."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  dimensions          = { DBInstanceIdentifier = each.value }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.db_connections_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  tags = { Name = "${var.name_prefix}-db-${each.key}-connections" }
}

resource "aws_cloudwatch_metric_alarm" "db_free_storage" {
  for_each = local.db_instances

  alarm_name          = "${var.name_prefix}-db-${each.key}-free-local-storage"
  alarm_description   = "Aurora instance ${each.value} has little local storage left (temporary files, logs)."
  namespace           = "AWS/RDS"
  metric_name         = "FreeLocalStorage"
  dimensions          = { DBInstanceIdentifier = each.value }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  comparison_operator = "LessThanThreshold"
  threshold           = var.db_free_local_storage_bytes
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  tags = { Name = "${var.name_prefix}-db-${each.key}-free-local-storage" }
}

resource "aws_cloudwatch_metric_alarm" "db_replica_lag" {
  for_each = local.db_readers

  alarm_name          = "${var.name_prefix}-db-${each.key}-replica-lag"
  alarm_description   = "Aurora reader ${each.value} lags the writer by more than ${var.replica_lag_ms} ms."
  namespace           = "AWS/RDS"
  metric_name         = "AuroraReplicaLag"
  dimensions          = { DBInstanceIdentifier = each.value }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.replica_lag_ms
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  tags = { Name = "${var.name_prefix}-db-${each.key}-replica-lag" }
}

# --- Dashboard -----------------------------------------------------------------------------------

data "aws_region" "current" {}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = "${var.name_prefix}-overview"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title  = "Requests and 5xx"
          region = data.aws_region.current.name
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix],
            [".", "HTTPCode_Target_5XX_Count", ".", "."],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title  = "Latency p95 (s)"
          region = data.aws_region.current.name
          stat   = "p95"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.api_target_group_arn_suffix],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 6, width = 12, height = 6
        properties = {
          title  = "API CPU and memory (%)"
          region = data.aws_region.current.name
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", var.cluster_name, "ServiceName", var.api_service_name],
            [".", "MemoryUtilization", ".", ".", ".", "."],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 6, width = 12, height = 6
        properties = {
          title  = "Aurora writer CPU and connections"
          region = data.aws_region.current.name
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_instance_identifiers[0]],
            [".", "DatabaseConnections", ".", "."],
          ]
        }
      },
    ]
  })
}

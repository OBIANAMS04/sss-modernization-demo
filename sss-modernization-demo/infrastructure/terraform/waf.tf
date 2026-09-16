# AWS WAF (Web Application Firewall) Configuration

# WAF Web ACL
resource "aws_wafv2_web_acl" "main" {
  count = var.enable_waf ? 1 : 0
  name  = "${var.app_name}-web-acl"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # Rule 1: AWS Managed Rules - Core Rule Set
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    action {
      block {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        rule_action_override {
          name = "SizeRestrictions_BODY"

          action_to_use {
            block {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # Rule 2: Known Bad Inputs Rule Set
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2

    action {
      block {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesKnownBadInputsRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # Rule 3: SQL Injection Protection
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 3

    action {
      block {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesSQLiRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # Rule 4: Rate Limiting (custom rule)
  rule {
    name     = "RateLimitRule"
    priority = 4

    action {
      block {
        custom_response {
          response_code = 429
          custom_response_body_key = "rate-limit-message"
        }
      }
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitRuleMetric"
      sampled_requests_enabled   = true
    }
  }

  # Rule 5: Geo-blocking (optional - block non-US traffic)
  rule {
    name     = "GeoBlockingRule"
    priority = 5

    action {
      block {}
    }

    statement {
      geo_match_statement {
        country_codes = ["CN", "RU", "KP"] # Example: block China, Russia, North Korea
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "GeoBlockingRuleMetric"
      sampled_requests_enabled   = true
    }
  }

  custom_response_body {
    key          = "rate-limit-message"
    content      = "Too many requests. Please try again later."
    content_type = "TEXT_PLAIN"
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.app_name}-web-acl-metric"
    sampled_requests_enabled   = true
  }

  tags = {
    Name = "${var.app_name}-web-acl"
  }
}

# Associate WAF with ALB
resource "aws_wafv2_web_acl_association" "alb" {
  count        = var.enable_waf ? 1 : 0
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main[0].arn
}

# CloudWatch Log Group for WAF
resource "aws_cloudwatch_log_group" "waf" {
  count             = var.enable_waf ? 1 : 0
  name              = "/aws/waf/${var.app_name}"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${var.app_name}-waf-logs"
  }
}

# WAF Logging Configuration
resource "aws_wafv2_web_acl_logging_configuration" "main" {
  count                   = var.enable_waf ? 1 : 0
  resource_arn            = aws_wafv2_web_acl.main[0].arn
  log_destination_configs = [aws_cloudwatch_log_group.waf[0].arn]

  logging_filter {
    default_behavior = "KEEP"

    filter {
      behavior = "KEEP"

      condition {
        action_condition {
          action = "BLOCK"
        }
      }

      requirement = "MEETS_ANY"
    }
  }
}

# CloudWatch Alarms for WAF
resource "aws_cloudwatch_metric_alarm" "waf_blocked_requests" {
  count               = var.enable_waf ? 1 : 0
  alarm_name          = "${var.app_name}-waf-blocked-requests"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BlockedRequests"
  namespace           = "AWS/WAFV2"
  period              = 300
  statistic           = "Sum"
  threshold           = 100
  alarm_description   = "Alert when WAF blocks more than 100 requests in 5 minutes"

  dimensions = {
    Rule   = "ALL"
    WebACL = aws_wafv2_web_acl.main[0].name
  }
}

output "waf_web_acl_arn" {
  value       = var.enable_waf ? aws_wafv2_web_acl.main[0].arn : ""
  description = "WAF Web ACL ARN"
}

output "waf_enabled" {
  value       = var.enable_waf
  description = "Whether WAF is enabled"
}

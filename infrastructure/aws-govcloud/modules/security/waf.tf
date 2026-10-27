# AWS WAF (regional) for the Application Load Balancer: AWS managed rule groups (common, known bad
# inputs, SQL injection, IP reputation) and two rate-based rules (all traffic; sign-in paths).
# The association with the load balancer is made in the compute module.

locals {
  managed_groups = {
    common     = { name = "AWSManagedRulesCommonRuleSet", priority = 10 }
    known_bad  = { name = "AWSManagedRulesKnownBadInputsRuleSet", priority = 20 }
    sqli       = { name = "AWSManagedRulesSQLiRuleSet", priority = 30 }
    ip_reputed = { name = "AWSManagedRulesAmazonIpReputationList", priority = 40 }
  }
}

resource "aws_wafv2_web_acl" "this" {
  name        = "${var.name_prefix}-alb"
  description = "Managed rule groups and rate limits in front of the ${var.name_prefix} load balancer"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  dynamic "rule" {
    for_each = local.managed_groups
    content {
      name     = rule.value.name
      priority = rule.value.priority

      override_action {
        none {}
      }

      statement {
        managed_rule_group_statement {
          name        = rule.value.name
          vendor_name = "AWS"

          dynamic "rule_action_override" {
            for_each = rule.key == "common" ? var.waf_common_rule_count_only : []
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name_prefix}-${rule.key}"
        sampled_requests_enabled   = true
      }
    }
  }

  rule {
    name     = "RateLimitPerIp"
    priority = 50

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate-all"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimitSignInPerIp"
    priority = 60

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_auth_rate_limit
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string         = var.waf_auth_path_prefix
            positional_constraint = "STARTS_WITH"

            field_to_match {
              uri_path {}
            }

            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate-auth"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-alb"
    sampled_requests_enabled   = true
  }

  tags = { Name = "${var.name_prefix}-alb-waf" }
}

# WAF log group names must start with aws-waf-logs-.
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${var.name_prefix}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.this["logs"].arn

  tags = { Name = "${var.name_prefix}-waf-logs" }
}

data "aws_iam_policy_document" "waf_log_delivery" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.waf.arn}:*"]
    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:logs:${local.region}:${local.account_id}:*"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_cloudwatch_log_resource_policy" "waf" {
  policy_name     = "${var.name_prefix}-waf-log-delivery"
  policy_document = data.aws_iam_policy_document.waf_log_delivery.json
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
  redacted_fields {
    single_header {
      name = "cookie"
    }
  }

  depends_on = [aws_cloudwatch_log_resource_policy.waf]
}

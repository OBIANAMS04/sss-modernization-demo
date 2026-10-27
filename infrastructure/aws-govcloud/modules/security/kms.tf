# Customer-managed KMS keys, one per purpose, all with automatic annual rotation.
# The account root statement is the standard key-policy delegation: access is then granted by IAM
# policies (least privilege on the roles in the compute module) and by service principals below.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  region     = data.aws_region.current.name

  keys = {
    logs = {
      description = "CloudWatch Logs groups (application, flow, WAF)"
      services    = ["delivery.logs.amazonaws.com"]
      logs        = true
      cloudtrail  = false
    }
    database = {
      description = "Aurora storage, snapshots and Performance Insights"
      services    = []
      logs        = false
      cloudtrail  = false
    }
    secrets = {
      description = "Secrets Manager secrets"
      services    = []
      logs        = false
      cloudtrail  = false
    }
    audit = {
      description = "S3 Object Lock audit log bucket"
      services    = []
      logs        = false
      cloudtrail  = false
    }
    platform = {
      description = "CloudTrail, SNS alarm topic and ECR repositories"
      services    = ["cloudwatch.amazonaws.com", "sns.amazonaws.com", "events.amazonaws.com"]
      logs        = false
      cloudtrail  = true
    }
  }
}

data "aws_iam_policy_document" "key" {
  for_each = local.keys

  statement {
    sid       = "AccountDelegation"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  dynamic "statement" {
    for_each = each.value.logs ? [1] : []
    content {
      sid       = "CloudWatchLogs"
      actions   = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
      resources = ["*"]
      principals {
        type        = "Service"
        identifiers = ["logs.${local.region}.amazonaws.com"]
      }
      condition {
        test     = "ArnLike"
        variable = "kms:EncryptionContext:aws:logs:arn"
        values   = ["arn:${local.partition}:logs:${local.region}:${local.account_id}:*"]
      }
    }
  }

  dynamic "statement" {
    for_each = each.value.cloudtrail ? [1] : []
    content {
      sid       = "CloudTrail"
      actions   = ["kms:GenerateDataKey*", "kms:DescribeKey"]
      resources = ["*"]
      principals {
        type        = "Service"
        identifiers = ["cloudtrail.amazonaws.com"]
      }
      condition {
        test     = "ArnLike"
        variable = "kms:EncryptionContext:aws:cloudtrail:arn"
        values   = ["arn:${local.partition}:cloudtrail:*:${local.account_id}:trail/*"]
      }
    }
  }

  dynamic "statement" {
    for_each = toset(each.value.services)
    content {
      sid       = "Service${replace(statement.value, "/[^a-zA-Z0-9]/", "")}"
      actions   = ["kms:Decrypt", "kms:GenerateDataKey*", "kms:DescribeKey"]
      resources = ["*"]
      principals {
        type        = "Service"
        identifiers = [statement.value]
      }
      condition {
        test     = "StringEquals"
        variable = "aws:SourceAccount"
        values   = [local.account_id]
      }
    }
  }
}

resource "aws_kms_key" "this" {
  for_each = local.keys

  description             = "${var.name_prefix}: ${each.value.description}"
  enable_key_rotation     = true
  rotation_period_in_days = 365
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.key[each.key].json

  tags = { Name = "${var.name_prefix}-${each.key}", Purpose = each.key }
}

resource "aws_kms_alias" "this" {
  for_each = local.keys

  name          = "alias/${var.name_prefix}-${each.key}"
  target_key_id = aws_kms_key.this[each.key].key_id
}

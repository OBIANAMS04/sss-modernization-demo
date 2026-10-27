# Multi-region CloudTrail with log file validation, encrypted with the platform KMS key.
# Created in the primary region only (var.enable_cloudtrail).

locals {
  trail_name = "${var.name_prefix}-trail"
  trail_arn  = "arn:${local.partition}:cloudtrail:${local.region}:${local.account_id}:trail/${local.trail_name}"
}

resource "aws_s3_bucket" "cloudtrail" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket = "${var.name_prefix}-cloudtrail-${local.account_id}-${local.region}"

  tags = { Name = "${var.name_prefix}-cloudtrail" }
}

resource "aws_s3_bucket_public_access_block" "cloudtrail" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket                  = aws_s3_bucket.cloudtrail[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "cloudtrail" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket = aws_s3_bucket.cloudtrail[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

# The trail encrypts each log file with the KMS key; the bucket default is SSE-S3 for the rest.
resource "aws_s3_bucket_server_side_encryption_configuration" "cloudtrail" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket = aws_s3_bucket.cloudtrail[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cloudtrail" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket = aws_s3_bucket.cloudtrail[0].id

  rule {
    id     = "expire"
    status = "Enabled"
    filter {}

    expiration {
      days = var.security_log_expiry_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 365
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "cloudtrail_bucket" {
  count = var.enable_cloudtrail ? 1 : 0

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.cloudtrail[0].arn, "${aws_s3_bucket.cloudtrail[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "CloudTrailAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.cloudtrail[0].arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }

  statement {
    sid       = "CloudTrailWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.cloudtrail[0].arn}/AWSLogs/${local.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }
}

resource "aws_s3_bucket_policy" "cloudtrail" {
  count = var.enable_cloudtrail ? 1 : 0

  bucket = aws_s3_bucket.cloudtrail[0].id
  policy = data.aws_iam_policy_document.cloudtrail_bucket[0].json

  depends_on = [aws_s3_bucket_public_access_block.cloudtrail]
}

resource "aws_cloudtrail" "this" {
  count = var.enable_cloudtrail ? 1 : 0

  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.cloudtrail[0].id
  kms_key_id                    = aws_kms_key.this["platform"].arn
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  cloud_watch_logs_group_arn    = "${aws_cloudwatch_log_group.cloudtrail[0].arn}:*"
  cloud_watch_logs_role_arn     = aws_iam_role.cloudtrail[0].arn

  depends_on = [aws_s3_bucket_policy.cloudtrail, aws_iam_role_policy.cloudtrail]

  tags = { Name = local.trail_name }
}

# --- CloudWatch Logs delivery of the trail (alerting on API activity) ----------------------------

resource "aws_cloudwatch_log_group" "cloudtrail" {
  count = var.enable_cloudtrail ? 1 : 0

  name              = "/${var.name_prefix}/cloudtrail"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.this["logs"].arn

  tags = { Name = "${var.name_prefix}-cloudtrail-logs" }
}

data "aws_iam_policy_document" "cloudtrail_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "cloudtrail_logs" {
  count = var.enable_cloudtrail ? 1 : 0

  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.cloudtrail[0].arn}:log-stream:*"]
  }
}

resource "aws_iam_role" "cloudtrail" {
  count = var.enable_cloudtrail ? 1 : 0

  name               = "${var.name_prefix}-cloudtrail-to-logs"
  assume_role_policy = data.aws_iam_policy_document.cloudtrail_assume.json
}

resource "aws_iam_role_policy" "cloudtrail" {
  count = var.enable_cloudtrail ? 1 : 0

  name   = "write-trail-logs"
  role   = aws_iam_role.cloudtrail[0].id
  policy = data.aws_iam_policy_document.cloudtrail_logs[0].json
}

# Least-privilege roles for the tasks.
#  - execution role: what ECS itself needs to start a task (pull the image, write logs, read the
#    three secrets and decrypt them). The application code never has these permissions.
#  - task role: what the running API may do (append to the audit bucket, publish custom metrics,
#    and, only if enabled, connect with IAM database authentication or ECS Exec).

data "aws_iam_policy_document" "tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid       = "ReadTheApplicationSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = values(var.secret_arns)
  }
  statement {
    sid       = "DecryptSecretsViaSecretsManager"
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arns["secrets"]]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }
  statement {
    sid       = "WriteEncryptedLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:log-stream:*", "${aws_cloudwatch_log_group.web.arn}:log-stream:*"]
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "secrets-and-logs"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-api-task"
  assume_role_policy = data.aws_iam_policy_document.tasks_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "AppendToTheAuditBucket"
    actions   = ["s3:PutObject"]
    resources = ["${var.audit_bucket_arn}/*"]
  }
  statement {
    sid       = "EncryptAuditObjects"
    actions   = ["kms:GenerateDataKey", "kms:Encrypt"]
    resources = [var.audit_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${local.region}.amazonaws.com"]
    }
  }
  statement {
    sid       = "PublishApplicationMetrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["SSS/API"]
    }
  }

  dynamic "statement" {
    for_each = var.iam_database_authentication && var.database_proxy_arn != null ? [1] : []
    content {
      sid       = "ConnectToTheDatabaseWithIam"
      actions   = ["rds-db:connect"]
      resources = ["arn:${local.partition}:rds-db:${local.region}:${local.account_id}:dbuser:${element(split(":", var.database_proxy_arn), 6)}/${var.database_user}"]
    }
  }

  dynamic "statement" {
    for_each = var.enable_execute_command ? [1] : []
    content {
      sid       = "EcsExecChannel"
      actions   = ["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"]
      resources = ["*"]
    }
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "api-runtime"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

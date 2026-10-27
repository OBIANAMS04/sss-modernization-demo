# Secrets Manager: the three application secrets. The values are NOT in code. Each secret is created
# with an obvious placeholder version and ignore_changes on the value, so the operator sets the real
# value once (README, apply runbook) and Terraform never reads or overwrites it.

locals {
  secret_names = {
    jwt_secret        = "jwt-secret"
    database_password = "database-password"
    anthropic_api_key = "anthropic-api-key"
  }

  # DATABASE_PASSWORD is stored as JSON so RDS Proxy can use the same secret for authentication
  # (it expects username and password keys) and the task reads the password key.
  secret_placeholders = {
    jwt_secret        = "PLACEHOLDER-SET-BY-OPERATOR"
    database_password = jsonencode({ username = var.app_db_user, password = "PLACEHOLDER-SET-BY-OPERATOR" })
    anthropic_api_key = "PLACEHOLDER-SET-BY-OPERATOR"
  }
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.secret_names

  name                    = "${var.name_prefix}/${each.value}"
  description             = "${upper(replace(each.value, "-", "_"))} for the API. Value set by the operator, not by Terraform."
  kms_key_id              = var.kms_key_arns["secrets"]
  recovery_window_in_days = 30

  tags = { Name = "${var.name_prefix}-${each.value}" }
}

resource "aws_secretsmanager_secret_version" "app" {
  for_each = local.secret_names

  secret_id     = aws_secretsmanager_secret.app[each.key].id
  secret_string = local.secret_placeholders[each.key]

  lifecycle {
    ignore_changes = [secret_string]
  }
}

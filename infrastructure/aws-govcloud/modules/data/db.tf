# Aurora PostgreSQL. Primary region: the global cluster and its writer cluster across three zones.
# Standby region: a read-only secondary cluster of the same global cluster (warm standby).

data "aws_partition" "current" {}
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  primary   = var.role == "primary"
  partition = data.aws_partition.current.partition
  region    = data.aws_region.current.name
  account   = data.aws_caller_identity.current.account_id
}

resource "aws_security_group" "db" {
  name_prefix = "${var.name_prefix}-aurora-"
  description = "PostgreSQL from the proxy and the application tasks only"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-aurora" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_clients" {
  for_each = toset(var.client_security_group_ids)

  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = each.value
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL from application tasks (migrations and administration)"
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-aurora"
  subnet_ids = var.data_subnet_ids

  tags = { Name = "${var.name_prefix}-aurora" }
}

resource "aws_rds_cluster_parameter_group" "this" {
  name_prefix = "${var.name_prefix}-aurora-pg16-"
  family      = "aurora-postgresql16"
  description = "TLS required, slow statements logged"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
  parameter {
    name  = "log_connections"
    value = "1"
  }

  tags = { Name = "${var.name_prefix}-aurora-pg16" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_rds_global_cluster" "this" {
  count = local.primary ? 1 : 0

  global_cluster_identifier = "${var.name_prefix}-global"
  engine                    = "aurora-postgresql"
  engine_version            = var.engine_version
  database_name             = var.database_name
  storage_encrypted         = true
  deletion_protection       = var.deletion_protection
}

resource "aws_rds_cluster" "this" {
  cluster_identifier        = "${var.name_prefix}-aurora"
  engine                    = "aurora-postgresql"
  engine_version            = var.engine_version
  global_cluster_identifier = local.primary ? aws_rds_global_cluster.this[0].id : var.global_cluster_identifier
  source_region             = local.primary ? null : var.source_region

  availability_zones              = var.availability_zones
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [aws_security_group.db.id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.this.name
  port                            = 5432

  # Credentials exist only on the primary cluster; RDS generates the master password and keeps it in
  # Secrets Manager encrypted with our key, so it is never in code or Terraform state.
  database_name                 = local.primary ? var.database_name : null
  master_username               = local.primary ? var.master_username : null
  manage_master_user_password   = local.primary ? true : null
  master_user_secret_kms_key_id = local.primary ? var.kms_key_arns["secrets"] : null

  storage_encrypted                   = true
  kms_key_id                          = var.kms_key_arns["database"]
  iam_database_authentication_enabled = var.iam_database_authentication

  backup_retention_period      = var.backup_retention_days
  preferred_backup_window      = "07:00-08:00"
  preferred_maintenance_window = "sun:08:30-sun:09:30"
  copy_tags_to_snapshot        = true
  deletion_protection          = var.deletion_protection
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${var.name_prefix}-aurora-final"

  enabled_cloudwatch_logs_exports = ["postgresql"]
  depends_on                      = [aws_cloudwatch_log_group.postgresql]

  tags = { Name = "${var.name_prefix}-aurora" }

  lifecycle {
    ignore_changes = [availability_zones]
  }
}

data "aws_iam_policy_document" "monitoring_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  name               = "${var.name_prefix}-rds-monitoring-${local.region}"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume.json
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  role       = aws_iam_role.monitoring.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_rds_cluster_instance" "this" {
  count = var.instance_count

  identifier           = "${var.name_prefix}-aurora-${count.index}"
  cluster_identifier   = aws_rds_cluster.this.id
  engine               = aws_rds_cluster.this.engine
  engine_version       = aws_rds_cluster.this.engine_version
  instance_class       = var.instance_class
  db_subnet_group_name = aws_db_subnet_group.this.name
  availability_zone    = var.availability_zones[count.index % 3]
  promotion_tier       = min(count.index, 15)
  publicly_accessible  = false

  auto_minor_version_upgrade            = true
  copy_tags_to_snapshot                 = true
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = var.kms_key_arns["database"]
  performance_insights_retention_period = var.performance_insights_retention_days
  monitoring_interval                   = 60
  monitoring_role_arn                   = aws_iam_role.monitoring.arn

  tags = { Name = "${var.name_prefix}-aurora-${count.index}" }
}

# --- RDS Proxy -----------------------------------------------------------------------------------

resource "aws_security_group" "proxy" {
  count = var.create_proxy ? 1 : 0

  name_prefix = "${var.name_prefix}-rdsproxy-"
  description = "RDS Proxy: PostgreSQL from application tasks, to the database"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-rdsproxy" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "proxy_from_clients" {
  for_each = var.create_proxy ? toset(var.client_security_group_ids) : toset([])

  security_group_id            = aws_security_group.proxy[0].id
  referenced_security_group_id = each.value
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL from application tasks"
}

resource "aws_vpc_security_group_egress_rule" "proxy_to_db" {
  count = var.create_proxy ? 1 : 0

  security_group_id            = aws_security_group.proxy[0].id
  referenced_security_group_id = aws_security_group.db.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL to Aurora"
}

resource "aws_vpc_security_group_egress_rule" "proxy_https" {
  count = var.create_proxy ? 1 : 0

  security_group_id = aws_security_group.proxy[0].id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS to Secrets Manager and KMS"
}

resource "aws_vpc_security_group_ingress_rule" "db_from_proxy" {
  count = var.create_proxy ? 1 : 0

  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.proxy[0].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL from RDS Proxy"
}

data "aws_iam_policy_document" "proxy_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "proxy_secrets" {
  statement {
    sid       = "ReadApplicationDatabaseSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app["database_password"].arn]
  }
  statement {
    sid       = "DecryptSecretWithSecretsManager"
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arns["secrets"]]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proxy" {
  count = var.create_proxy ? 1 : 0

  name               = "${var.name_prefix}-rds-proxy-${local.region}"
  assume_role_policy = data.aws_iam_policy_document.proxy_assume.json
}

resource "aws_iam_role_policy" "proxy" {
  count = var.create_proxy ? 1 : 0

  name   = "read-database-secret"
  role   = aws_iam_role.proxy[0].id
  policy = data.aws_iam_policy_document.proxy_secrets.json
}

resource "aws_db_proxy" "this" {
  count = var.create_proxy ? 1 : 0

  name                   = "${var.name_prefix}-proxy"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy[0].arn
  vpc_subnet_ids         = var.proxy_subnet_ids
  vpc_security_group_ids = [aws_security_group.proxy[0].id]
  require_tls            = true
  idle_client_timeout    = 1800
  debug_logging          = false

  auth {
    auth_scheme = "SECRETS"
    description = "Application database role (DATABASE_PASSWORD secret)"
    iam_auth    = var.iam_database_authentication ? "REQUIRED" : "DISABLED"
    secret_arn  = aws_secretsmanager_secret.app["database_password"].arn
  }

  tags = { Name = "${var.name_prefix}-proxy" }

  depends_on = [aws_iam_role_policy.proxy, aws_secretsmanager_secret_version.app]
}

resource "aws_db_proxy_default_target_group" "this" {
  count = var.create_proxy ? 1 : 0

  db_proxy_name = aws_db_proxy.this[0].name

  connection_pool_config {
    max_connections_percent      = 90
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 30
  }
}

resource "aws_db_proxy_target" "this" {
  count = var.create_proxy ? 1 : 0

  db_proxy_name         = aws_db_proxy.this[0].name
  target_group_name     = aws_db_proxy_default_target_group.this[0].name
  db_cluster_identifier = aws_rds_cluster.this.id

  depends_on = [aws_rds_cluster_instance.this]
}

# Read-only endpoint for the heavy dashboards (admin, leadership, freshness).
resource "aws_db_proxy_endpoint" "read_only" {
  count = var.create_proxy ? 1 : 0

  db_proxy_name          = aws_db_proxy.this[0].name
  db_proxy_endpoint_name = "${var.name_prefix}-proxy-ro"
  vpc_subnet_ids         = var.proxy_subnet_ids
  vpc_security_group_ids = [aws_security_group.proxy[0].id]
  target_role            = "READ_ONLY"

  tags = { Name = "${var.name_prefix}-proxy-ro" }
}

# The PostgreSQL log export group is created ahead of the cluster so it is encrypted and has a retention.
resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/cluster/${var.name_prefix}-aurora/postgresql"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arns["logs"]

  tags = { Name = "${var.name_prefix}-aurora-postgresql-logs" }
}

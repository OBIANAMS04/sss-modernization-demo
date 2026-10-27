output "cluster_endpoint" {
  description = "Aurora cluster (writer) endpoint. On the standby cluster it is read-only until promoted."
  value       = aws_rds_cluster.this.endpoint
}

output "cluster_reader_endpoint" {
  description = "Aurora reader endpoint."
  value       = aws_rds_cluster.this.reader_endpoint
}

output "cluster_identifier" {
  description = "Aurora cluster identifier."
  value       = aws_rds_cluster.this.cluster_identifier
}

output "cluster_arn" {
  description = "Aurora cluster ARN."
  value       = aws_rds_cluster.this.arn
}

output "instance_identifiers" {
  description = "Aurora instance identifiers, in promotion order."
  value       = aws_rds_cluster_instance.this[*].identifier
}

output "global_cluster_identifier" {
  description = "Identifier of the Aurora global cluster (primary only; pass it to the standby root)."
  value       = local.primary ? aws_rds_global_cluster.this[0].id : var.global_cluster_identifier
}

output "master_secret_arn" {
  description = "ARN of the RDS-managed master user secret (primary only), used once to create the application role."
  value       = try(aws_rds_cluster.this.master_user_secret[0].secret_arn, null)
}

output "proxy_endpoint" {
  description = "RDS Proxy read/write endpoint (DATABASE_HOST for the API). Falls back to the cluster endpoint without a proxy."
  value       = var.create_proxy ? aws_db_proxy.this[0].endpoint : aws_rds_cluster.this.endpoint
}

output "proxy_read_only_endpoint" {
  description = "RDS Proxy read-only endpoint for the dashboards. Falls back to the reader endpoint without a proxy."
  value       = var.create_proxy ? aws_db_proxy_endpoint.read_only[0].endpoint : aws_rds_cluster.this.reader_endpoint
}

output "proxy_arn" {
  description = "ARN of the RDS Proxy (null without one); used to scope IAM database authentication."
  value       = var.create_proxy ? aws_db_proxy.this[0].arn : null
}

output "database_name" {
  description = "Name of the initial database."
  value       = var.database_name
}

output "app_db_user" {
  description = "Database role the API connects as."
  value       = var.app_db_user
}

output "secret_arns" {
  description = "ARNs of the application secrets by key: jwt_secret, database_password, anthropic_api_key."
  value       = { for k, v in aws_secretsmanager_secret.app : k => v.arn }
}

output "audit_bucket_arn" {
  description = "ARN of the Object Lock audit log bucket."
  value       = aws_s3_bucket.audit.arn
}

output "audit_bucket_name" {
  description = "Name of the Object Lock audit log bucket."
  value       = aws_s3_bucket.audit.id
}

output "audit_kms_key_arn" {
  description = "KMS key of the audit bucket (needed by the other region for replication)."
  value       = var.kms_key_arns["audit"]
}

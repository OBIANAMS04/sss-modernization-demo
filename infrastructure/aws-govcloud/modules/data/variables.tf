variable "name_prefix" {
  description = "Prefix for resource names, for example sss-prod."
  type        = string
}

variable "role" {
  description = "primary: creates the Aurora Global Database and its writer cluster. secondary: joins an existing global cluster as a read-only cluster (the standby region)."
  type        = string

  validation {
    condition     = contains(["primary", "secondary"], var.role)
    error_message = "role must be primary or secondary."
  }
}

variable "vpc_id" {
  description = "ID of the VPC."
  type        = string
}

variable "availability_zones" {
  description = "The three Availability Zones; database instances are spread across them."
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) == 3
    error_message = "Exactly three Availability Zones are expected."
  }
}

variable "data_subnet_ids" {
  description = "Private-data subnet IDs for the Aurora subnet group."
  type        = list(string)
}

variable "proxy_subnet_ids" {
  description = "Private-app subnet IDs for RDS Proxy (it needs a path to Secrets Manager)."
  type        = list(string)
}

variable "client_security_group_ids" {
  description = "Security groups of workloads that may connect to the proxy and the database (the ECS tasks)."
  type        = list(string)
}

variable "kms_key_arns" {
  description = "KMS key ARNs from the security module, by purpose. Needs the keys database, secrets and audit."
  type        = map(string)
}

variable "engine_version" {
  description = "Aurora PostgreSQL engine version. Choose one offered for Aurora Global Database in both GovCloud regions."
  type        = string
  default     = "16.6"
}

variable "instance_class" {
  description = "Aurora instance class. Default is the writer size in docs/PRODUCTION-SIZING.md (4 vCPU, 32 GB; the sizing doc names db.r6g.xlarge)."
  type        = string
  default     = "db.r6g.xlarge"
}

variable "instance_count" {
  description = "Instances in the cluster. In the primary: the writer, a Multi-AZ failover reader and a reader for the admin and leadership dashboards (3). In the standby: at least 1 (warm)."
  type        = number
  default     = 3

  validation {
    condition     = var.instance_count >= 1 && var.instance_count <= 15
    error_message = "instance_count must be between 1 and 15."
  }
}

variable "database_name" {
  description = "Name of the initial database (DATABASE_NAME)."
  type        = string
  default     = "sss"
}

variable "master_username" {
  description = "Aurora master user. Its password is generated and kept by RDS in Secrets Manager (never in code or state)."
  type        = string
  default     = "sss_admin"
}

variable "app_db_user" {
  description = "Database role the API connects as. The operator creates it (runbook step) and stores its password in the DATABASE_PASSWORD secret."
  type        = string
  default     = "sss_app"
}

variable "backup_retention_days" {
  description = "Days of automated backups and point-in-time recovery. FAILOVER.md: RPO 5 minutes from backups."
  type        = number
  default     = 35

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 7 and 35 (the Aurora maximum)."
  }
}

variable "deletion_protection" {
  description = "Block deletion of the cluster. Leave true; teardown in the README turns it off deliberately."
  type        = bool
  default     = true
}

variable "iam_database_authentication" {
  description = "Allow IAM database authentication on the cluster and the proxy (optional). The API as written uses a password, so the default is off."
  type        = bool
  default     = false
}

variable "performance_insights_retention_days" {
  description = "Performance Insights retention: 7, 31, 62, ... (multiples of 31) or 731."
  type        = number
  default     = 31
}

variable "create_proxy" {
  description = "Create RDS Proxy in front of the cluster (docs/PRODUCTION-SIZING.md: a pooler for 10 processes x pool)."
  type        = bool
  default     = true
}

variable "global_cluster_identifier" {
  description = "Standby only: identifier of the global cluster created by the primary root (its output global_cluster_identifier)."
  type        = string
  default     = null
}

variable "source_region" {
  description = "Standby only: the primary region, for example us-gov-west-1."
  type        = string
  default     = null
}

variable "audit_retention_days" {
  description = "Object Lock COMPLIANCE retention of each audit log object, in days. Compliance mode cannot be shortened or removed by anyone, including the root user: confirm the agency's schedule before apply."
  type        = number
  default     = 365

  validation {
    condition     = var.audit_retention_days >= 1
    error_message = "audit_retention_days must be at least 1."
  }
}

variable "audit_replica_bucket_arn" {
  description = "ARN of the audit bucket in the other region (the standby root's output). Empty skips cross-region replication (set it on the second apply, after the standby bucket exists)."
  type        = string
  default     = ""
}

variable "audit_replica_kms_key_arn" {
  description = "ARN of the KMS key of the replica audit bucket. Required when audit_replica_bucket_arn is set."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  description = "Retention in days of the database log groups. Must be a value CloudWatch Logs accepts."
  type        = number
  default     = 365
}

variable "access_log_bucket" {
  description = "Name of the S3 server access log bucket (security module output). Empty turns bucket access logging off."
  type        = string
  default     = ""
}

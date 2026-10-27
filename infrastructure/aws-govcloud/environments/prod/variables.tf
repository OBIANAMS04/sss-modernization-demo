variable "region" {
  description = "GovCloud region of the primary stack."
  type        = string
  default     = "us-gov-west-1"

  validation {
    condition     = contains(["us-gov-west-1", "us-gov-east-1"], var.region)
    error_message = "region must be a GovCloud (US) region."
  }
}

variable "environment" {
  description = "Environment tag and name part."
  type        = string
  default     = "prod"
}

variable "owner" {
  description = "Owner tag: the team or person accountable for this stack."
  type        = string
}

variable "data_classification" {
  description = "DataClassification tag. Production holds registrants' personal data; decide the label with the agency."
  type        = string
  default     = "PII"
}

variable "vpc_cidr" {
  description = "CIDR of the primary VPC. Must not overlap the standby VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "certificate_arn" {
  description = "ACM certificate ARN (aws-us-gov partition, in the primary region) covering app_hostname and api_hostname."
  type        = string
}

variable "app_hostname" {
  description = "Public host name of the web site (for example app.example.gov)."
  type        = string
}

variable "api_hostname" {
  description = "Public host name of the API (for example api.example.gov)."
  type        = string
}

variable "alarm_emails" {
  description = "Emails subscribed to alarms. Keep in an untracked tfvars file."
  type        = set(string)
  default     = []
}

# --- DNS (Route 53 failover) ---------------------------------------------------------------------

variable "manage_dns" {
  description = "Create the Route 53 failover records and health check. Set true once the hosted zone exists in GovCloud and (for the secondary record) the standby stack has been applied."
  type        = bool
  default     = false
}

variable "hosted_zone_id" {
  description = "Route 53 public hosted zone ID (GovCloud) for the site and API host names. Required when manage_dns is true."
  type        = string
  default     = ""
}

variable "standby_alb_dns_name" {
  description = "DNS name of the standby region's load balancer (standby root output alb_dns_name). Empty means no secondary record yet."
  type        = string
  default     = ""
}

variable "standby_alb_zone_id" {
  description = "Hosted zone ID of the standby load balancer (standby root output alb_zone_id)."
  type        = string
  default     = ""
}

# --- Compute sizing (defaults follow docs/PRODUCTION-SIZING.md and docs/FAILOVER.md) --------------

variable "api_cpu" {
  description = "CPU units of one API task (1024 = one vCPU)."
  type        = number
  default     = 1024
}

variable "api_memory" {
  description = "Memory in MiB of one API task."
  type        = number
  default     = 2048
}

variable "api_desired_count" {
  description = "Initial API task count (8 to 10 for 10,000 concurrent users). Use 0 on the first apply, before the secrets are set."
  type        = number
  default     = 10
}

variable "api_min_count" {
  description = "Minimum API tasks (2 per zone). Use 0 on the first apply."
  type        = number
  default     = 6
}

variable "api_max_count" {
  description = "Maximum API tasks."
  type        = number
  default     = 20
}

variable "api_image_tag" {
  description = "API image tag in ECR."
  type        = string
  default     = "release"
}

variable "web_image_tag" {
  description = "Web image tag in ECR."
  type        = string
  default     = "release"
}

variable "extra_environment" {
  description = "Further non-secret environment variables for the API."
  type        = map(string)
  default     = {}
}

# --- Data ----------------------------------------------------------------------------------------

variable "db_instance_class" {
  description = "Aurora instance class."
  type        = string
  default     = "db.r6g.xlarge"
}

variable "db_instance_count" {
  description = "Aurora instances: writer, Multi-AZ failover reader, dashboard reader."
  type        = number
  default     = 3
}

variable "db_engine_version" {
  description = "Aurora PostgreSQL engine version (must support Global Database in both GovCloud regions)."
  type        = string
  default     = "16.6"
}

variable "db_deletion_protection" {
  description = "Deletion protection on the database. Leave true."
  type        = bool
  default     = true
}

variable "audit_retention_days" {
  description = "Object Lock COMPLIANCE retention of audit log objects, in days. Irreversible once objects are written: confirm with the agency."
  type        = number
  default     = 365
}

variable "audit_replica_bucket_arn" {
  description = "ARN of the standby region's audit bucket (standby root output audit_bucket_arn). Set on the second apply to start cross-region replication."
  type        = string
  default     = ""
}

variable "audit_replica_kms_key_arn" {
  description = "ARN of the standby audit bucket's KMS key (standby root output audit_kms_key_arn)."
  type        = string
  default     = ""
}

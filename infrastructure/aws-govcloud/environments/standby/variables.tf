variable "region" {
  description = "GovCloud region of the standby stack."
  type        = string
  default     = "us-gov-east-1"

  validation {
    condition     = contains(["us-gov-west-1", "us-gov-east-1"], var.region)
    error_message = "region must be a GovCloud (US) region."
  }
}

variable "primary_region" {
  description = "Region of the primary stack (source of the Aurora secondary cluster)."
  type        = string
  default     = "us-gov-west-1"
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
  description = "DataClassification tag."
  type        = string
  default     = "PII"
}

variable "vpc_cidr" {
  description = "CIDR of the standby VPC. Must not overlap the primary VPC (10.20.0.0/16)."
  type        = string
  default     = "10.30.0.0/16"
}

variable "certificate_arn" {
  description = "ACM certificate ARN in the standby region covering app_hostname and api_hostname."
  type        = string
}

variable "app_hostname" {
  description = "Public host name of the web site (same as the primary)."
  type        = string
}

variable "api_hostname" {
  description = "Public host name of the API (same as the primary)."
  type        = string
}

variable "alarm_emails" {
  description = "Emails subscribed to alarms. Keep in an untracked tfvars file."
  type        = set(string)
  default     = []
}

variable "global_cluster_identifier" {
  description = "Aurora global cluster identifier: the primary root's output global_cluster_identifier."
  type        = string
}

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
  description = "Initial warm API task count: one per zone. Use 0 until the secrets are set."
  type        = number
  default     = 3
}

variable "api_min_count" {
  description = "Warm minimum API tasks. On failover raise it (and the primary's sizing) to the production minimum of 6."
  type        = number
  default     = 3
}

variable "api_max_count" {
  description = "Maximum API tasks autoscaling may run in the standby (it must be able to carry the full load after failover)."
  type        = number
  default     = 20
}

variable "web_desired_count" {
  description = "Web tasks (one per zone)."
  type        = number
  default     = 3
}

variable "api_image_tag" {
  description = "API image tag in the standby ECR repository (images are pushed to both regions)."
  type        = string
  default     = "release"
}

variable "web_image_tag" {
  description = "Web image tag in the standby ECR repository."
  type        = string
  default     = "release"
}

variable "extra_environment" {
  description = "Further non-secret environment variables for the API (same as the primary)."
  type        = map(string)
  default     = {}
}

variable "db_instance_class" {
  description = "Aurora instance class. Keep the same as the primary so a promoted cluster carries the load."
  type        = string
  default     = "db.r6g.xlarge"
}

variable "db_instance_count" {
  description = "Aurora instances in the secondary cluster (1 is warm; add readers after promotion)."
  type        = number
  default     = 1
}

variable "db_engine_version" {
  description = "Aurora PostgreSQL engine version (same as the primary)."
  type        = string
  default     = "16.6"
}

variable "db_deletion_protection" {
  description = "Deletion protection on the database. Leave true."
  type        = bool
  default     = true
}

variable "audit_retention_days" {
  description = "Object Lock COMPLIANCE retention of the replicated audit objects, in days (same as the primary)."
  type        = number
  default     = 365
}

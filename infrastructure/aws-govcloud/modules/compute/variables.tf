variable "name_prefix" {
  description = "Prefix for resource names, for example sss-prod."
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets for the load balancer (one per zone)."
  type        = list(string)
}

variable "app_subnet_ids" {
  description = "Private-app subnets for the ECS tasks (one per zone)."
  type        = list(string)
}

variable "tasks_security_group_id" {
  description = "Security group of the tasks (created by the network module). This module adds the load balancer ingress."
  type        = string
}

variable "kms_key_arns" {
  description = "KMS key ARNs from the security module. Needs logs, platform, secrets."
  type        = map(string)
}

variable "waf_web_acl_arn" {
  description = "ARN of the regional WAF web ACL to associate with the load balancer."
  type        = string
}

variable "certificate_arn" {
  description = "ARN of the ACM certificate (in this region) for the load balancer. It must cover app_hostname and api_hostname. Request or import it before apply."
  type        = string

  validation {
    condition     = can(regex("^arn:aws-us-gov:acm:[a-z0-9-]+:[0-9]{12}:certificate/.+$", var.certificate_arn))
    error_message = "certificate_arn must be an ACM certificate ARN in the aws-us-gov partition."
  }
}

variable "app_hostname" {
  description = "Public host name of the web site, for example app.example.gov. Also the CORS origin of the API."
  type        = string
}

variable "api_hostname" {
  description = "Public host name of the API, for example api.example.gov."
  type        = string

  validation {
    condition     = var.api_hostname != var.app_hostname
    error_message = "api_hostname and app_hostname must differ (the load balancer routes on the host name)."
  }
}

variable "alb_ingress_cidrs" {
  description = "CIDR blocks allowed to reach the load balancer on 443. The default is the internet; narrow it to the agency's ranges and the Route 53 health checker ranges if the service is not public."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "alb_ssl_policy" {
  description = "TLS policy of the HTTPS listener. TLS 1.2 minimum with TLS 1.3; check the FIPS policies offered in your GovCloud region if FIPS endpoints are required."
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "alb_deletion_protection" {
  description = "Block deletion of the load balancer."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "Retention in days of the ECS log groups. Must be a value CloudWatch Logs accepts."
  type        = number
  default     = 365
}

# --- API service (defaults follow docs/PRODUCTION-SIZING.md) -------------------------------------

variable "api_cpu" {
  description = "CPU units of one API task. 1024 is one vCPU: Node runs JavaScript on one thread per process, so the unit is one process per vCPU."
  type        = number
  default     = 1024

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096], var.api_cpu)
    error_message = "api_cpu must be one of 256, 512, 1024, 2048, 4096."
  }
}

variable "api_memory" {
  description = "Memory in MiB of one API task. 2048 is the Fargate minimum for one vCPU (measured use was 120 to 230 MB per process)."
  type        = number
  default     = 2048
}

variable "api_desired_count" {
  description = "Initial number of API tasks (sizing: 8 to 10 one-vCPU tasks for 10,000 concurrent users). Autoscaling owns the count afterwards. Use 0 for the first apply, until the secrets are set."
  type        = number
  default     = 10

  validation {
    condition     = var.api_desired_count >= 0
    error_message = "api_desired_count cannot be negative."
  }
}

variable "api_min_count" {
  description = "Minimum API tasks. FAILOVER.md: at least 2 per zone in the primary (6); a warm minimum in the standby. Use 0 for the first apply."
  type        = number
  default     = 6

  validation {
    condition     = var.api_min_count >= 0
    error_message = "api_min_count cannot be negative."
  }
}

variable "api_max_count" {
  description = "Maximum API tasks autoscaling may run."
  type        = number
  default     = 20
}

variable "api_cpu_target" {
  description = "Target average CPU percent for autoscaling. The sizing runs at no more than 50% so a spike, a deploy or a lost zone does not tip it over."
  type        = number
  default     = 50
}

variable "api_requests_per_target" {
  description = "Target ALB requests per task per minute for autoscaling (about 100 requests/s per task at the sizing's peak is 6,000)."
  type        = number
  default     = 4500
}

variable "api_image_tag" {
  description = "Tag of the API image in the ECR repository (tags are immutable: use the git commit)."
  type        = string
  default     = "release"
}

variable "database_pool_max" {
  description = "DATABASE_POOL_MAX per API process. Sizing: 10 processes x 8 = 80 connections, behind RDS Proxy."
  type        = number
  default     = 8
}

variable "cpu_architecture" {
  description = "Fargate CPU architecture. X86_64 matches the Dockerfile as built; ARM64 needs a multi-arch image and Fargate Graviton in your GovCloud region."
  type        = string
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "enable_execute_command" {
  description = "Allow ECS Exec into running tasks (for the database administration step). Off by default; turn on only while needed."
  type        = bool
  default     = false
}

variable "extra_environment" {
  description = "Further non-secret environment variables for the API (for example ADMIN_EMAILS, AI_DAILY_LIMIT, OTEL_EXPORTER_OTLP_ENDPOINT)."
  type        = map(string)
  default     = {}
}

# --- Static site service -------------------------------------------------------------------------

variable "web_cpu" {
  description = "CPU units of one web task (the built frontend image)."
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "Memory in MiB of one web task."
  type        = number
  default     = 512
}

variable "web_desired_count" {
  description = "Number of web tasks (one per zone by default)."
  type        = number
  default     = 3
}

variable "web_image_tag" {
  description = "Tag of the web image in the ECR repository."
  type        = string
  default     = "release"
}

# --- From the data module ------------------------------------------------------------------------

variable "database_host" {
  description = "DATABASE_HOST: the RDS Proxy read/write endpoint."
  type        = string
}

variable "database_name" {
  description = "DATABASE_NAME."
  type        = string
}

variable "database_user" {
  description = "Database role the API connects as (used to scope IAM database authentication)."
  type        = string
}

variable "database_proxy_arn" {
  description = "ARN of the RDS Proxy; null when there is none. Only used when iam_database_authentication is true."
  type        = string
  default     = null
}

variable "iam_database_authentication" {
  description = "Give the task role rds-db:connect on the proxy (optional IAM database authentication)."
  type        = bool
  default     = false
}

variable "secret_arns" {
  description = "ARNs of the application secrets by key: jwt_secret, database_password, anthropic_api_key."
  type        = map(string)
}

variable "audit_bucket_arn" {
  description = "ARN of the Object Lock audit bucket the task role may append to."
  type        = string
}

variable "audit_bucket_name" {
  description = "Name of the audit bucket (AUDIT_ARCHIVE_BUCKET)."
  type        = string
}

variable "audit_kms_key_arn" {
  description = "KMS key of the audit bucket."
  type        = string
}

variable "access_log_bucket" {
  description = "Name of the S3 server access log bucket (security module output). Empty turns bucket access logging off."
  type        = string
  default     = ""
}

variable "web_port" {
  description = "Port the static site container listens on. 5173 matches sss-modernization-demo/frontend/Dockerfile (serve -s dist -l 5173)."
  type        = number
  default     = 5173

  validation {
    condition     = var.web_port > 1023 && var.web_port < 65536
    error_message = "web_port must be an unprivileged port (1024 to 65535)."
  }
}

variable "name_prefix" {
  description = "Prefix for resource names, for example sss-prod."
  type        = string
}

variable "platform_kms_key_arn" {
  description = "KMS key (platform) that encrypts the alarm topic."
  type        = string
}

variable "alarm_emails" {
  description = "Email addresses subscribed to the alarm topic. Each must confirm the subscription. Set in an untracked tfvars file."
  type        = set(string)
  default     = []
}

variable "alb_arn_suffix" {
  description = "ARN suffix of the load balancer."
  type        = string
}

variable "api_target_group_arn_suffix" {
  description = "ARN suffix of the API target group."
  type        = string
}

variable "cluster_name" {
  description = "ECS cluster name."
  type        = string
}

variable "api_service_name" {
  description = "ECS service name of the API."
  type        = string
}

variable "db_instance_identifiers" {
  description = "Aurora instance identifiers, in promotion order (the first is the writer in the primary)."
  type        = list(string)
}

variable "min_running_tasks" {
  description = "Alarm when fewer API tasks than this are running (set to the autoscaling minimum)."
  type        = number
  default     = 6
}

variable "error_rate_percent" {
  description = "5xx rate threshold in percent of requests. The app's objective is 99.5% availability, so 0.5."
  type        = number
  default     = 0.5
}

variable "p95_latency_seconds" {
  description = "p95 TargetResponseTime threshold in seconds. The app's objective is p95 under 2 s."
  type        = number
  default     = 2
}

variable "cpu_percent" {
  description = "CPU percent threshold for ECS and Aurora."
  type        = number
  default     = 80
}

variable "db_connections_threshold" {
  description = "DatabaseConnections per instance above which to alarm. With RDS Proxy the sizing expects well under 100 busy connections."
  type        = number
  default     = 500
}

variable "db_free_local_storage_bytes" {
  description = "Alarm when an instance's FreeLocalStorage (temporary tables, sorts, logs) falls below this many bytes. Aurora data storage grows automatically."
  type        = number
  default     = 10737418240
}

variable "replica_lag_ms" {
  description = "Alarm when AuroraReplicaLag exceeds this many milliseconds on a reader (RPO target is under one minute)."
  type        = number
  default     = 5000
}

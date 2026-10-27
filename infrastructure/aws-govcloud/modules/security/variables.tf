variable "name_prefix" {
  description = "Prefix for resource names, for example sss-prod."
  type        = string
}

variable "enable_cloudtrail" {
  description = "Create the multi-region CloudTrail trail and its bucket. True in the primary region only: one multi-region trail already covers the standby region, and a second would duplicate every event."
  type        = bool
  default     = true
}

variable "config_include_global_resources" {
  description = "Record global resource types (IAM) in AWS Config. True in the primary region only, so they are not recorded twice."
  type        = bool
  default     = true
}

variable "securityhub_standards" {
  description = "Security Hub standards to subscribe to, as the path after the standards ARN prefix (for example nist-800-53/v/5.0.0). Confirm each one is offered in GovCloud for your account before apply."
  type        = set(string)
  default = [
    "aws-foundational-security-best-practices/v/1.0.0",
    "nist-800-53/v/5.0.0",
  ]
}

variable "guardduty_features" {
  description = "GuardDuty protection plans to enable (detector feature names). Confirm each is offered in the GovCloud region before apply."
  type        = set(string)
  default     = ["S3_DATA_EVENTS", "EBS_MALWARE_PROTECTION", "RDS_LOGIN_EVENTS"]
}

variable "log_retention_days" {
  description = "Retention in days of the WAF log group. Must be a value CloudWatch Logs accepts."
  type        = number
  default     = 365

  validation {
    condition     = contains([30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "log_retention_days must be a retention value CloudWatch Logs accepts (30 or more)."
  }
}

variable "security_log_expiry_days" {
  description = "Days before CloudTrail and Config objects in S3 expire. Set from the agency's retention schedule (seven years is 2557)."
  type        = number
  default     = 2557

  validation {
    condition     = var.security_log_expiry_days >= 365
    error_message = "security_log_expiry_days must be at least 365."
  }
}

variable "waf_rate_limit" {
  description = "Requests per IP in a 5-minute window before the general rate-based rule blocks. 10,000 users is about 1,000 requests/s overall; shared agency egress addresses need a higher value."
  type        = number
  default     = 3000

  validation {
    condition     = var.waf_rate_limit >= 10 && var.waf_rate_limit <= 20000000
    error_message = "waf_rate_limit must be between 10 and 20,000,000."
  }
}

variable "waf_auth_rate_limit" {
  description = "Requests per IP in a 5-minute window to the sign-in and registration paths (waf_auth_path_prefix) before they are blocked."
  type        = number
  default     = 100

  validation {
    condition     = var.waf_auth_rate_limit >= 10
    error_message = "waf_auth_rate_limit must be at least 10."
  }
}

variable "waf_auth_path_prefix" {
  description = "Path prefix of the authentication routes the tighter rate rule covers."
  type        = string
  default     = "/api/auth/"
}

variable "waf_common_rule_count_only" {
  description = "Rules of AWSManagedRulesCommonRuleSet to set to Count instead of Block, for false positives found in testing (for example SizeRestrictions_BODY if documents are uploaded). Empty means the whole set blocks."
  type        = set(string)
  default     = []
}

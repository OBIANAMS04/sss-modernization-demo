variable "name_prefix" {
  description = "Prefix for resource names, for example sss-prod."
  type        = string
}

variable "vpc_cidr" {
  description = "IPv4 CIDR of the VPC. A /16 is expected: it is split into /20 subnets (public, private-app, private-data) in three Availability Zones."
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && tonumber(split("/", var.vpc_cidr)[1]) <= 18
    error_message = "vpc_cidr must be a valid CIDR with a prefix length of /18 or larger (for example 10.20.0.0/16)."
  }
}

variable "flow_log_retention_days" {
  description = "Days VPC flow logs are kept in CloudWatch Logs. Must be a value CloudWatch accepts."
  type        = number
  default     = 365

  validation {
    condition     = contains([30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.flow_log_retention_days)
    error_message = "flow_log_retention_days must be a retention value CloudWatch Logs accepts (30 or more)."
  }
}

variable "logs_kms_key_arn" {
  description = "ARN of the customer-managed KMS key that encrypts the flow log group."
  type        = string
}

variable "interface_endpoints" {
  description = "Interface VPC endpoints created in the private-app subnets so tasks reach AWS APIs without the NAT gateways (service suffixes)."
  type        = set(string)
  default     = ["ecr.api", "ecr.dkr", "logs", "secretsmanager"]
}

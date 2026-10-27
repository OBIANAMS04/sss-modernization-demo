output "kms_key_arns" {
  description = "ARNs of the customer-managed KMS keys by purpose: logs, database, secrets, audit, platform."
  value       = { for k, v in aws_kms_key.this : k => v.arn }
}

output "waf_web_acl_arn" {
  description = "ARN of the regional WAF web ACL to associate with the load balancer."
  value       = aws_wafv2_web_acl.this.arn
}

output "guardduty_detector_id" {
  description = "ID of the GuardDuty detector."
  value       = aws_guardduty_detector.this.id
}

output "cloudtrail_arn" {
  description = "ARN of the multi-region trail (null in a region where it is not created)."
  value       = var.enable_cloudtrail ? aws_cloudtrail.this[0].arn : null
}

output "config_bucket_name" {
  description = "Name of the AWS Config delivery bucket."
  value       = aws_s3_bucket.config.id
}

output "access_log_bucket_name" {
  description = "Name of the S3 server access log bucket other modules write their bucket logs to."
  value       = aws_s3_bucket.access_logs.id
}

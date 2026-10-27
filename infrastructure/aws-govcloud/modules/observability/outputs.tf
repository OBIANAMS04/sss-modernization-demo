output "alarm_topic_arn" {
  description = "ARN of the SNS topic every alarm publishes to."
  value       = aws_sns_topic.alarms.arn
}

output "dashboard_name" {
  description = "Name of the CloudWatch overview dashboard."
  value       = aws_cloudwatch_dashboard.this.dashboard_name
}

output "alb_dns_name" {
  description = "DNS name of the load balancer (target of the Route 53 alias records and the health check)."
  value       = aws_lb.this.dns_name
}

output "alb_zone_id" {
  description = "Route 53 hosted zone ID of the load balancer, for alias records."
  value       = aws_lb.this.zone_id
}

output "alb_arn_suffix" {
  description = "Load balancer ARN suffix (CloudWatch dimension LoadBalancer)."
  value       = aws_lb.this.arn_suffix
}

output "api_target_group_arn_suffix" {
  description = "API target group ARN suffix (CloudWatch dimension TargetGroup)."
  value       = aws_lb_target_group.api.arn_suffix
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "api_service_name" {
  description = "ECS service name of the API."
  value       = aws_ecs_service.api.name
}

output "web_service_name" {
  description = "ECS service name of the static site."
  value       = aws_ecs_service.web.name
}

output "ecr_repository_urls" {
  description = "ECR repository URLs by name (api, web), where the images are pushed."
  value       = { for k, v in aws_ecr_repository.this : k => v.repository_url }
}

output "task_role_arn" {
  description = "ARN of the API task role."
  value       = aws_iam_role.task.arn
}

output "execution_role_arn" {
  description = "ARN of the ECS execution role."
  value       = aws_iam_role.execution.arn
}

output "api_log_group_name" {
  description = "CloudWatch log group of the API."
  value       = aws_cloudwatch_log_group.api.name
}

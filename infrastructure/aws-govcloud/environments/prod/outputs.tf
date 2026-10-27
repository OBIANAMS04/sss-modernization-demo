output "alb_dns_name" {
  description = "DNS name of the primary load balancer."
  value       = module.compute.alb_dns_name
}

output "alb_zone_id" {
  description = "Hosted zone ID of the primary load balancer."
  value       = module.compute.alb_zone_id
}

output "global_cluster_identifier" {
  description = "Aurora global cluster identifier: pass it to the standby root as global_cluster_identifier."
  value       = module.data.global_cluster_identifier
}

output "master_secret_arn" {
  description = "RDS-managed master user secret, used once to create the application database role."
  value       = module.data.master_secret_arn
}

output "database_endpoint" {
  description = "Aurora cluster writer endpoint (direct)."
  value       = module.data.cluster_endpoint
}

output "proxy_endpoint" {
  description = "RDS Proxy endpoint the API connects through."
  value       = module.data.proxy_endpoint
}

output "secret_arns" {
  description = "ARNs of the three application secrets (values are set by the operator)."
  value       = module.data.secret_arns
}

output "ecr_repository_urls" {
  description = "Where to push the api and web images."
  value       = module.compute.ecr_repository_urls
}

output "audit_bucket_arn" {
  description = "ARN of the Object Lock audit bucket."
  value       = module.data.audit_bucket_arn
}

output "nat_public_ips" {
  description = "Outbound addresses of the NAT gateways."
  value       = module.network.nat_public_ips
}

output "alarm_topic_arn" {
  description = "SNS topic of the alarms."
  value       = module.observability.alarm_topic_arn
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = module.compute.cluster_name
}

output "api_service_name" {
  description = "ECS API service name."
  value       = module.compute.api_service_name
}

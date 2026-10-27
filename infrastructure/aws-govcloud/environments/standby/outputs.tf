output "alb_dns_name" {
  description = "DNS name of the standby load balancer: the primary root's standby_alb_dns_name."
  value       = module.compute.alb_dns_name
}

output "alb_zone_id" {
  description = "Hosted zone ID of the standby load balancer: the primary root's standby_alb_zone_id."
  value       = module.compute.alb_zone_id
}

output "audit_bucket_arn" {
  description = "ARN of the standby audit bucket: the primary root's audit_replica_bucket_arn."
  value       = module.data.audit_bucket_arn
}

output "audit_kms_key_arn" {
  description = "KMS key of the standby audit bucket: the primary root's audit_replica_kms_key_arn."
  value       = module.data.audit_kms_key_arn
}

output "database_cluster_identifier" {
  description = "Identifier of the secondary Aurora cluster (the one to promote on failover)."
  value       = module.data.cluster_identifier
}

output "database_cluster_arn" {
  description = "ARN of the secondary Aurora cluster."
  value       = module.data.cluster_arn
}

output "secret_arns" {
  description = "ARNs of the standby's three application secrets (set to the same values as the primary, JWT_SECRET especially)."
  value       = module.data.secret_arns
}

output "ecr_repository_urls" {
  description = "Where to push the api and web images in the standby region."
  value       = module.compute.ecr_repository_urls
}

output "nat_public_ips" {
  description = "Outbound addresses of the NAT gateways."
  value       = module.network.nat_public_ips
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = module.compute.cluster_name
}

output "api_service_name" {
  description = "ECS API service name."
  value       = module.compute.api_service_name
}

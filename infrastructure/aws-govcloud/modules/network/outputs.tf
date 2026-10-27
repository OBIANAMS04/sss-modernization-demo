output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "CIDR of the VPC."
  value       = aws_vpc.this.cidr_block
}

output "availability_zones" {
  description = "The three Availability Zones used."
  value       = local.azs
}

output "public_subnet_ids" {
  description = "Public subnets (load balancer, NAT gateways), one per zone."
  value       = aws_subnet.public[*].id
}

output "app_subnet_ids" {
  description = "Private-app subnets (ECS tasks, RDS Proxy), one per zone."
  value       = aws_subnet.app[*].id
}

output "data_subnet_ids" {
  description = "Private-data subnets (Aurora), one per zone, no route to the internet."
  value       = aws_subnet.data[*].id
}

output "nat_public_ips" {
  description = "Elastic IPs of the NAT gateways: the addresses outbound calls (for example the AI provider) come from."
  value       = aws_eip.nat[*].public_ip
}

output "flow_log_group_name" {
  description = "Name of the VPC flow log group."
  value       = aws_cloudwatch_log_group.flow.name
}

output "tasks_security_group_id" {
  description = "Security group of the ECS tasks."
  value       = aws_security_group.tasks.id
}

# Network module: one VPC across three Availability Zones with public, private-app and private-data
# subnets, a NAT gateway per zone, VPC flow logs and endpoints for the AWS APIs the tasks call.

data "aws_region" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(sort(data.aws_availability_zones.available.names), 0, 3)
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.name_prefix}-vpc" }
}

# The default security group allows nothing; every workload uses its own group.
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-default-deny" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-igw" }
}

resource "aws_subnet" "public" {
  count = 3

  vpc_id                  = aws_vpc.this.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  map_public_ip_on_launch = false

  tags = { Name = "${var.name_prefix}-public-${local.azs[count.index]}", Tier = "public" }
}

resource "aws_subnet" "app" {
  count = 3

  vpc_id            = aws_vpc.this.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 4)

  tags = { Name = "${var.name_prefix}-app-${local.azs[count.index]}", Tier = "private-app" }
}

resource "aws_subnet" "data" {
  count = 3

  vpc_id            = aws_vpc.this.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 8)

  tags = { Name = "${var.name_prefix}-data-${local.azs[count.index]}", Tier = "private-data" }
}

resource "aws_eip" "nat" {
  count = 3

  domain = "vpc"

  tags = { Name = "${var.name_prefix}-nat-${local.azs[count.index]}" }
}

resource "aws_nat_gateway" "this" {
  count = 3

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags       = { Name = "${var.name_prefix}-nat-${local.azs[count.index]}" }
  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count = 3

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# One route table per zone so a lost NAT gateway only affects its own zone.
resource "aws_route_table" "app" {
  count = 3

  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-app-${local.azs[count.index]}" }
}

resource "aws_route" "app_nat" {
  count = 3

  route_table_id         = aws_route_table.app[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[count.index].id
}

resource "aws_route_table_association" "app" {
  count = 3

  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.app[count.index].id
}

# The data tier has no route to the internet at all.
resource "aws_route_table" "data" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-data" }
}

resource "aws_route_table_association" "data" {
  count = 3

  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}

# --- VPC endpoints -------------------------------------------------------------------------------

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(aws_route_table.app[*].id, [aws_route_table.data.id])

  tags = { Name = "${var.name_prefix}-vpce-s3" }
}

resource "aws_security_group" "endpoints" {
  name_prefix = "${var.name_prefix}-vpce-"
  description = "HTTPS from inside the VPC to the interface endpoints"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTPS from the VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "${var.name_prefix}-vpce" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each = var.interface_endpoints

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.app[*].id
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true

  tags = { Name = "${var.name_prefix}-vpce-${each.value}" }
}

# --- Flow logs -----------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "flow" {
  name              = "/${var.name_prefix}/vpc-flow-logs"
  retention_in_days = var.flow_log_retention_days
  kms_key_id        = var.logs_kms_key_arn

  tags = { Name = "${var.name_prefix}-vpc-flow-logs" }
}

data "aws_iam_policy_document" "flow_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "flow_write" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = [aws_cloudwatch_log_group.flow.arn, "${aws_cloudwatch_log_group.flow.arn}:log-stream:*"]
  }
}

resource "aws_iam_role" "flow" {
  name               = "${var.name_prefix}-vpc-flow-logs"
  assume_role_policy = data.aws_iam_policy_document.flow_assume.json
}

resource "aws_iam_role_policy" "flow" {
  name   = "write-flow-logs"
  role   = aws_iam_role.flow.id
  policy = data.aws_iam_policy_document.flow_write.json
}

resource "aws_flow_log" "this" {
  vpc_id                   = aws_vpc.this.id
  traffic_type             = "ALL"
  log_destination_type     = "cloud-watch-logs"
  log_destination          = aws_cloudwatch_log_group.flow.arn
  iam_role_arn             = aws_iam_role.flow.arn
  max_aggregation_interval = 60

  tags = { Name = "${var.name_prefix}-vpc-flow" }
}

# --- Security group of the application tasks (rules for the load balancer are added in compute) ---

resource "aws_security_group" "tasks" {
  name_prefix = "${var.name_prefix}-tasks-"
  description = "ECS tasks: ingress from the load balancer only (added by the compute module)"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-tasks" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_egress_rule" "tasks_https" {
  security_group_id = aws_security_group.tasks.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS to AWS APIs and the AI provider (through the endpoints and NAT gateways)"
}

resource "aws_vpc_security_group_egress_rule" "tasks_postgres" {
  security_group_id = aws_security_group.tasks.id
  cidr_ipv4         = var.vpc_cidr
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
  description       = "PostgreSQL to RDS Proxy and Aurora inside the VPC"
}

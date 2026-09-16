# ECS Cluster and Services Configuration

# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "${var.app_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${var.app_name}-cluster"
  }
}

# ECS Cluster Capacity Providers
resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "${var.app_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  enable_deletion_protection = true
  enable_http2              = true
  enable_cross_zone_load_balancing = true

  tags = {
    Name = "${var.app_name}-alb"
  }
}

# ALB Target Group for Backend
resource "aws_lb_target_group" "backend" {
  name        = "${var.app_name}-backend-tg"
  port        = var.container_port_backend
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }

  tags = {
    Name = "${var.app_name}-backend-tg"
  }
}

# ALB Target Group for Frontend
resource "aws_lb_target_group" "frontend" {
  name        = "${var.app_name}-frontend-tg"
  port        = var.container_port_frontend
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/"
    matcher             = "200"
  }

  tags = {
    Name = "${var.app_name}-frontend-tg"
  }
}

# ALB HTTP Listener (redirects to HTTPS)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# ALB HTTPS Listener (requires certificate_arn variable)
resource "aws_lb_listener" "https" {
  count             = var.certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# Listener rule for API requests
resource "aws_lb_listener_rule" "backend_api" {
  count            = var.certificate_arn != "" ? 1 : 0
  listener_arn     = aws_lb_listener.https[0].arn
  priority         = 1

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}

# CloudWatch Log Group for ECS
resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${var.app_name}"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${var.app_name}-ecs-logs"
  }
}

# IAM Role for ECS Task Execution
resource "aws_iam_role" "ecs_task_execution_role" {
  name = "${var.app_name}-ecs-task-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Add Secrets Manager permissions for ECS tasks
resource "aws_iam_role_policy" "ecs_secrets" {
  name = "${var.app_name}-ecs-secrets-policy"
  role = aws_iam_role.ecs_task_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.rds_credentials.arn,
          aws_secretsmanager_secret.redis_credentials.arn,
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = "*"
      }
    ]
  })
}

# IAM Role for ECS Task
resource "aws_iam_role" "ecs_task_role" {
  name = "${var.app_name}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

# Add CloudWatch permissions for ECS tasks
resource "aws_iam_role_policy" "ecs_cloudwatch" {
  name = "${var.app_name}-ecs-cloudwatch-policy"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
      }
    ]
  })
}

# CloudWatch Alarms for ALB
resource "aws_cloudwatch_metric_alarm" "alb_target_health" {
  alarm_name          = "${var.app_name}-alb-unhealthy-targets"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 0
  alarm_description   = "Alert when ALB has unhealthy targets"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.backend.arn_suffix
  }
}

# Outputs
output "alb_dns_name" {
  value       = aws_lb.main.dns_name
  description = "ALB DNS name"
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.main.name
  description = "ECS cluster name"
}

output "backend_target_group_arn" {
  value       = aws_lb_target_group.backend.arn
  description = "Backend target group ARN"
}

output "frontend_target_group_arn" {
  value       = aws_lb_target_group.frontend.arn
  description = "Frontend target group ARN"
}

output "ecs_task_execution_role_arn" {
  value       = aws_iam_role.ecs_task_execution_role.arn
  description = "ECS task execution role ARN"
}

output "ecs_task_role_arn" {
  value       = aws_iam_role.ecs_task_role.arn
  description = "ECS task role ARN"
}

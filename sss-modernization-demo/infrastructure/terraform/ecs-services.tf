# ECS Task Definitions and Services

# Backend Task Definition
resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.app_name}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.ecs_task_cpu
  memory                   = var.ecs_task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/${var.app_name}-backend:latest"
      essential = true

      portMappings = [
        {
          containerPort = var.container_port_backend
          hostPort      = var.container_port_backend
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "LOG_LEVEL"
          value = "info"
        },
        {
          name  = "PORT"
          value = tostring(var.container_port_backend)
        },
        {
          name  = "DATABASE_URL"
          value = "postgres://${var.rds_username}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.rds_db_name}"
        },
        {
          name  = "REDIS_URL"
          value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.port}"
        }
      ]

      secrets = [
        {
          name      = "REDIS_PASSWORD"
          valueFrom = "${aws_secretsmanager_secret.redis_credentials.arn}:password::"
        },
        {
          name      = "JWT_SECRET"
          valueFrom = aws_secretsmanager_secret.jwt_secret.arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "backend"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:${var.container_port_backend}/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name = "${var.app_name}-backend-task"
  }
}

# Backend ECS Service
resource "aws_ecs_service" "backend" {
  name            = "${var.app_name}-backend-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.ecs_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = var.container_port_backend
  }

  depends_on = [
    aws_lb_listener.https,
    aws_iam_role_policy.ecs_secrets,
    aws_iam_role_policy.ecs_cloudwatch
  ]

  tags = {
    Name = "${var.app_name}-backend-service"
  }
}

# Frontend Task Definition
resource "aws_ecs_task_definition" "frontend" {
  family                   = "${var.app_name}-frontend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.ecs_task_cpu
  memory                   = var.ecs_task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "frontend"
      image     = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/${var.app_name}-frontend:latest"
      essential = true

      portMappings = [
        {
          containerPort = var.container_port_frontend
          hostPort      = var.container_port_frontend
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "PORT"
          value = tostring(var.container_port_frontend)
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "frontend"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:${var.container_port_frontend}/ || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name = "${var.app_name}-frontend-task"
  }
}

# Frontend ECS Service
resource "aws_ecs_service" "frontend" {
  name            = "${var.app_name}-frontend-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = var.ecs_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.frontend.arn
    container_name   = "frontend"
    container_port   = var.container_port_frontend
  }

  depends_on = [
    aws_lb_listener.https,
    aws_iam_role_policy.ecs_cloudwatch
  ]

  tags = {
    Name = "${var.app_name}-frontend-service"
  }
}

# Auto Scaling Target for Backend
resource "aws_appautoscaling_target" "ecs_backend_target" {
  max_capacity       = 4
  min_capacity       = var.ecs_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Auto Scaling Policy - CPU
resource "aws_appautoscaling_policy" "ecs_policy_cpu_backend" {
  name               = "${var.app_name}-backend-cpu-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_backend_target.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_backend_target.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_backend_target.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70.0
  }
}

# Auto Scaling Policy - Memory
resource "aws_appautoscaling_policy" "ecs_policy_memory_backend" {
  name               = "${var.app_name}-backend-memory-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_backend_target.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_backend_target.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_backend_target.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value = 80.0
  }
}

# Secrets Manager - JWT Secret
resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "${var.app_name}-jwt-secret"
  recovery_window_in_days = 7

  tags = {
    Name = "${var.app_name}-jwt-secret"
  }
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = true
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result
}

# Data source for current AWS account
data "aws_caller_identity" "current" {}

# Outputs
output "backend_service_name" {
  value       = aws_ecs_service.backend.name
  description = "Backend service name"
}

output "frontend_service_name" {
  value       = aws_ecs_service.frontend.name
  description = "Frontend service name"
}

output "jwt_secret_arn" {
  value       = aws_secretsmanager_secret.jwt_secret.arn
  description = "JWT secret ARN"
}

#!/bin/bash

# SSS Modernization Platform - Deployment Script
# Usage: ./deploy.sh [environment] [backend|frontend|all]

set -e

ENVIRONMENT=${1:-prod}
SERVICE=${2:-all}
AWS_REGION=${AWS_REGION:-us-east-1}
APP_NAME="sss-modernization"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== SSS Modernization Platform Deployment ===${NC}"
echo "Environment: $ENVIRONMENT"
echo "Service: $SERVICE"
echo "Region: $AWS_REGION"
echo ""

# Check prerequisites
check_prerequisites() {
  echo -e "${YELLOW}Checking prerequisites...${NC}"

  if ! command -v aws &> /dev/null; then
    echo -e "${RED}AWS CLI not found. Please install AWS CLI.${NC}"
    exit 1
  fi

  if ! command -v terraform &> /dev/null; then
    echo -e "${RED}Terraform not found. Please install Terraform.${NC}"
    exit 1
  fi

  if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker not found. Please install Docker.${NC}"
    exit 1
  fi

  echo -e "${GREEN}All prerequisites satisfied${NC}\n"
}

# Initialize Terraform
init_terraform() {
  echo -e "${YELLOW}Initializing Terraform...${NC}"
  cd infrastructure/terraform
  terraform init
  cd ../..
  echo -e "${GREEN}Terraform initialized${NC}\n"
}

# Validate Terraform
validate_terraform() {
  echo -e "${YELLOW}Validating Terraform configuration...${NC}"
  cd infrastructure/terraform
  terraform validate
  cd ../..
  echo -e "${GREEN}Terraform validation passed${NC}\n"
}

# Plan Terraform
plan_infrastructure() {
  echo -e "${YELLOW}Planning infrastructure changes...${NC}"
  cd infrastructure/terraform
  terraform plan -var-file="${ENVIRONMENT}.tfvars" -out="tfplan_${ENVIRONMENT}"
  cd ../..
  echo -e "${GREEN}Infrastructure plan complete. Review and approve in AWS Console.${NC}\n"
}

# Apply Terraform
apply_infrastructure() {
  echo -e "${YELLOW}Applying infrastructure changes...${NC}"
  cd infrastructure/terraform

  if [ ! -f "tfplan_${ENVIRONMENT}" ]; then
    echo -e "${RED}No plan file found. Run 'plan' first.${NC}"
    exit 1
  fi

  terraform apply "tfplan_${ENVIRONMENT}"
  cd ../..
  echo -e "${GREEN}Infrastructure deployed${NC}\n"
}

# Build Docker images
build_docker_images() {
  local service=$1

  echo -e "${YELLOW}Building Docker images...${NC}"

  if [ "$service" = "backend" ] || [ "$service" = "all" ]; then
    echo "Building backend image..."
    docker build -t "${APP_NAME}-backend:latest" -f backend/Dockerfile backend/
    echo -e "${GREEN}Backend image built${NC}"
  fi

  if [ "$service" = "frontend" ] || [ "$service" = "all" ]; then
    echo "Building frontend image..."
    docker build -t "${APP_NAME}-frontend:latest" -f frontend/Dockerfile frontend/
    echo -e "${GREEN}Frontend image built${NC}"
  fi

  echo ""
}

# Push Docker images to ECR
push_docker_images() {
  local service=$1
  local account_id=$(aws sts get-caller-identity --query Account --output text)
  local registry="${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com"

  echo -e "${YELLOW}Pushing images to ECR...${NC}"

  # Login to ECR
  aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${registry}"

  if [ "$service" = "backend" ] || [ "$service" = "all" ]; then
    echo "Pushing backend image..."
    docker tag "${APP_NAME}-backend:latest" "${registry}/${APP_NAME}-backend:latest"
    docker push "${registry}/${APP_NAME}-backend:latest"
    echo -e "${GREEN}Backend image pushed${NC}"
  fi

  if [ "$service" = "frontend" ] || [ "$service" = "all" ]; then
    echo "Pushing frontend image..."
    docker tag "${APP_NAME}-frontend:latest" "${registry}/${APP_NAME}-frontend:latest"
    docker push "${registry}/${APP_NAME}-frontend:latest"
    echo -e "${GREEN}Frontend image pushed${NC}"
  fi

  echo ""
}

# Deploy ECS services
deploy_ecs_services() {
  local service=$1
  local cluster_name="${APP_NAME}-cluster"

  echo -e "${YELLOW}Deploying ECS services...${NC}"

  if [ "$service" = "backend" ] || [ "$service" = "all" ]; then
    echo "Updating backend service..."
    aws ecs update-service \
      --cluster "${cluster_name}" \
      --service "${APP_NAME}-backend-service" \
      --region "${AWS_REGION}" \
      --force-new-deployment
    echo -e "${GREEN}Backend service updated${NC}"
  fi

  if [ "$service" = "frontend" ] || [ "$service" = "all" ]; then
    echo "Updating frontend service..."
    aws ecs update-service \
      --cluster "${cluster_name}" \
      --service "${APP_NAME}-frontend-service" \
      --region "${AWS_REGION}" \
      --force-new-deployment
    echo -e "${GREEN}Frontend service updated${NC}"
  fi

  echo ""
}

# Wait for services to be ready
wait_for_services() {
  local service=$1
  local cluster_name="${APP_NAME}-cluster"
  local timeout=600 # 10 minutes
  local elapsed=0

  echo -e "${YELLOW}Waiting for services to be stable...${NC}"

  while [ $elapsed -lt $timeout ]; do
    local status=$(aws ecs describe-services \
      --cluster "${cluster_name}" \
      --services "${APP_NAME}-${service}-service" \
      --region "${AWS_REGION}" \
      --query 'services[0].deployments[0].runningCount' \
      --output text)

    if [ "$status" == "$(echo "$service" | awk '{print var}' var=2)" ]; then
      echo -e "${GREEN}Service is stable with all tasks running${NC}\n"
      return 0
    fi

    echo "Waiting... ($status/2 tasks running)"
    sleep 10
    elapsed=$((elapsed + 10))
  done

  echo -e "${RED}Timeout waiting for service to be stable${NC}"
  exit 1
}

# Run health checks
health_check() {
  echo -e "${YELLOW}Running health checks...${NC}"

  local alb_dns=$(aws elbv2 describe-load-balancers \
    --names "${APP_NAME}-alb" \
    --region "${AWS_REGION}" \
    --query 'LoadBalancers[0].DNSName' \
    --output text)

  echo "ALB DNS: ${alb_dns}"

  # Check backend health
  echo "Checking backend health..."
  if curl -f "http://${alb_dns}/api/health" > /dev/null 2>&1; then
    echo -e "${GREEN}Backend health check passed${NC}"
  else
    echo -e "${YELLOW}Backend health check failed (may still be initializing)${NC}"
  fi

  # Check frontend health
  echo "Checking frontend health..."
  if curl -f "http://${alb_dns}/" > /dev/null 2>&1; then
    echo -e "${GREEN}Frontend health check passed${NC}"
  else
    echo -e "${YELLOW}Frontend health check failed (may still be initializing)${NC}"
  fi

  echo ""
}

# Main execution
main() {
  check_prerequisites
  init_terraform
  validate_terraform

  case "${SERVICE}" in
    backend|frontend|all)
      plan_infrastructure
      read -p "Do you want to apply these changes? (yes/no): " -r REPLY
      if [[ $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        apply_infrastructure
        build_docker_images "${SERVICE}"
        push_docker_images "${SERVICE}"
        deploy_ecs_services "${SERVICE}"
        wait_for_services "${SERVICE}"
        health_check
        echo -e "${GREEN}=== Deployment Complete ===${NC}"
      else
        echo "Deployment cancelled"
      fi
      ;;
    *)
      echo -e "${RED}Invalid service. Use: backend|frontend|all${NC}"
      exit 1
      ;;
  esac
}

main

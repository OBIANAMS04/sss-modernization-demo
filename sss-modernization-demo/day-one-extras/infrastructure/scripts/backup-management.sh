#!/bin/bash

# SSS Modernization Platform - Backup Management Script
# Handles automated backup creation, rotation, and restoration

set -e

ENVIRONMENT=${1:-prod}
ACTION=${2:-status}  # status, create, list, restore, cleanup, verify
AWS_REGION=${AWS_REGION:-us-east-1}
APP_NAME="sss-modernization"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ===== CONFIGURATION =====
BACKUP_RETENTION_DAYS=30
S3_BACKUP_BUCKET="${APP_NAME}-backups-${ENVIRONMENT}"
BACKUP_TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# ===== LOGGING =====
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

# ===== SECTION 1: RDS Backup Management =====

# Create RDS snapshot
create_rds_snapshot() {
  log_info "Creating RDS snapshot..."

  local snapshot_id="${APP_NAME}-db-${BACKUP_TIMESTAMP}"

  aws rds create-db-snapshot \
    --db-instance-identifier ${APP_NAME}-db \
    --db-snapshot-identifier $snapshot_id \
    --region $AWS_REGION

  log_success "RDS snapshot created: $snapshot_id"

  # Wait for snapshot completion
  log_info "Waiting for snapshot to complete..."
  aws rds wait db-snapshot-available \
    --db-snapshot-identifier $snapshot_id \
    --region $AWS_REGION

  log_success "RDS snapshot completed"

  # Get snapshot size and status
  local snapshot_info=$(aws rds describe-db-snapshots \
    --db-snapshot-identifier $snapshot_id \
    --region $AWS_REGION \
    --query 'DBSnapshots[0].[AllocatedStorage, SnapshotCreateTime]' \
    --output text)

  echo "$snapshot_info"
}

# List RDS snapshots
list_rds_snapshots() {
  log_info "RDS Snapshots for $APP_NAME:"
  echo ""

  aws rds describe-db-snapshots \
    --db-instance-identifier ${APP_NAME}-db \
    --region $AWS_REGION \
    --query 'DBSnapshots[*].[DBSnapshotIdentifier, SnapshotCreateTime, AllocatedStorage, Status]' \
    --output table
  echo ""
}

# Restore from RDS snapshot
restore_rds_snapshot() {
  local snapshot_id=$1
  local target_instance="${APP_NAME}-db-restored-${BACKUP_TIMESTAMP}"

  if [ -z "$snapshot_id" ]; then
    log_error "Snapshot ID required"
    return 1
  fi

  log_info "Restoring RDS instance from snapshot: $snapshot_id"

  aws rds restore-db-instance-from-db-snapshot \
    --db-instance-identifier $target_instance \
    --db-snapshot-identifier $snapshot_id \
    --db-instance-class db.t3.micro \
    --no-publicly-accessible \
    --region $AWS_REGION

  log_success "Restore initiated: $target_instance"

  # Wait for restore completion
  log_info "Waiting for restore to complete (this may take 5-10 minutes)..."
  aws rds wait db-instance-available \
    --db-instance-identifier $target_instance \
    --region $AWS_REGION

  log_success "Restore completed: $target_instance"
}

# Cleanup old RDS snapshots
cleanup_old_snapshots() {
  log_info "Cleaning up RDS snapshots older than $BACKUP_RETENTION_DAYS days..."

  local cutoff_date=$(date -d "$BACKUP_RETENTION_DAYS days ago" +%Y-%m-%d)

  local snapshots=$(aws rds describe-db-snapshots \
    --db-instance-identifier ${APP_NAME}-db \
    --region $AWS_REGION \
    --query "DBSnapshots[?SnapshotCreateTime<='${cutoff_date}'].DBSnapshotIdentifier" \
    --output text)

  if [ -z "$snapshots" ]; then
    log_success "No snapshots to clean up"
    return 0
  fi

  for snapshot in $snapshots; do
    log_info "Deleting snapshot: $snapshot"
    aws rds delete-db-snapshot \
      --db-snapshot-identifier $snapshot \
      --region $AWS_REGION
    log_success "Deleted: $snapshot"
  done
}

# ===== SECTION 2: S3 Backup (for exported data) =====

# Export RDS data to S3
export_database_to_s3() {
  log_info "Exporting database to S3..."

  # Create S3 bucket if needed
  if ! aws s3 ls "s3://$S3_BACKUP_BUCKET" 2>/dev/null; then
    log_info "Creating S3 bucket: $S3_BACKUP_BUCKET"
    aws s3 mb "s3://$S3_BACKUP_BUCKET" \
      --region $AWS_REGION
  fi

  # Export to CSV
  local db_host=$(aws rds describe-db-instances \
    --db-instance-identifier ${APP_NAME}-db \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text)

  log_info "Exporting tables to CSV..."

  # Create export file
  local export_file="/tmp/${APP_NAME}-export-${BACKUP_TIMESTAMP}.sql"

  PGPASSWORD=${POSTGRES_PASSWORD:-password} pg_dump \
    -h $db_host \
    -U postgres \
    -d sssdb \
    --format=plain \
    > $export_file

  # Compress
  gzip -f $export_file

  # Upload to S3
  local s3_path="s3://$S3_BACKUP_BUCKET/exports/${BACKUP_TIMESTAMP}/backup.sql.gz"

  aws s3 cp "${export_file}.gz" "$s3_path" \
    --storage-class GLACIER

  log_success "Database exported to S3: $s3_path"

  # Cleanup local file
  rm -f "${export_file}.gz"
}

# ===== SECTION 3: Backup Verification =====

# Verify RDS backup integrity
verify_rds_backup() {
  local snapshot_id=$1

  if [ -z "$snapshot_id" ]; then
    log_error "Snapshot ID required"
    return 1
  fi

  log_info "Verifying RDS backup: $snapshot_id..."

  # Check snapshot exists and is complete
  local snapshot=$(aws rds describe-db-snapshots \
    --db-snapshot-identifier $snapshot_id \
    --region $AWS_REGION \
    --query 'DBSnapshots[0]' \
    --output json)

  local status=$(echo $snapshot | jq -r '.Status')
  local size=$(echo $snapshot | jq -r '.AllocatedStorage')

  if [ "$status" != "available" ]; then
    log_error "Snapshot status: $status (expected: available)"
    return 1
  fi

  log_success "Snapshot is available"
  log_info "Snapshot size: ${size}GB"

  # Try restore to test snapshot (optional - can be disabled for production)
  # log_info "Testing snapshot restore..."
  # local test_instance="${APP_NAME}-db-test-${BACKUP_TIMESTAMP}"
  # aws rds restore-db-instance-from-db-snapshot \
  #   --db-instance-identifier $test_instance \
  #   --db-snapshot-identifier $snapshot_id \
  #   --db-instance-class db.t3.micro

  # log_success "Snapshot verified successfully"
}

# Verify database connectivity
verify_database_connectivity() {
  log_info "Verifying database connectivity..."

  local db_host=$(aws rds describe-db-instances \
    --db-instance-identifier ${APP_NAME}-db \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text)

  local db_port=$(aws rds describe-db-instances \
    --db-instance-identifier ${APP_NAME}-db \
    --query 'DBInstances[0].Endpoint.Port' \
    --output text)

  if timeout 5 bash -c "echo > /dev/tcp/$db_host/$db_port" 2>/dev/null; then
    log_success "Database is accessible at $db_host:$db_port"
  else
    log_error "Cannot connect to database at $db_host:$db_port"
    return 1
  fi

  # Test query
  PGPASSWORD=${POSTGRES_PASSWORD:-password} psql \
    -h $db_host \
    -U postgres \
    -d sssdb \
    -c "SELECT COUNT(*) as user_count FROM users;" 2>/dev/null

  log_success "Database query successful"
}

# ===== SECTION 4: Backup Monitoring =====

# Get backup status and metrics
backup_status() {
  echo -e "${BLUE}=== Backup Status Report ===${NC}\n"

  # RDS Backup Status
  echo -e "${YELLOW}RDS Database Backups:${NC}"
  local latest_snapshot=$(aws rds describe-db-snapshots \
    --db-instance-identifier ${APP_NAME}-db \
    --region $AWS_REGION \
    --query 'DBSnapshots[0]' \
    --output json)

  if [ ! -z "$latest_snapshot" ]; then
    local snapshot_id=$(echo $latest_snapshot | jq -r '.DBSnapshotIdentifier')
    local create_time=$(echo $latest_snapshot | jq -r '.SnapshotCreateTime')
    local status=$(echo $latest_snapshot | jq -r '.Status')
    local size=$(echo $latest_snapshot | jq -r '.AllocatedStorage')

    echo "  Latest Snapshot: $snapshot_id"
    echo "  Status: $status"
    echo "  Size: ${size}GB"
    echo "  Created: $create_time"

    # Calculate age
    local create_epoch=$(date -d "$create_time" +%s)
    local now_epoch=$(date +%s)
    local age_seconds=$((now_epoch - create_epoch))
    local age_hours=$((age_seconds / 3600))
    local age_days=$((age_hours / 24))

    echo "  Age: ${age_days}d ${age_hours}h"
  fi
  echo ""

  # S3 Backup Status
  echo -e "${YELLOW}S3 Exports:${NC}"
  local s3_count=$(aws s3 ls "s3://$S3_BACKUP_BUCKET/exports/" --recursive | wc -l)
  echo "  Total exports: $s3_count"

  # Show recent exports
  if [ $s3_count -gt 0 ]; then
    echo "  Recent exports:"
    aws s3 ls "s3://$S3_BACKUP_BUCKET/exports/" --recursive | \
      sort | tail -5 | awk '{print "    " $0}'
  fi
  echo ""

  # Database Connectivity
  echo -e "${YELLOW}Database Status:${NC}"
  verify_database_connectivity
  echo ""

  # Backup Configuration
  echo -e "${YELLOW}Backup Configuration:${NC}"
  echo "  Retention: $BACKUP_RETENTION_DAYS days"
  echo "  Backup Bucket: $S3_BACKUP_BUCKET"
  echo "  Environment: $ENVIRONMENT"
  echo "  Region: $AWS_REGION"
}

# ===== SECTION 5: Automated Backup Scheduling =====

# Create CloudWatch rule for automated backups
setup_automated_backups() {
  log_info "Setting up automated daily backups..."

  # Create Lambda function (template)
  cat > /tmp/backup-lambda.py << 'EOF'
import boto3
import json
from datetime import datetime

rds = boto3.client('rds')

def lambda_handler(event, context):
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    snapshot_id = f"sss-modernization-db-{timestamp}"

    response = rds.create_db_snapshot(
        DBInstanceIdentifier='sss-modernization-db',
        DBSnapshotIdentifier=snapshot_id
    )

    return {
        'statusCode': 200,
        'body': json.dumps(f'Snapshot created: {snapshot_id}')
    }
EOF

  log_success "Lambda function template created: /tmp/backup-lambda.py"

  # Create EventBridge rule (manual creation for now)
  log_info "Run this to create EventBridge rule:"
  echo "aws events put-rule --name ${APP_NAME}-daily-backup --schedule-expression 'cron(0 2 * * ? *)'"
}

# ===== MAIN EXECUTION =====

main() {
  case $ACTION in
    status)
      backup_status
      ;;
    create)
      create_rds_snapshot
      export_database_to_s3
      log_success "Backup completed"
      ;;
    list)
      list_rds_snapshots
      ;;
    restore)
      local snapshot_id=$3
      if [ -z "$snapshot_id" ]; then
        log_error "Usage: $0 $ENVIRONMENT restore <snapshot-id>"
        exit 1
      fi
      restore_rds_snapshot $snapshot_id
      ;;
    verify)
      local snapshot_id=$3
      if [ -z "$snapshot_id" ]; then
        # Verify latest
        snapshot_id=$(aws rds describe-db-snapshots \
          --db-instance-identifier ${APP_NAME}-db \
          --query 'DBSnapshots[0].DBSnapshotIdentifier' \
          --output text)
      fi
      verify_rds_backup $snapshot_id
      ;;
    cleanup)
      cleanup_old_snapshots
      ;;
    setup-automation)
      setup_automated_backups
      ;;
    *)
      echo "Usage: $0 $ENVIRONMENT {status|create|list|restore|verify|cleanup|setup-automation}"
      exit 1
      ;;
  esac
}

main

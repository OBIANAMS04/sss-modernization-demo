# Primary stack, us-gov-west-1. Module order: network, security, data, compute, observability.

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project            = "sss-modernization"
      Environment        = var.environment
      Owner              = var.owner
      DataClassification = var.data_classification
      ManagedBy          = "terraform"
      Role               = "primary"
    }
  }
}

locals {
  name_prefix = "sss-${var.environment}"
}

module "security" {
  source = "../../modules/security"

  name_prefix                     = local.name_prefix
  enable_cloudtrail               = true
  config_include_global_resources = true
}

module "network" {
  source = "../../modules/network"

  name_prefix      = local.name_prefix
  vpc_cidr         = var.vpc_cidr
  logs_kms_key_arn = module.security.kms_key_arns["logs"]
}

module "data" {
  source = "../../modules/data"

  name_prefix               = local.name_prefix
  role                      = "primary"
  vpc_id                    = module.network.vpc_id
  availability_zones        = module.network.availability_zones
  data_subnet_ids           = module.network.data_subnet_ids
  proxy_subnet_ids          = module.network.app_subnet_ids
  client_security_group_ids = [module.network.tasks_security_group_id]
  kms_key_arns              = module.security.kms_key_arns
  access_log_bucket         = module.security.access_log_bucket_name
  engine_version            = var.db_engine_version
  instance_class            = var.db_instance_class
  instance_count            = var.db_instance_count
  deletion_protection       = var.db_deletion_protection
  audit_retention_days      = var.audit_retention_days
  audit_replica_bucket_arn  = var.audit_replica_bucket_arn
  audit_replica_kms_key_arn = var.audit_replica_kms_key_arn
}

module "compute" {
  source = "../../modules/compute"

  name_prefix             = local.name_prefix
  vpc_id                  = module.network.vpc_id
  public_subnet_ids       = module.network.public_subnet_ids
  app_subnet_ids          = module.network.app_subnet_ids
  tasks_security_group_id = module.network.tasks_security_group_id
  kms_key_arns            = module.security.kms_key_arns
  access_log_bucket       = module.security.access_log_bucket_name
  waf_web_acl_arn         = module.security.waf_web_acl_arn
  certificate_arn         = var.certificate_arn
  app_hostname            = var.app_hostname
  api_hostname            = var.api_hostname

  api_cpu           = var.api_cpu
  api_memory        = var.api_memory
  api_desired_count = var.api_desired_count
  api_min_count     = var.api_min_count
  api_max_count     = var.api_max_count
  api_image_tag     = var.api_image_tag
  web_image_tag     = var.web_image_tag
  extra_environment = var.extra_environment

  database_host               = module.data.proxy_endpoint
  database_name               = module.data.database_name
  database_user               = module.data.app_db_user
  database_proxy_arn          = module.data.proxy_arn
  iam_database_authentication = false
  secret_arns                 = module.data.secret_arns
  audit_bucket_arn            = module.data.audit_bucket_arn
  audit_bucket_name           = module.data.audit_bucket_name
  audit_kms_key_arn           = module.data.audit_kms_key_arn
}

module "observability" {
  source = "../../modules/observability"

  name_prefix                 = local.name_prefix
  platform_kms_key_arn        = module.security.kms_key_arns["platform"]
  alarm_emails                = var.alarm_emails
  alb_arn_suffix              = module.compute.alb_arn_suffix
  api_target_group_arn_suffix = module.compute.api_target_group_arn_suffix
  cluster_name                = module.compute.cluster_name
  api_service_name            = module.compute.api_service_name
  db_instance_identifiers     = module.data.instance_identifiers
  min_running_tasks           = var.api_min_count
}

# Route 53 failover records (FAILOVER.md, layer "DNS"). A health check on the primary load balancer's
# /health, which reports the database: 30 s interval, 3 failures. The secondary record points at
# the standby region's load balancer and is created once its address is known.
# Route 53 public hosted zones are supported in GovCloud; the zone is created by hand (README).

locals {
  dns_hosts = var.manage_dns ? {
    api = var.api_hostname
    web = var.app_hostname
  } : {}
  dns_secondary = var.manage_dns && var.standby_alb_dns_name != "" ? local.dns_hosts : {}
}

resource "aws_route53_health_check" "primary" {
  count = var.manage_dns ? 1 : 0

  type              = "HTTPS_STR_MATCH"
  fqdn              = module.compute.alb_dns_name
  port              = 443
  resource_path     = "/health"
  search_string     = "\"database\":\"ok\""
  request_interval  = 30
  failure_threshold = 3
  measure_latency   = true

  tags = { Name = "${local.name_prefix}-primary-health" }
}

resource "aws_route53_record" "primary" {
  for_each = local.dns_hosts

  zone_id         = var.hosted_zone_id
  name            = each.value
  type            = "A"
  set_identifier  = "primary"
  health_check_id = aws_route53_health_check.primary[0].id

  failover_routing_policy {
    type = "PRIMARY"
  }

  alias {
    name                   = module.compute.alb_dns_name
    zone_id                = module.compute.alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "secondary" {
  for_each = local.dns_secondary

  zone_id        = var.hosted_zone_id
  name           = each.value
  type           = "A"
  set_identifier = "secondary"

  failover_routing_policy {
    type = "SECONDARY"
  }

  alias {
    name                   = var.standby_alb_dns_name
    zone_id                = var.standby_alb_zone_id
    evaluate_target_health = true
  }
}

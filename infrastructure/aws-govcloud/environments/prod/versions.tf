terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.100.0"
    }
  }

  # Remote state in S3 with a DynamoDB lock table. The values are not here: pass them at init with
  #   terraform init -backend-config=backend.hcl
  # (copy backend.hcl.example to backend.hcl, which is not committed).
  backend "s3" {}
}

#!/usr/bin/env bash
# Static checks for infrastructure/aws-govcloud. Never plans, applies or calls AWS.
#   TERRAFORM=/path/to/terraform TFLINT=/path/to/tflint TFSEC=/path/to/tfsec ./checks/run-checks.sh
# Output goes to checks/*.txt. Needs network access only to download the provider on `init`.
# If your machine intercepts loopback TLS (the plugin handshake fails with "x509: certificate signed by
# unknown authority"), start the provider by hand with `terraform-provider-aws_v5.100.0_x5 -debug` and
# export the TF_REATTACH_PROVIDERS line it prints; validate then runs without the TLS handshake.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/checks"
TERRAFORM="${TERRAFORM:-terraform}"
TFLINT="${TFLINT:-tflint}"
TFSEC="${TFSEC:-tfsec}"
cd "$ROOT" || exit 1

{
  "$TERRAFORM" version
  echo "--- terraform fmt -check -recursive"
  "$TERRAFORM" fmt -check -recursive -diff
  echo "fmt exit code: $?"
} > "$OUT/terraform-fmt.txt" 2>&1

for env in prod standby; do
  {
    "$TERRAFORM" version | head -2
    (
      cd "$ROOT/environments/$env" || exit 1
      echo "--- terraform init -backend=false ($env)"
      "$TERRAFORM" init -backend=false -input=false -no-color
      echo "--- terraform validate ($env)"
      "$TERRAFORM" validate -no-color
      echo "validate exit code: $?"
    )
  } >"$OUT/terraform-validate-$env.txt" 2>&1
done

{
  "$TFLINT" --version
  echo "--- tflint --recursive (terraform recommended + aws ruleset)"
  "$TFLINT" --recursive --format compact
  echo "tflint exit code: $?"
} > "$OUT/tflint.txt" 2>&1

for env in prod standby; do
  "$TFSEC" "environments/$env" --no-colour --concise-output > "$OUT/tfsec-$env.txt" 2>&1
  echo "tfsec exit code: $?" >> "$OUT/tfsec-$env.txt"
done
echo "done; see $OUT"

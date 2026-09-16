# Open Policy Agent (OPA) rules for API governance
# Enforces role-based access control (RBAC) and attribute-based access control (ABAC)

package api.governance

# Default deny policy (fail-secure)
default allow = false

# RBAC: Role-based access rules
allow {
    input.user.role == "admin"
}

# Citizens can only read their own exemptions
allow {
    input.user.role == "citizen"
    input.method == "GET"
    input.path == concat("/", ["exemptions", input.user.id])
}

# Citizens can create their own cases
allow {
    input.user.role == "citizen"
    input.method == "POST"
    input.path == "/cases"
    input.body.citizen_id == input.user.id
}

# Citizens can read their own cases
allow {
    input.user.role == "citizen"
    input.method == "GET"
    startswith(input.path, "/cases/")
    # Extract case ID from path
    case_id := split(input.path, "/")[2]
    # Verify case belongs to citizen
    data.cases[case_id].citizen_id == input.user.id
}

# Case managers can read and update cases
allow {
    input.user.role == "case_manager"
    input.method == "GET"
    startswith(input.path, "/cases")
}

allow {
    input.user.role == "case_manager"
    input.method == "PATCH"
    startswith(input.path, "/cases")
}

# Case managers can create case notes
allow {
    input.user.role == "case_manager"
    input.method == "POST"
    startswith(input.path, "/cases")
    endswith(input.path, "/notes")
}

# Case managers can read audit logs for cases they manage
allow {
    input.user.role == "case_manager"
    input.method == "GET"
    input.path == "/audit"
}

# Leadership can read all analytics and reports
allow {
    input.user.role == "leadership"
    input.method == "GET"
    startswith(input.path, "/metrics")
}

allow {
    input.user.role == "leadership"
    input.method == "GET"
    startswith(input.path, "/reports")
}

# Admins can read audit logs
allow {
    input.user.role == "admin"
    input.method == "GET"
    input.path == "/audit"
}

# Compliance checks require authentication
allow {
    input.user.authenticated == true
    input.method == "GET"
    input.path == "/compliance/matrix"
}

# MFA-protected operations (security override)
allow {
    input.user.authenticated == true
    input.user.mfa_verified == true
    input.method == "POST"
    input.path == "/admin/override"
}

allow {
    input.user.authenticated == true
    input.user.mfa_verified == true
    input.method == "DELETE"
    startswith(input.path, "/users")
}

# Rate limiting rules (ABAC)
rate_limit {
    input.user.role == "citizen"
    max_requests_per_minute := 60
}

rate_limit {
    input.user.role == "case_manager"
    max_requests_per_minute := 300
}

rate_limit {
    input.user.role == "admin"
    max_requests_per_minute := 1000
}

# Data classification rules
data_classification := {
    "ssn": "pii",
    "password": "secret",
    "mfa_secret": "secret",
    "bank_account": "pii",
    "medical_history": "pii",
}

# Sensitive data access requires elevated privileges
sensitive_data_access_allowed {
    input.user.role == "admin"
}

sensitive_data_access_allowed {
    input.user.role == "case_manager"
    input.accessing_resource == "cases"
}

# Audit trail requirements
audit_required {
    input.method == "DELETE"
}

audit_required {
    input.method == "POST"
    startswith(input.path, "/admin")
}

audit_required {
    input.method == "PATCH"
    input.path == concat("/", ["users", input.user.id])
}

# API versioning policy
api_version_supported {
    version := split(input.path, "/")[1]
    version == "v1"
}

# Error response masks sensitive information
mask_sensitive_fields {
    input.user.role != "admin"
}

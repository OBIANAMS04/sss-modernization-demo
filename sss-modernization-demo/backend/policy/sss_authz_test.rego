# STORY-016: tests for sss_authz.rego. Run by `node scripts/opa/build.mjs` (or `opa test -v` on both files).
#
# The routes and rules below are a small copy of what the backend sends as data.routes and data.rules by default; the jest tests
# (policyEngine.test.ts) check the same cases against the real defaults and the compiled policy.
package sss.authz_test

import rego.v1

import data.sss.authz

signed_in := ["citizen", "case_manager", "leadership", "admin"]

staff := ["case_manager", "admin"]

routes := {
	"GET /health": {"roles": array.concat(["anonymous"], signed_in), "resource": null},
	"GET /api/dashboards/citizen": {"roles": signed_in, "resource": null},
	"GET /api/cases/stats": {"roles": staff, "resource": null},
	"GET /api/dashboards/admin": {"roles": ["admin"], "resource": null},
	"GET /api/dashboards/leadership": {"roles": ["leadership", "admin"], "resource": null},
	"GET /api/ai-quality": {"roles": staff, "resource": null},
	"POST /api/ai-quality/evaluations": {"roles": ["admin"], "resource": null},
	"GET /api/cases/:id": {"roles": signed_in, "resource": "case"},
	"POST /api/cases/:id/status": {"roles": signed_in, "resource": "case"},
	"PUT /api/cases/:id/assignment": {"roles": staff, "resource": "case"},
	"GET /api/users/:id": {"roles": signed_in, "resource": "account"},
	"GET /api/audit/user/:userId": {"roles": signed_in, "resource": "audit_trail"},
}

# The default rules, in the order the backend lists them
default_rules := [
	{"id": "case-applicant", "description": "People can view and act on their own applications", "resource": "case", "roles": signed_in, "actions": ["read", "write"], "when": "owner", "enabled": true},
	{"id": "case-manager-assigned", "description": "Case managers can view and work cases assigned to them", "resource": "case", "roles": ["case_manager"], "actions": ["read", "write"], "when": "assignee", "enabled": true},
	{"id": "case-manager-queue", "description": "Case managers can view and pick up unassigned cases", "resource": "case", "roles": ["case_manager"], "actions": ["read", "write"], "when": "unassigned", "enabled": true},
	{"id": "case-manager-review", "description": "Case managers can view cases waiting for a second-person compliance review", "resource": "case", "roles": ["case_manager"], "actions": ["read"], "when": "under_review", "enabled": true},
	{"id": "case-manager-team", "description": "Case managers can view and work every case (team visibility)", "resource": "case", "roles": ["case_manager"], "actions": ["read", "write"], "when": "any", "enabled": true},
	{"id": "case-admin", "description": "Administrators can view and work every case", "resource": "case", "roles": ["admin"], "actions": ["read", "write"], "when": "any", "enabled": true},
	{"id": "account-self", "description": "People can view and change their own account", "resource": "account", "roles": signed_in, "actions": ["read", "write"], "when": "owner", "enabled": true},
	{"id": "audit-trail-self", "description": "People can view their own audit trail", "resource": "audit_trail", "roles": signed_in, "actions": ["read"], "when": "owner", "enabled": true},
	{"id": "audit-trail-staff", "description": "Case managers and administrators can view anyone's audit trail", "resource": "audit_trail", "roles": staff, "actions": ["read"], "when": "any", "enabled": true},
]

# The default rules with the named ones switched off
turned_off(ids) := [object.union(r, {"enabled": count({r.id} & ids) == 0}) | some r in default_rules]

# The team rule off: a case manager is limited to their own work, the queue and reviews
without_team := turned_off({"case-manager-team"})

# A route and a person, for the cases below
anonymous := {"id": null, "role": "anonymous"}

citizen := {"id": "u-citizen", "role": "citizen"}

other_citizen := {"id": "u-other", "role": "citizen"}

manager_a := {"id": "u-manager-a", "role": "case_manager"}

manager_b := {"id": "u-manager-b", "role": "case_manager"}

leader := {"id": "u-leader", "role": "leadership"}

admin := {"id": "u-admin", "role": "admin"}

ask(subject, action, route, resource) := {"subject": subject, "action": action, "route": route, "resource": resource}

# A case, as the backend loads it
a_case(attrs) := object.union({"type": "case", "found": true, "owner_id": "u-citizen", "assigned_to": null, "status": "In Review", "under_compliance_review": false}, attrs)

decide_with(question, rules) := answer if {
	answer := authz.decision with input as question with data.routes as routes with data.rules as rules
}

decide(question) := decide_with(question, default_rules)

decide_without_team(question) := decide_with(question, without_team)

# Routes that are not about a record: the route's roles decide alone

test_anonymous_refused_on_a_signed_in_route if {
	decide(ask(anonymous, "read", "GET /api/dashboards/citizen", null)) == {"allow": false, "rule": "route-roles", "reason": "Only signed-in people can use this route"}
}

test_anonymous_allowed_on_a_public_route if {
	decide(ask(anonymous, "read", "GET /health", null)) == {"allow": true, "rule": "route-roles", "reason": "Someone who is not signed in can use this route"}
}

test_citizen_refused_on_a_staff_route if {
	decide(ask(citizen, "read", "GET /api/cases/stats", null)) == {"allow": false, "rule": "route-roles", "reason": "Only case managers and administrators can use this route"}
}

test_case_manager_allowed_on_a_staff_route if {
	decide(ask(manager_a, "read", "GET /api/cases/stats", null)).allow
}

test_route_restricted_to_admin_refuses_a_case_manager if {
	decide(ask(manager_a, "read", "GET /api/dashboards/admin", null)) == {"allow": false, "rule": "route-roles", "reason": "Only administrators can use this route"}
	decide(ask(admin, "read", "GET /api/dashboards/admin", null)).allow
}

# STORY-021 and 025: staff read the AI quality page, only an administrator starts a run that calls (and pays for) the model
test_ai_quality_is_read_by_staff_and_run_by_admins_only if {
	decide(ask(manager_a, "read", "GET /api/ai-quality", null)).allow
	decide(ask(admin, "read", "GET /api/ai-quality", null)).allow
	not decide(ask(citizen, "read", "GET /api/ai-quality", null)).allow
	not decide(ask(leader, "read", "GET /api/ai-quality", null)).allow
	not decide(ask(anonymous, "read", "GET /api/ai-quality", null)).allow
	decide(ask(admin, "write", "POST /api/ai-quality/evaluations", null)).allow
	decide(ask(manager_a, "write", "POST /api/ai-quality/evaluations", null)) == {"allow": false, "rule": "route-roles", "reason": "Only administrators can use this route"}
	not decide(ask(leader, "write", "POST /api/ai-quality/evaluations", null)).allow
}

test_leadership_is_not_staff if {
	not decide(ask(leader, "read", "GET /api/cases/stats", null)).allow
	decide(ask(leader, "read", "GET /api/dashboards/leadership", null)).allow
	decide(ask(leader, "read", "GET /api/dashboards/citizen", null)).allow
}

test_a_role_the_data_does_not_know_is_refused if {
	decide(ask({"id": "u-x", "role": "superuser"}, "read", "GET /api/dashboards/citizen", null)).allow == false
}

test_unknown_route_is_refused if {
	decide(ask(admin, "read", "GET /api/not-a-route", null)) == {"allow": false, "rule": "no-route", "reason": "No policy covers this route, so it is refused"}
}

test_a_question_without_a_route_is_refused if {
	decide({"subject": admin, "action": "read"}).allow == false
	decide({}).allow == false
}

# Cases

test_citizen_reads_own_case_and_is_refused_another_s if {
	own := a_case({"owner_id": "u-citizen"})
	decide(ask(citizen, "read", "GET /api/cases/:id", own)) == {"allow": true, "rule": "case-applicant", "reason": "People can view and act on their own applications"}
	decide(ask(citizen, "write", "POST /api/cases/:id/status", own)).allow
	decide(ask(other_citizen, "read", "GET /api/cases/:id", own)) == {"allow": false, "rule": "no-matching-rule", "reason": "No rule lets a citizen view another person's case"}
}

test_leadership_reads_only_own_case if {
	decide(ask(leader, "read", "GET /api/cases/:id", a_case({"owner_id": "u-leader"}))).allow
	not decide(ask(leader, "read", "GET /api/cases/:id", a_case({}))).allow
}

test_case_manager_reads_a_case_assigned_to_them_with_the_team_rule_off if {
	mine := a_case({"assigned_to": "u-manager-a"})
	decide_without_team(ask(manager_a, "read", "GET /api/cases/:id", mine)) == {"allow": true, "rule": "case-manager-assigned", "reason": "Case managers can view and work cases assigned to them"}
	decide_without_team(ask(manager_a, "write", "PUT /api/cases/:id/assignment", mine)).allow
}

test_case_manager_is_refused_a_case_assigned_to_someone_else_with_the_team_rule_off if {
	theirs := a_case({"assigned_to": "u-manager-b"})
	decide_without_team(ask(manager_a, "read", "GET /api/cases/:id", theirs)) == {"allow": false, "rule": "no-matching-rule", "reason": "No rule lets a case manager view a case assigned to someone else"}
	decide_without_team(ask(manager_a, "write", "PUT /api/cases/:id/assignment", theirs)) == {"allow": false, "rule": "no-matching-rule", "reason": "No rule lets a case manager work a case assigned to someone else"}
}

test_case_manager_works_every_case_while_the_team_rule_is_on if {
	theirs := a_case({"assigned_to": "u-manager-b"})
	decide(ask(manager_a, "write", "PUT /api/cases/:id/assignment", theirs)) == {"allow": true, "rule": "case-manager-team", "reason": "Case managers can view and work every case (team visibility)"}
}

test_the_unassigned_queue if {
	queued := a_case({"assigned_to": null})
	decide_without_team(ask(manager_a, "read", "GET /api/cases/:id", queued)) == {"allow": true, "rule": "case-manager-queue", "reason": "Case managers can view and pick up unassigned cases"}
	decide_without_team(ask(manager_a, "write", "PUT /api/cases/:id/assignment", queued)).allow
}

test_a_case_under_compliance_review_can_be_read_but_not_worked_with_the_team_rule_off if {
	waiting := a_case({"assigned_to": "u-manager-b", "under_compliance_review": true})
	decide_without_team(ask(manager_a, "read", "GET /api/cases/:id", waiting)) == {"allow": true, "rule": "case-manager-review", "reason": "Case managers can view cases waiting for a second-person compliance review"}
	decide_without_team(ask(manager_a, "write", "PUT /api/cases/:id/assignment", waiting)) == {"allow": false, "rule": "no-matching-rule", "reason": "No rule lets a case manager work a case assigned to someone else"}
}

test_a_refusal_names_an_unassigned_case if {
	decide_without_team(ask(manager_a, "write", "PUT /api/cases/:id/assignment", a_case({"assigned_to": null}))).allow
	decide_with(ask(manager_a, "write", "PUT /api/cases/:id/assignment", a_case({"assigned_to": null})), turned_off({"case-manager-team", "case-manager-queue"})) == {"allow": false, "rule": "no-matching-rule", "reason": "No rule lets a case manager work an unassigned case"}
}

test_admin_reads_anything if {
	decide(ask(admin, "read", "GET /api/cases/:id", a_case({"owner_id": "u-other", "assigned_to": "u-manager-b"}))) == {"allow": true, "rule": "case-admin", "reason": "Administrators can view and work every case"}
	decide_without_team(ask(admin, "write", "PUT /api/cases/:id/assignment", a_case({"assigned_to": "u-manager-b"}))).allow
	decide(ask(admin, "read", "GET /api/audit/user/:userId", {"type": "audit_trail", "found": true, "owner_id": "u-citizen"})).allow
}

test_a_disabled_rule_has_no_effect if {
	without_applicant := turned_off({"case-applicant"})
	own := a_case({"owner_id": "u-citizen"})
	not decide_with(ask(citizen, "read", "GET /api/cases/:id", own), without_applicant).allow
	decide(ask(citizen, "read", "GET /api/cases/:id", own)).allow
	decide_with(ask(manager_a, "read", "GET /api/cases/:id", own), without_applicant).allow
}

test_a_missing_record_is_allowed_so_the_route_answers_404 if {
	gone := {"type": "case", "found": false}
	decide(ask(citizen, "read", "GET /api/cases/:id", gone)) == {"allow": true, "rule": "not-found", "reason": "The record does not exist, so the route answers that itself"}
	decide_without_team(ask(manager_a, "write", "PUT /api/cases/:id/assignment", gone)).allow
}

test_a_missing_record_does_not_open_a_route_to_a_role_it_refuses if {
	not decide(ask(citizen, "write", "PUT /api/cases/:id/assignment", {"type": "case", "found": false})).allow
}

test_a_record_route_without_the_record_is_refused if {
	not decide(ask(admin, "read", "GET /api/cases/:id", null)).allow
	not decide(ask(admin, "read", "GET /api/cases/:id", {"type": "account", "found": true, "owner_id": "u-admin"})).allow
}

# Accounts and audit trails

test_a_person_reaches_their_own_account_and_nobody_else_does if {
	own := {"type": "account", "found": true, "owner_id": "u-citizen"}
	decide(ask(citizen, "read", "GET /api/users/:id", own)) == {"allow": true, "rule": "account-self", "reason": "People can view and change their own account"}
	decide(ask(manager_a, "read", "GET /api/users/:id", own)) == {"allow": false, "rule": "no-matching-rule", "reason": "No rule lets a case manager view another person's account"}
	not decide(ask(admin, "read", "GET /api/users/:id", own)).allow
}

test_an_audit_trail_is_open_to_its_owner_and_to_staff if {
	trail := {"type": "audit_trail", "found": true, "owner_id": "u-citizen"}
	decide(ask(citizen, "read", "GET /api/audit/user/:userId", trail)).rule == "audit-trail-self"
	decide(ask(manager_a, "read", "GET /api/audit/user/:userId", trail)).rule == "audit-trail-staff"
	decide(ask(other_citizen, "read", "GET /api/audit/user/:userId", trail)) == {"allow": false, "rule": "no-matching-rule", "reason": "No rule lets a citizen view another person's audit trail"}
	not decide(ask(leader, "read", "GET /api/audit/user/:userId", trail)).allow
}

test_an_anonymous_caller_never_matches_a_rule_by_having_no_id if {
	ownerless := {"type": "case", "found": true, "owner_id": null, "assigned_to": null, "status": "Draft", "under_compliance_review": false}
	not decide(ask(anonymous, "read", "GET /api/cases/:id", ownerless)).allow
}

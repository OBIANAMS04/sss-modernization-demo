# STORY-016: the API access policy. The backend asks one question per request and gets one answer.
#
#   input:  {"subject": {"id": ..., "role": ...}, "action": "read" | "write", "route": "GET /api/cases/:id", "resource": ...}
#   answer: {"allow": true | false, "rule": "...", "reason": "..."}
#
# subject.role is citizen, case_manager, leadership or admin, or anonymous without a valid sign-in. resource is null for a
# route that is not about a record, otherwise the attributes of the record (its owner, who it is assigned to, ...), or
# {"type": ..., "found": false} when there is no such record.
#
# What is not written here: data.routes (the roles each route accepts, and what kind of record it is about) and data.rules (the
# attribute rules). The backend builds both from the defaults in code plus the newest saved version, so an administrator changes
# them without a deploy. This file only says how they are applied.
#
# After editing, run `node scripts/opa/build.mjs`: it checks and tests this file, compiles it to WebAssembly and records the
# hashes in manifest.json. A jest test fails when the compiled policy is out of date.
package sss.authz

import rego.v1

# The branches are tried in order and the first that applies decides, so the answer is always one value. Every refusal has a
# value that is always defined (the helpers below have defaults), so a refusal can never fall through to a later allow.
decision := {"allow": false, "rule": "no-route", "reason": "No policy covers this route, so it is refused"} if {
	not route
} else := {"allow": false, "rule": "route-roles", "reason": sprintf("Only %s can use this route", [accepted])} if {
	not input.subject.role in route.roles
} else := {"allow": true, "rule": "route-roles", "reason": sprintf("%s can use this route", [role_start])} if {
	not is_string(route.resource)
} else := {"allow": true, "rule": "not-found", "reason": "The record does not exist, so the route answers that itself"} if {
	input.resource.found == false
} else := {"allow": true, "rule": matching[0].id, "reason": matching[0].description} if {
	count(matching) > 0
} else := {"allow": false, "rule": "no-matching-rule", "reason": refusal}

route := data.routes[input.route]

# The enabled rules that apply to this caller and this record, in the order the data lists them
matching := [rule |
	some rule in data.rules
	rule.enabled == true
	rule.resource == route.resource
	input.resource.type == route.resource
	input.subject.role in rule.roles
	input.action in rule.actions
	applies(rule.when)
]

applies("any") := true

applies("owner") if owns

applies("assignee") if {
	is_string(input.subject.id)
	input.resource.assigned_to == input.subject.id
}

applies("unassigned") if input.resource.assigned_to == null

applies("under_review") if input.resource.under_compliance_review == true

owns if {
	is_string(input.subject.id)
	input.resource.owner_id == input.subject.id
}

# Words for the reasons. A refusal reads after "Access denied: ", so it is a plain sentence.

role_start := object.get(starts, input.subject.role, "That role")

starts := {
	"anonymous": "Someone who is not signed in",
	"citizen": "A citizen",
	"case_manager": "A case manager",
	"leadership": "A leadership user",
	"admin": "An administrator",
}

mids := {
	"anonymous": "someone who is not signed in",
	"citizen": "a citizen",
	"case_manager": "a case manager",
	"leadership": "a leadership user",
	"admin": "an administrator",
}

plurals := {
	"citizen": "citizens",
	"case_manager": "case managers",
	"leadership": "leadership users",
	"admin": "administrators",
}

signed_in := ["citizen", "case_manager", "leadership", "admin"]

# The roles the route accepts, in words: "administrators", "case managers and administrators", "signed-in people"
default accepted := "people with another role"

accepted := "signed-in people" if {
	count([role | some role in signed_in; role in route.roles]) == count(signed_in)
	not "anonymous" in route.roles
} else := concat("", [piece |
	some i, role in [r | some r in signed_in; r in route.roles]
	piece := join_piece(i, count([r | some r in signed_in; r in route.roles]), plurals[role])
]) if {
	count([r | some r in signed_in; r in route.roles]) > 0
}

join_piece(0, _, word) := word

join_piece(i, n, word) := sprintf(" and %s", [word]) if {
	i > 0
	i == n - 1
}

join_piece(i, n, word) := sprintf(", %s", [word]) if {
	i > 0
	i < n - 1
}

# Why no rule let the caller do this, e.g. "No rule lets a case manager work a case assigned to someone else"
default refusal := "No rule allows this"

refusal := sprintf("No rule lets %s %s %s", [object.get(mids, input.subject.role, "that role"), verbs[route.resource][input.action], target])

verbs := {
	"case": {"read": "view", "write": "work"},
	"account": {"read": "view", "write": "change"},
	"audit_trail": {"read": "view", "write": "change"},
}

nouns := {"case": "case", "account": "account", "audit_trail": "audit trail"}

# The record, from the caller's side. Who a case is assigned to only matters to people who work cases.
target := sprintf("their own %s", [nouns[route.resource]]) if {
	owns
} else := "a case assigned to them" if {
	route.resource == "case"
	is_string(input.subject.id)
	input.resource.assigned_to == input.subject.id
} else := "an unassigned case" if {
	route.resource == "case"
	input.subject.role in {"case_manager", "admin"}
	input.resource.assigned_to == null
} else := "a case assigned to someone else" if {
	route.resource == "case"
	input.subject.role in {"case_manager", "admin"}
} else := sprintf("another person's %s", [nouns[route.resource]])

import { Access, ROUTE_ACCESS } from './routeAccess';

/**
 * STORY-016: what the access policy starts from, in code. The policy itself is backend/policy/sss_authz.rego (Open Policy
 * Agent, compiled to WebAssembly); this file is the data it is given: which roles each route accepts, which kind of record a
 * route is about, and the attribute rules (ABAC) about those records. An administrator can switch a rule off and narrow a
 * route to fewer roles without a deploy (policyService.ts); nothing can be widened beyond what is declared here.
 */
export type PolicyRole = 'anonymous' | 'citizen' | 'case_manager' | 'leadership' | 'admin';
export type ResourceType = 'case' | 'account' | 'audit_trail';
export type RuleAction = 'read' | 'write';
/** Which records a rule covers, for a caller whose role it names: all of them, the caller's own, the ones assigned to the caller, ... */
export type RuleCondition = 'any' | 'owner' | 'assignee' | 'unassigned' | 'under_review';

/** Every role, in the order they are listed wherever roles are kept or shown. */
export const POLICY_ROLES: PolicyRole[] = ['anonymous', 'citizen', 'case_manager', 'leadership', 'admin'];
const SIGNED_IN: PolicyRole[] = ['citizen', 'case_manager', 'leadership', 'admin'];
const STAFF: PolicyRole[] = ['case_manager', 'admin'];

/** The roles in the standard order, without repeats. */
export const inOrder = (roles: string[]): PolicyRole[] => POLICY_ROLES.filter((role) => roles.includes(role));

export interface RuleDefinition {
  id: string;
  /** Plain English; it is the reason given when the rule allows a request, and the label an administrator sees. */
  description: string;
  resource: ResourceType;
  roles: PolicyRole[];
  actions: RuleAction[];
  when: RuleCondition;
}

/**
 * The attribute rules, applied to routes that are about a record (a case, an account, an audit trail). A request is allowed
 * when the route accepts the caller's role and an enabled rule matches; the first match in this order is the one reported.
 * Together the defaults behave exactly as the route guards always have, so switching one off is the only way they change.
 */
export const RULES: RuleDefinition[] = [
  { id: 'case-applicant', description: 'People can view and act on their own applications', resource: 'case', roles: SIGNED_IN, actions: ['read', 'write'], when: 'owner' },
  { id: 'case-manager-assigned', description: 'Case managers can view and work cases assigned to them', resource: 'case', roles: ['case_manager'], actions: ['read', 'write'], when: 'assignee' },
  { id: 'case-manager-queue', description: 'Case managers can view and pick up unassigned cases', resource: 'case', roles: ['case_manager'], actions: ['read', 'write'], when: 'unassigned' },
  { id: 'case-manager-review', description: 'Case managers can view cases waiting for a second-person compliance review', resource: 'case', roles: ['case_manager'], actions: ['read'], when: 'under_review' },
  // On by default (team visibility). Off, a case manager is limited to their own work, the queue and reviews.
  { id: 'case-manager-team', description: 'Case managers can view and work every case (team visibility)', resource: 'case', roles: ['case_manager'], actions: ['read', 'write'], when: 'any' },
  { id: 'case-admin', description: 'Administrators can view and work every case', resource: 'case', roles: ['admin'], actions: ['read', 'write'], when: 'any' },
  { id: 'account-self', description: 'People can view and change their own account', resource: 'account', roles: SIGNED_IN, actions: ['read', 'write'], when: 'owner' },
  { id: 'audit-trail-self', description: 'People can view their own audit trail', resource: 'audit_trail', roles: SIGNED_IN, actions: ['read'], when: 'owner' },
  { id: 'audit-trail-staff', description: "Case managers and administrators can view anyone's audit trail", resource: 'audit_trail', roles: STAFF, actions: ['read'], when: 'any' },
];

/** A policy change cannot restrict these: sign-in, the health check and the policy pages themselves (an administrator can never be locked out). */
export const LOCKED_ROUTES = new Set([
  'GET /health',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/mfa/verify',
  'POST /api/auth/logout',
  'POST /api/auth/refresh',
  'GET /api/policies',
  'PUT /api/policies',
]);

/** The roles a route's access label lets through, before any administrator restriction. */
const BASELINE: Record<Access, PolicyRole[]> = {
  public: POLICY_ROLES,
  'optional-sign-in': POLICY_ROLES,
  'signed-in': SIGNED_IN,
  owner: SIGNED_IN,
  'owner-or-staff': SIGNED_IN,
  staff: STAFF,
  admin: ['admin'],
  leadership: ['leadership', 'admin'],
};

export const baselineRoles = (access: Access): PolicyRole[] => [...BASELINE[access]];

/**
 * The routes that are about a record, and which path parameter names it. Any other route has no record: the route's roles
 * decide alone, and its handler keeps scoping lists to the caller as it always has.
 */
const RECORD_ROUTES: { type: ResourceType; param: string; routes: RegExp }[] = [
  { type: 'case', param: 'id', routes: /^[A-Z]+ \/api\/cases\/:id(\/|$)/ },
  { type: 'case', param: 'caseId', routes: /^GET \/api\/compliance\/cases\/:caseId$/ },
  { type: 'account', param: 'id', routes: /^[A-Z]+ \/api\/users\/:id$/ },
  { type: 'audit_trail', param: 'userId', routes: /^GET \/api\/audit\/user\/:userId$/ },
];

export function recordOf(routeKey: string): { type: ResourceType; param: string } | null {
  const record = RECORD_ROUTES.find((r) => r.routes.test(routeKey));
  return record ? { type: record.type, param: record.param } : null;
}

export interface RouteEntry {
  roles: PolicyRole[];
  resource: ResourceType | null;
}

/** Every route in the access table (routeAccess.ts) with the roles its label allows and the kind of record it is about. */
export const BASELINE_ROUTES: Record<string, RouteEntry> = Object.fromEntries(
  Object.entries(ROUTE_ACCESS).map(([key, access]) => [key, { roles: baselineRoles(access), resource: recordOf(key)?.type ?? null }])
);

export const isKnownRoute = (key: string): boolean => Object.prototype.hasOwnProperty.call(BASELINE_ROUTES, key);

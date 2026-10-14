/**
 * The access rule for every route the API serves, declared when the route is written.
 *
 * "Authorization is a property of the endpoint, not of whether its table happens to exist yet.
 * An endpoint that is unreachable because its table is missing is not protected, it is dormant,
 * and a migration is all it takes to wake it up." (Ali, 2026-10-02)
 *
 * routeAccess.test.ts fails the build when a served route is missing from this table, when an
 * entry no longer matches a route, when a route lacks the middleware its rule requires, or when a
 * protected route answers anything but 401 without a valid token. Adding a route therefore means
 * deciding its rule here, in the same change.
 *
 * STORY-016: the rule also sets the roles the access policy (Open Policy Agent, see accessPolicy.ts) lets
 * through for the route, so a route is covered by the policy as soon as it is declared here. An administrator
 * can narrow those roles without a deploy; nothing can widen them.
 */
export type Access =
  /** Anyone, no sign-in. */
  | 'public'
  /** Anyone; signed-in callers get their own data, others get a generic answer. */
  | 'optional-sign-in'
  /** Any signed-in user; the handler scopes the data to the caller. */
  | 'signed-in'
  /** Signed in, and the handler allows only the record's owner. */
  | 'owner'
  /** Signed in, and the handler allows only the record's owner or staff. */
  | 'owner-or-staff'
  /** Case managers and admins only (requireStaff). */
  | 'staff'
  /** Admins only (requireRole). */
  | 'admin'
  /** Leadership and admins only (requireRole). Leadership is not staff: it reads aggregates and does no case work. */
  | 'leadership';

export const ROUTE_ACCESS: Record<string, Access> = {
  'GET /health': 'public',
  'POST /api/auth/register': 'public',
  'POST /api/auth/login': 'public',
  // STORY-003: the second step of sign-in. 'public' because the caller has no session yet; the handler carries its own
  // check instead: a pending token from the password step (valid 5 minutes, refused everywhere a session is) plus the code.
  'POST /api/auth/mfa/verify': 'public',
  'POST /api/auth/logout': 'signed-in',
  'POST /api/auth/refresh': 'signed-in',

  'GET /api/users/:id': 'owner',
  'PUT /api/users/:id': 'owner',

  'POST /api/mfa/setup': 'signed-in',
  'POST /api/mfa/verify': 'signed-in',
  'POST /api/mfa/disable': 'signed-in',
  'GET /api/mfa/status': 'signed-in',

  'GET /api/exemptions': 'signed-in',
  'POST /api/exemptions/check': 'signed-in',
  'GET /api/exemptions/stats': 'staff',

  'POST /api/cases': 'signed-in',
  'GET /api/cases': 'signed-in',
  'GET /api/cases/managers': 'staff',
  'GET /api/cases/export': 'staff',
  'GET /api/cases/stats': 'staff',
  'GET /api/cases/:id': 'owner-or-staff',
  'POST /api/cases/:id/status': 'owner-or-staff',
  'PUT /api/cases/:id/assignment': 'staff',
  'POST /api/cases/:id/notes': 'staff',
  'GET /api/cases/:id/notes': 'staff',
  'POST /api/cases/:id/documents': 'owner-or-staff',
  'GET /api/cases/:id/documents': 'owner-or-staff',
  'PUT /api/cases/:id': 'staff',

  'GET /api/compliance/matrix': 'signed-in',
  'GET /api/compliance/dashboard': 'staff',
  'GET /api/compliance/decisions': 'staff',
  'GET /api/compliance/cases/:caseId': 'staff',
  'GET /api/compliance/reviews': 'staff',
  'POST /api/compliance/reviews/:id/resolve': 'staff',

  'GET /api/freshness/dashboard': 'staff',
  'POST /api/freshness/probe': 'staff',

  'GET /api/audit': 'staff',
  'GET /api/audit/user/:userId': 'owner-or-staff',
  'GET /api/audit/resource/:resource/:resourceId': 'staff',
  'GET /api/audit/stats': 'staff',

  'GET /api/staff': 'staff',
  'POST /api/staff/grant': 'staff',
  'POST /api/staff/:id/revoke': 'staff',

  'GET /api/notifications': 'signed-in',
  'POST /api/notifications/read-all': 'signed-in',
  'POST /api/notifications/:id/read': 'signed-in',

  'GET /api/dashboards/citizen': 'signed-in',
  'GET /api/dashboards/case-manager': 'staff',
  'GET /api/dashboards/admin': 'admin',
  'GET /api/dashboards/leadership': 'leadership',

  // STORY-016: the access policy itself, changed by admins and applied without a deploy
  'GET /api/policies': 'admin',
  'PUT /api/policies': 'admin',
};

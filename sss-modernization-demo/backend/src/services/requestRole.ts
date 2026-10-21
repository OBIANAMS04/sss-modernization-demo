import { Role, getUserRole } from './roleService';

/**
 * STORY-033: the caller's role, read from the database once per request. The access policy (enforcePolicy), the route guard
 * (requireStaff or requireRole) and the handler each used to ask for it, so a case manager's request made two or three identical
 * queries. The role is still read from the database on every request, never from the token and never kept between requests, so a
 * change in Staff Access applies on the person's next request exactly as before.
 */
export async function getRequestRole(req: any): Promise<Role | null> {
  const sub: string | undefined = req.user?.sub;
  if (!sub) return null;
  if (req.resolvedRole && req.resolvedRole.sub === sub) return req.resolvedRole.role;
  const role = await getUserRole(sub);
  req.resolvedRole = { sub, role };
  return role;
}

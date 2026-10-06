# SSS Modernization: Security and Shipping Rules

Rules learned on this project, each with what enforces it. Read before adding a route, a migration, or a test.

## 1. Every route gets its access rule when it is written

> Authorization is a property of the endpoint, not of whether its table happens to exist yet. An endpoint that is unreachable because its table is missing is not protected, it is dormant, and a migration is all it takes to wake it up. Every route gets its check at the moment it is written, not at the moment it becomes reachable.
> — Ali Muwwakkil, 2026-10-02

**What happened:** on 2026-10-01, the first deploy of migrations 003–010 created tables that switched on older endpoints written without authorization ("In production, would check for admin role"). For one deploy cycle, any signed-in user could list or approve any case, read the whole audit log, and delete latency metrics. Fixed in `8ee7b1e`.

**Enforced by:** `backend/src/security/routeAccess.ts` declares one rule per route (`public`, `optional-sign-in`, `signed-in`, `owner`, `owner-or-staff`, `staff`). `backend/src/security/routeAccess.test.ts` fails when:
- the app serves a route that has no rule,
- a rule names a route that no longer exists,
- a route lacks the middleware its rule requires (a sign-in guard, plus `requireStaff` for `staff`),
- a protected route answers anything but **401** without a token or with an invalid one.

Adding a route means adding its rule in the same change. `owner` and `owner-or-staff` record checks live in the handler, so cover them in the access walkthrough (citizen, other citizen, anonymous, case manager) before shipping.

## 2. Tests never touch a real database

**What happened:** the route tests end with `DROP TABLE users CASCADE` on whatever database they connect to; pointed at production by one environment variable, they would have deleted every user.

**Enforced by:** `backend/jest.setup.js` forces a `*_test` database and refuses any non-local host. Do not weaken it with a "safer connection string"; the guard is the fix.

## 3. A layer must not report itself as working when it is not

**What happened:** production held only 3 of 10 migrations, and every audit-log write was failing after the row was saved, while the app looked healthy. Login tokens also expired after about 3.6 seconds instead of an hour (a bare `"3600"` read as milliseconds), the kind of bug that gets misread as flaky infrastructure.

**Enforced by:** pending migrations apply automatically before the server listens; a failed migration stops the deploy and the previous version keeps serving. Bad or expired tokens now return 401 (they returned 500), so expired sessions send users back to sign-in.

## 4. Verify your own deploy; post the evidence

**Process correction from Ali (2026-10-02):** verifying a deploy is part of shipping it. Never ask a reviewer to open the hosting dashboard or read logs. For every milestone, the team checks that the pushed commit is the one serving (`/health` on the API and `/version.json` on the site report the deployed commit), captures screenshots of the live site, and posts the finished screenshots with the conclusion in the BUILD thread. Ali reviews the live site as a user.

## 5. Sensitive data

- SSNs are bcrypt-hashed at rest and never logged; exports never include them.
- No secrets in the repository. Credentials live in the hosting dashboard.
- Before any real data: rotate the database password and `JWT_SECRET` (both were shared in chat on 2026-09-17).

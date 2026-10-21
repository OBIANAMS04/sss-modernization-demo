Demonstrated on a synthetic demo deployment; not operating in production.

# Operator runbook (STORY-038)

For the person who runs the service. Written against commit `e0f664c`. Companion documents: `INCIDENT-PLAYBOOK.md` (what to do when something is wrong), `RUNBOOK-ALERTS.md` (one entry per in-app alert), `FAILOVER.md`, `OBSERVABILITY.md`.

## Demo limit and production practice

- **Demo limit.** The demo runs on Render: a static site (`sss-demo-frontend`), a web service (`sss-demo-backend`, a small instance that sleeps when idle) and a PostgreSQL database (`sss-demo-db`, Oregon, paid Basic plan). There is one environment, no staging, one operator and no second region. Several steps below were written from the code and from the project's records and have **not been rehearsed**; each is marked "confirm in the Render dashboard" or "not verified" where that is so.
- **Production practice.** The agency deployment is designed for AWS GovCloud (STORY-004, waiting on approval). Where this runbook says "in production", it describes what to do there; the commands for Render do not apply.

Commands are run from `sss-modernization-demo/` unless stated. Names of environment variables appear here; values never do. Do not paste a secret into a chat, a ticket, a screenshot or a commit.

## 1. Where things are

| What | Where |
|---|---|
| Site | https://sss-demo-frontend.onrender.com (its `/version.json` reports the deployed commit) |
| API | https://sss-demo-backend.onrender.com (`/health` reports status, commit, database and migrations) |
| Source | https://github.com/OBIANAMS04/sss-modernization-demo, branch `master` |
| Hosting dashboard | https://dashboard.render.com (services `sss-demo-frontend`, `sss-demo-backend`, `sss-demo-db`) |
| AI provider | Anthropic Console, the workspace that holds the key |
| Uptime check | GitHub, repository Actions, workflow "Uptime check" (`.github/workflows/uptime.yml`) |

## 2. Deploy

Render deploys automatically when `master` changes. A service is rebuilt only when a push touches its own folder (`sss-modernization-demo/backend` for the API, `sss-modernization-demo/frontend` for the site), so the two can legitimately serve different commits.

1. **Before pushing.** Run the unit tests (`cd backend && npx jest`). Adding a route means adding its access rule in the same change (`docs/SECURITY-RULES.md`, rule 1); a test fails the build if one is missing.
2. **Push.** `git push` to `master`.
3. **Wait for Render.** In the Render dashboard, the service's Deploys list shows the build. The API opens its port only after migrations and startup work finish. A migration whose SQL fails stops the release before Render promotes it, and the previous version keeps serving. If the database is unreachable at start, the API listens anyway and answers 503 (see `FAILOVER.md`).
4. **Verify from outside.** From `sss-modernization-demo/`:

   ```
   node scripts/verify-deploy.mjs <commit-sha>
   ```

   With no argument it uses `HEAD`. It waits up to 15 minutes (free instances build slowly and start cold) and then checks: the API serves a commit that includes the latest change to `backend/`; the site serves one that includes the latest change to `frontend/`; every page path serves the current bundle (the site's CDN can serve a previous page for a few minutes); `/health` reports `database: "ok"`; every protected GET route in `backend/src/security/routeAccess.ts` answers 401 without a token; and the audit log records the caller's own address.
5. **Read the verdict.** Exit code 0 and a line starting `VERIFIED` means done. `NOT VERIFIED` means read the JSON above it: an old commit still served (wait, or look at the Render deploy log), stale page paths (wait for the CDN), `database` not `ok` (see section 6 and the incident playbook), or a route that did not answer 401 (SEV1: an unprotected route; roll back at once).
6. **Optional, access check as a citizen.** `node scripts/verify-live-citizen.mjs [screenshot-dir]` signs in as one synthetic account named "Deploy Check" and confirms every staff route refuses it (GET requests only). **It registers that account on the live deployment the first time it runs**, and keeps the generated password outside the repository (`~/.claude/sss-verify/live-citizen.json`, or the file named by `LIVE_CITIZEN_FILE`). Do not run it if you do not want that account to exist.

Production practice: a staging environment that runs the same two scripts before a release is promoted, and a second person approving the release.

## 3. Roll back

Pick the way that matches what you need.

**A. Revert in git (preferred when you have a minute).** `git revert <bad-commit>`, push, run `verify-deploy.mjs` as above. The repository then matches what runs, and the history says why.

**B. Redeploy an earlier deploy from the Render dashboard (fastest).** Open the service (`sss-demo-backend` or `sss-demo-frontend`), open its Deploys list, choose the last good deploy and redeploy or roll back to it. Confirm in the Render dashboard the exact button names and whether automatic deploys stay on afterwards; if they do, the next push deploys again, so make the matching change in git straight away. After it, run `verify-deploy.mjs` with the commit you rolled back to.

**What a rollback does to the database: nothing.** Migrations in `backend/src/database/migrations` are forward-only. `runMigrations()` (`backend/src/database/migrate.ts`) applies each file `NNN_*.sql` that is not recorded in `schema_migrations`, in order, each in its own transaction, under a lock so two instances never migrate together. There are no "down" migrations, and rolling code back does not undo a migration. So:

- Older code then runs against a newer schema. This is safe when the later migrations only added tables, columns or indexes, which is true of most of this project's migrations. Check the files added since the commit you are returning to before you rely on it.
- Some migrations change meaning and need care: `009_hash_ssn.sql` replaces SSNs with one-way hashes; `015_audit_write_once.sql` and `019_access_policies.sql` add triggers that make audit and policy-version rows write-once; `017_leadership_role.sql` widens the allowed roles (older code does not know "leadership").
- If a migration itself was wrong, fix it forward with a new migration. Editing or deleting an applied migration file changes nothing in a database that has already recorded it.
- A migration that fails never reaches users: the process exits and Render keeps the previous version.

Production practice: the same rule (additive, forward-only migrations, tested against a copy of production data), plus a database snapshot taken immediately before each release that migrates.

## 4. Rotate secrets

Rotate when a secret is exposed (a screenshot, chat or log), when a person with access leaves, and on a schedule. The project record says the database password and `JWT_SECRET` were shared in chat on 2026-09-17 and must be rotated before any real data is held; **whether that has been done is not recorded here: confirm.** Every setting change is recorded in the Security Audit Log as "Configuration change" at the next start; secrets are compared by a salted fingerprint and only named, never shown.

Set environment variables in the Render dashboard: the service, Environment, edit the variable, save. Saving restarts the service.

### JWT_SECRET (signs every sign-in)

1. Make a new random value on your own machine (for example `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) and paste it straight into Render. Do not save it anywhere else.
2. Set `JWT_SECRET` on `sss-demo-backend`, save, wait for the restart, run `verify-deploy.mjs`.
3. **Effect: every signed-in session ends at once**, and so does any sign-in waiting for its two-step code. People are sent back to sign in; nothing else is lost. Passwords, two-step setups (the authenticator secrets are stored in the database, not derived from this secret) and all data are unaffected.
4. On Render the API refuses to start without `JWT_SECRET`; if you leave it empty the deploy fails and the previous version keeps serving.

### Database password

The API reads `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD` and `DATABASE_SSL` as separate variables (there is no single connection string).

1. In the Render dashboard open `sss-demo-db`. **Confirm in the Render dashboard whether the database page offers a way to reset the password.** If it does not, the alternative is to create a new database, restore into it (section 5), and change the `DATABASE_*` variables to point at it.
2. Change the password and update `DATABASE_PASSWORD` on `sss-demo-backend` in the same sitting, then confirm the restart. Between the two steps data routes fail; the API does not restart on its own for a rejected password, so make the restart part of the step. (Not rehearsed: the behaviour with a rejected password was not tested.)
3. Run `verify-deploy.mjs`. Check `/health` shows `"database":"ok"`.

### ANTHROPIC_API_KEY (the AI provider key)

The key lives only in Render's environment and in the Anthropic workspace (decision of 2026-10-20). A key shown in a screenshot was already revoked and replaced once.

1. In the Anthropic Console, create a new API key **inside the workspace** the project uses. A key that is not scoped to a workspace was refused with HTTP 400 on 2026-10-20.
2. Set `ANTHROPIC_API_KEY` on `sss-demo-backend`, save, wait for the restart.
3. Check one answer: sign in, open Ask about policy, ask a short question. "Checked against the policy" means the AI path works; "Matching policy sections, not an AI answer" means the key is missing or `AI_PROVIDER=off`. Asking costs a fraction of a cent.
4. Revoke the old key in the Anthropic Console. If the old key was exposed, revoke it first and accept a short period without AI answers (the assistant shows policy passages meanwhile).
5. Watch the balance in the Anthropic billing page. The project noted a small prepaid balance with auto-reload off; AI answers stop when it runs out.

### Other settings that are not secrets but matter

`ADMIN_EMAILS` and `CASE_MANAGER_EMAILS` only bootstrap an empty database; after that, access is given in the app (Staff Access). `CORS_ORIGIN` must equal the site's address.

## 5. Restore the database

**What is known.** `sss-demo-db` is on Render's paid Basic plan since 2026-10-19. The project's records say the paid database takes daily backups and that a restore is a manual step. The retention period, the restore options (into a new database or in place), the time a restore takes and the cost have **not been verified: confirm in the Render dashboard** (the database's page, its Recovery or Backups tab). A restore has **not been rehearsed**; the readiness drill in R3 milestone 3 is where it should be. The free plan this database started on has no such backups and expires after 30 days, which caused the outage of October 2026.

**When.** Data was lost or damaged, a bad migration changed data, or the database is gone. If the database is only unreachable, wait: the API recovers by itself when it returns (section 6).

**Steps (to confirm against the dashboard before first use).**
1. Declare an incident (`INCIDENT-PLAYBOOK.md`) and note the time of the last good data.
2. Take a copy of what exists now, even if damaged, so nothing is made worse: `pg_dump --format=custom --no-owner "<external database address from the Render dashboard>" > before-restore.dump`. Keep the address in a shell variable, not in a file or a message.
3. In the Render dashboard, restore the backup you chose. Prefer restoring **into a new database** and checking it, rather than over the live one, if the dashboard allows it.
4. If a new database was made, set `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER` and `DATABASE_PASSWORD` on `sss-demo-backend` to match. The restart applies any migration newer than the backup automatically, because `schema_migrations` is restored with the data.
5. Run `verify-deploy.mjs`. Sign in as an administrator and check Admin Dashboard, then the Security Audit Log.
6. **Know what is lost.** Everything written after the backup is gone. The audit log is write-once, so the gap cannot be patched: write the gap (from and to, UTC) into the incident record.
7. Anyone who registered or applied after the backup must be told to do it again (use the citizen-facing templates in the playbook).

Production practice: point-in-time recovery to a chosen second, backups copied to a second region, an encrypted copy of the audit log in append-only storage (STORY-004), and a restore rehearsal at least twice a year with the time measured against the recovery objectives in `FAILOVER.md`.

## 6. Read the observability page and the alerts

**Public check, no sign-in.** `https://sss-demo-backend.onrender.com/health` returns JSON:
- `status`: `ok`, `degraded` (the API is up, the database is not) or `starting`;
- `database`: `ok`, `down` or `starting`;
- `commit`: the deployed commit; `migrations`: how many are applied and the latest file.

When `database` is `down`, data routes answer 503 with `Retry-After`; the API reopens by itself, within about half a minute of the database returning. If `starting` lasts more than a few minutes, read the Render deploy log: a step is failing.

**Administrators.** Sign in as an administrator and open **Observability** (`/observability`). Top to bottom: Alerts, Service health, Objectives, Request and error rates, Latency by route, Slowest routes, Database, Recent server errors, AI calls, tokens and cost per day, Runbook. The page refreshes every minute. **Refresh** reads again now. **Check objectives now** evaluates every objective immediately and opens or closes alerts.

**Alerts.** A breach opens one alert, writes an audit entry (`SLO_ALERT`) and sends every administrator a notification starting "Service alert:". A breach that lasts does not alert again. The alert closes by itself when the measure recovers. With fewer than 20 requests in a window the page says "Not enough requests" and does not alert. The AI quality alerts (drift, fairness) come from the AI Quality checks on the same timer every five minutes. For what each alert means and the first checks, use the Runbook section of the page, `RUNBOOK-ALERTS.md`, or section 4 of the incident playbook.

**Logs.** Every response carries `X-Request-Id`, which is the trace id. In the Render dashboard open the service's Logs and search `"trace_id":"<id>"`. Each line is JSON. A trace id comes from Recent server errors, or from a user who copied it.

**Metrics** are kept 30 days in the database. Traces and metrics leave the server only if `OTEL_EXPORTER_OTLP_ENDPOINT` is set; the Datadog path was tested against a local collector, not a real Datadog Agent (`OBSERVABILITY.md`).

## 7. The uptime check

`.github/workflows/uptime.yml`, "Uptime check", runs every 30 minutes on GitHub's runners and on demand. It needs no secrets.

- **What it checks.** The API's `/health` must answer 200 and contain `"database":"ok"`; the site's `/version.json` must answer 200 and contain `"commit"`. Each probe waits up to 90 seconds (a sleeping instance needs about a minute to wake) and tries twice, 20 seconds apart.
- **On failure.** It opens one issue titled "Demo is down or degraded" with the label `uptime`, which GitHub emails to the repository owner if notifications are on (**confirm in GitHub notification settings**). Later failures add a comment. The first success closes the issue with a comment "Recovered".
- **Run it by hand.** In GitHub: the repository, Actions, "Uptime check", Run workflow. Or from a terminal with the GitHub CLI: `gh workflow run uptime.yml`, then `gh issue list --label uptime`.
- **Limits.** GitHub can delay scheduled runs, and the first scheduled run after the workflow was added had not started two hours later (framework risk list): start it once by hand after any change and confirm the schedule is running. GitHub documents that scheduled workflows in a repository with no activity for 60 days can be switched off (confirm in the repository's Actions page). A free API that has slept returns slowly, which is why there are two attempts. The check says the service answers; it does not say a person can sign in.

Production practice: a monitoring service in a second provider with paging, checks from more than one region, and a synthetic sign-in.

## 8. Environment variables

Read by the backend (`grep process.env backend/src`). Names only. "Secret" means never write the value anywhere but the hosting dashboard. Settings marked "audited" are compared at each start and any change is recorded as Configuration change.

| Name | Purpose | Default if unset | Secret |
|---|---|---|---|
| `JWT_SECRET` | Signs every sign-in token. On Render the API refuses to start without it. Audited (fingerprint). | a public development value (local only) | Yes |
| `JWT_EXPIRY` | Sign-in lifetime; a bare number is seconds. Audited. | `3600` (1 hour) | No |
| `DATABASE_HOST` | Database host. Audited (fingerprint). | `localhost` | Treat as secret |
| `DATABASE_PORT` | Database port. Audited (fingerprint). | `5432` | Treat as secret |
| `DATABASE_NAME` | Database name. Audited (fingerprint). | `sss_demo` | Treat as secret |
| `DATABASE_USER` | Database user. Audited (fingerprint). | a local development user | Treat as secret |
| `DATABASE_PASSWORD` | Database password. Audited (fingerprint). | a local development value | Yes |
| `DATABASE_SSL` | `true` turns on TLS to the database (needed on Render). Audited. | off | No |
| `DATABASE_POOL_MAX` | Connections per process. Keep instances times this under the database's limit. | `25` | No |
| `CORS_ORIGIN` | The site's address the browser may call the API from. Audited. | local development addresses | No |
| `PORT` | Port the API listens on (Render sets it). | `3001` | No |
| `ADMIN_EMAILS` | Comma-separated emails that bootstrap the first administrator on an empty database. Audited. | none | No |
| `CASE_MANAGER_EMAILS` | The same for the first case manager. Audited. | none | No |
| `ANTHROPIC_API_KEY` | Turns on AI answers. Audited (fingerprint). Without it the assistant shows policy passages. | none | Yes |
| `AI_PROVIDER` | `off` forces passages only; `stub` is for tests. Audited. | unset (AI when a key exists) | No |
| `AI_MODEL` | The model used. Audited. | `claude-opus-5-5` | No |
| `AI_DAILY_LIMIT` | AI answers per UTC day across everyone, then passages only. Audited. | `300` | No |
| `AI_DAILY_BUDGET_USD` | Daily AI spend objective (estimated cost). | `2` | No |
| `OBSERVABILITY_INTERVAL_MS` | Period of the objective timer. | `60000` | No |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Where traces and metrics go. Unset means nowhere. | unset | Treat as secret if it has a token |
| `OTEL_SERVICE_NAME` | Service name on traces and logs. | `sss-demo-api` | No |
| `NODE_ENV` | `test` stops the timer (tests only). | none | No |
| `RENDER` | Set by Render. Its presence switches on production-only behaviour (refusing to start without `JWT_SECRET`, reading the visitor's address from the proxy header). Do not set it by hand. | unset locally | No |
| `RENDER_GIT_COMMIT` | Set by Render. The commit reported by `/health`. Do not set it. | `local` | No |
| `JEST_WORKER_ID` | Set by the test runner. Do not set it. | unset | No |

`backend/.env.example` shows the local development layout. `docs/OBSERVABILITY.md` lists the tracing variables.

Verification scripts read `API_URL` and `SITE_URL` to point at another deployment (default: the live demo), and the end-to-end suites read `E2E_BASE` (local only unless `E2E_ALLOW_REMOTE=1`).

## 9. Not verified here

- The exact Render dashboard wording for rollback, backup and restore (sections 3 and 5).
- Backup retention and restore time for the paid database.
- Whether the database password can be reset in the Render dashboard.
- That GitHub emails the owner when the uptime issue opens, and that the schedule is running.
- Whether `JWT_SECRET` and the database password have been rotated since 2026-09-17.
- This runbook was written from the source code at commit `e0f664c` and the project records. It was not checked against a running copy of the service.

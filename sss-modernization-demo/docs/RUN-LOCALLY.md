# Run the demo locally from a clean checkout

The hosted demo on Render was taken down in November 2026 (the project was a rehearsal; see `READINESS-REVIEW.md`).
The build still runs on one machine with synthetic data only. These steps were followed exactly from a fresh clone of
the public repository on 2026-11-06 (Windows 11, Node 26, PostgreSQL 18). The result is below.

| Step | Result on 2026-11-06 |
|---|---|
| Clone, `npm ci` and `npm run build` in `backend/` and `frontend/` | Both built |
| `npx jest` in `backend/` (no database needed) | 44 suites, 1,737 tests passed |
| API started on an empty database | All 28 migrations applied by themselves; `/health` answered `"database":"ok"` |
| Synthetic data loaded by the end-to-end scripts | access 34, workflow 26, compliance 30, dashboards 66, training 19 checks: all passed |
| Site signed in as the synthetic case manager | `evidence/run-locally/01-clean-checkout-case-manager.png`, `02-clean-checkout-cases.png` |

Do not follow the local-run section of `README.md`: it dates from before the build and mentions Redis and Docker,
which this project does not use.

## You need

- Node.js 20 or later, and npm.
- PostgreSQL 14 or later, running on `localhost:5432`, with a login `admin` / `dev_password` able to create databases.
  These are the code's development defaults, not a secret; set `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`,
  `DATABASE_PASSWORD` and `DATABASE_NAME` to use others.
- On Windows, clone to a short path (for example `C:\src`) if you hit "Filename too long".

## 1. Build and test

```sh
git clone https://github.com/OBIANAMS04/sss-modernization-demo.git
cd sss-modernization-demo/sss-modernization-demo/backend
npm ci && npm run build && npx jest
cd ../frontend
npm ci
```

## 2. Start the API on an empty database

```sh
createdb -h localhost -U admin sss_demo
cd ../backend
CASE_MANAGER_EMAILS="manager-local-test@example.com,reviewer-local-test@example.com" \
ADMIN_EMAILS="morgan.lee@example.com,manager-local-test@example.com" \
npm start
```

The API listens on `http://localhost:3001` and creates its tables on start. Without `JWT_SECRET` it signs sessions with
a development key, which is right for a local run only. Without `ANTHROPIC_API_KEY` the policy assistant answers in its
"passages only" mode (it shows the cited policy text instead of a model's answer), and nothing is sent to any model.
On PowerShell, set each variable first (`$env:CASE_MANAGER_EMAILS = "..."`) and then run `npm start`.

## 3. Load the synthetic data

In another terminal, from `sss-modernization-demo/sss-modernization-demo`:

```sh
node scripts/e2e/access.mjs
node scripts/e2e/workflow.mjs
node scripts/e2e/compliance.mjs
node scripts/e2e/dashboards.mjs
node scripts/e2e/training.mjs
```

Each prints a PASS or FAIL line per check, and together they create synthetic citizens, case managers, an
administrator and a leader, and cases that are applied for, reviewed, denied, appealed and approved. They refuse to run
against anything but `localhost`. The other scripts in `scripts/e2e/` add more (MFA, the audit log, the assistant review
queue, security checks).

## 4. Open the site

```sh
cd frontend
npm run dev
```

Open `http://localhost:5173` and sign in as `manager-local-test@example.com` with the password `Str0ng!Passw0rd`
(the synthetic test password in `scripts/e2e/lib.mjs`). That account is a case manager and an administrator. Register
a new account to see the citizen's side; use a made-up SSN starting with 900.

Everything is synthetic. Nothing here is operating in production.

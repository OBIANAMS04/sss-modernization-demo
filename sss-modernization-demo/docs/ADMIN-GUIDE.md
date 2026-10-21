Demonstrated on a synthetic demo deployment; not operating in production.

# Administrator guide (STORY-039)

For people with the Admin role. Names of pages, buttons and fields below are the ones on the screen. Written from the application source at commit `e0f664c` and not checked against a running copy; if a label differs on screen, the screen is right and this guide needs a fix.

For running the service itself (deploys, secrets, backups) see `OPERATOR-RUNBOOK.md`. For what to do when an alert opens see `INCIDENT-PLAYBOOK.md` and `RUNBOOK-ALERTS.md`.

## Demo limit and production practice

- **Demo limit.** Everything here uses synthetic data. Anyone can register an account, the first administrator is created from a setting (`ADMIN_EMAILS`), email addresses are not verified, and there is no password reset or recovery codes for two-step sign-in. These are limits of the demo.
- **Production practice.** Mentioned in the sections below where it differs: administrator access given by a second approver, verified identities, an append-only copy of the audit log. (Two-step recovery codes are in the demo since STORY-041.)

## What an administrator can open

Sign in. The top bar shows the pages your role can open. An administrator sees all of: **Dashboard** (opens the Admin Dashboard), **Profile & Exemptions**, **Ask about policy**, **Sign-in security**, **My Work**, **Case Management**, **Compliance**, **Data Freshness**, **Audit Log**, **Assistant Reviews**, **AI Quality**, **Staff Access**, **Leadership**, **Admin**, **Access Policies**, **Observability**, and **Logout**. Case managers see the case work pages (from Case Management to Staff Access) but not Admin, Access Policies or Observability. Leadership sees Leadership only, plus the citizen pages.

A message "available to administrators only. If you were just given access, log out and log back in." means your role has not reached your sign-in yet: sign out and sign in again.

Your session lasts one hour and can be extended up to 12 hours in all. Two minutes before it ends a box titled "Your session is about to end" offers **Stay signed in** or **Sign out**.

## 1. Staff Access: who can work cases

Open **Staff Access** ("Who can work cases, granted in the app and recorded"). Access is given here by an existing case manager or administrator, never by registering. Case managers can give and remove case-manager access only. Administrators can also give and remove Leadership and Admin access.

The list **Current staff** shows Name, Email, Role and Action for each person. The page marks your own row "(you)".

**Give access**
1. The person must already have an account (they register first, see the User guide).
2. Under **Give access**, type their address in **Email**.
3. Choose **Role**: Case manager, Leadership or Admin. (Case managers do not see this field; they give case-manager access only.) Case managers work cases. Leadership sees totals and trends, never an applicant's details. Admins do both and manage access.
4. Type a **Reason**. It is required and is kept in the audit log.
5. Select **Give access**, then **Confirm access**. The page confirms with "<email> now has <role> access."

To change someone from one role to another, remove their access first. A case manager or leadership person can be made an Admin directly.

**Remove access**
1. In the person's row select **Remove access**.
2. Type the **Reason for removing access** (required, kept in the audit log).
3. Select **Remove access** again, then **Confirm removal**. **Cancel removal** backs out.

Rules the page enforces: you cannot remove your own access; only an administrator can remove leadership or admin access; at least one administrator and at least one case manager must keep access. Where a row cannot be removed, the page says why in words.

Every grant and removal appears in **Audit Log** as "Role granted" or "Role removed", with the person and the reason.

Production practice: keep grants of staff and administrator access with administrators or a second approver, and review the list on a schedule.

## 2. Access Policies: who can reach what in the API

Open **Access Policies** (administrators only). It shows **Policy in force**: the policy engine (Open Policy Agent, compiled to WebAssembly, evaluated inside the API on every request), its hash, and the version. "Version 0" means the defaults that come with the code and that nobody has changed the policy yet.

Two tables set the policy. Changes take effect at once, without a release, and can only take access away. A role the code does not allow can never be added.

- **Case and account rules** (Rule, What it allows, Roles, Actions, Applies to, On or off). All rules are on by default. A request is allowed when the route accepts the person's role and at least one rule that is on applies. Clear **On or off** to take that access away. A row you changed shows "Changed, not saved yet".
- **Route restrictions** (Route, Roles allowed). Clear a role to stop it using that route. Sign-in, the health check and the policy pages are marked **Locked**, so an administrator cannot lock themselves out.

**Save a change**
1. Make the changes. Under **Save the changes** the page counts them, for example "1 rule and 0 routes changed."
2. Type the **Reason for this change** (required).
3. Select **Save policy**. The page moves to **History**, which lists every Version with When, Who, What changed and Reason.

Every change is in the **Audit Log** as "Access policy changed", and every request the policy refuses is recorded as "Access denied" with the rule and version that decided it. To undo a change, make the opposite change and save it with a reason; versions are write-once and cannot be edited or deleted.

## 3. AI Quality: evaluation runs and the baseline

Open **AI Quality** ("Drift, evaluation and fairness of the policy assistant"). Case managers can read it; **only administrators can start runs and set the baseline**.

- **Open alerts** lists drift and fairness alerts. An alert opens once, is recorded in the audit log, is sent to every administrator as a notification, and closes by itself when the cause clears.
- **Quality signals** compare the last days of real answers with the days before. A window needs a minimum number of answers, otherwise it says "Not enough data". Choose a signal in **Signal** to see its trend, and read **Change markers** (a new model, or new policy documents) next to it.
- **Evaluation against the golden set**: 33 fixed questions asked of the real model and scored on retrieval, facts, citations and grounding.

**Run an evaluation**
1. Select **Run evaluation**. A box says it asks the model all 33 questions, costs money (about 30 cents, measured) and can be started once an hour.
2. Select **Yes, run the evaluation**. The page says "An evaluation is running." and reads the result itself when it is done.
3. Read **Latest run**: Passed or Missed a threshold, the model, the policy document version, each threshold ("Meets it" or "Below it") and **Questions that missed something**.

**Set the baseline.** The baseline is the run later runs are compared with. A run more than 5 points under it counts as drift. In the table of runs, a completed run that is not the baseline shows **Mark as baseline**. Select it only when the new level is intended (after a deliberate model or document change). The page confirms "That run is now the baseline."

**Run the fairness check**
1. Under **Fairness** select **Run fairness check**. It asks the model 80 questions (about 70 cents, measured), once an hour.
2. Select **Yes, run the fairness check**. The result reads "Passed" or "Missed its criteria", with the pair counts by attribute.
3. **Decision outcomes by group** shows approvals and denials by age band and region, and flags a group under 80% of the highest group (the four-fifths rule). A flag means look closer; it is not a finding that something is unfair.

If a run cannot start, the page shows the reason, for example that one ran in the last hour.

## 4. Assistant Reviews

Open **Assistant Reviews** ("Answers the assistant withheld, and answers people reported"). Case managers and administrators both review. The assistant never decides eligibility or a case; a person reads each withheld answer before anyone sees it.

The tiles show **Waiting for review**, **Longest wait** and **You can review**. **Answer quality** shows how many answers failed the grounding check over 7 and 30 days, against a target below 2%.

**Review one item**
1. Under **Waiting for review**, items are listed oldest first. Read "Why it is here", the draft answer (or the answer the person was shown, if they reported it), and the Grounding check result with its citations.
2. Under **Your review**, choose **Approve the draft**, **Correct the answer** or **Decline to answer**. (Approve is unavailable when there is no draft.)
3. For Correct, write **The answer the person will see**. For Decline, optionally write a **Message to the person**; if empty they are told a case manager reviewed the question and could not answer it here.
4. Write the **Note for the record (required)**. It goes in the audit log; the person does not see it.
5. Select **Send review**. The person is notified and sees the result marked as reviewed.

You cannot review a question you asked yourself; another case manager must. **Recently reviewed** lists the latest ten reviews.

## 5. Observability

Open **Observability** (administrators only). It is described in `OPERATOR-RUNBOOK.md`, section 6. As an administrator you will mostly do three things:

1. **Read the Alerts section.** "No alert is open" means every objective is within its target. An open alert links to its entry in the **Runbook** section at the foot of the page.
2. **Select Check objectives now** after a fix, to evaluate everything immediately instead of waiting for the next minute. **Refresh** only reads again.
3. **Follow a failure.** In **Recent server errors**, copy the Trace id and give it to whoever reads the logs.

Service alerts also arrive as notifications on your Admin Dashboard, starting "Service alert:".

## 6. Security Audit Log

Open **Audit Log** (the page is titled **Security Audit Log**: "Every sign-in, refusal, data access, change and alert"). Three panels at the top state its properties: **Write-once** (the database refuses any edit or deletion of an entry), **Kept for** 7 years, with the number of entries and how many were refusals or failures, and **No personal data** (SSNs, passwords, codes and tokens are removed before an entry is written). If the first panel says **Not write-once**, treat it as an incident.

**Find entries.** Use the form: **From**, **To**, **User** (an email), **Event** (for example Sign-in, Access denied, Role granted, Access policy changed, Configuration change, Deployment, Server restart, Freshness alert, Compliance alert, Assistant answer reviewed), **Area** and **Result** (All, Succeeded, Refused or failed). Select **Search**; **Reset** clears the form. Use **Previous** and **Next** to page. Long details are shortened in the table; hover to see all of it.

Useful searches: refusals only (Result: Refused or failed); one person's activity (User); every change to access (Event: Role granted / Role removed / Access policy changed); what changed at a restart (Event: Configuration change, which names changed settings and shows public values; secrets are only named).

Demo limit: the write-once rule is enforced by database triggers that a database superuser could disable. Production practice: copy every entry to append-only storage (STORY-004).

## 7. Compliance

Open **Compliance** ("Every exemption decision checked against the decision controls"). Choose **Last 7 days**, **Last 30 days** or **Last 90 days**.

- The banner shows either an alert ("Compliance rate ... is below the 99% target ...") or "On target".
- The tiles show **Decisions**, **Passed every control**, **Compliance rate** (target 99%) and **Open reviews**.
- **Open reviews** are decisions that failed a control. A **different** case manager resolves each one from the case page: select **Review on case**, then in the Compliance panel write the **Justification (required, kept in the audit trail)** and choose **Accept exception** or **Reopen case**. You cannot resolve your own decision.
- **Decision controls** shows checks and failures for each control. **Decisions by day** shows the daily result.
- **Open the compliance audit log** opens **Compliance Audit Log** ("Every control result for every exemption decision"), with filters From, To, Applicant or decider, Decision, Requirement and Result, and **Search** / **Reset**.

## 8. Data Freshness

Open **Data Freshness** ("How long until each change is readable by the next request"). Choose **Last 24 hours**, **Last 7 days** or **Last 30 days**.

- The banner says "Within target" (95% of updates readable within 30 seconds) or shows an alert.
- **By data type** lists Profile updates, Eligibility checks, Applications, Case status and assignment and End-to-end check, each "Within target", "Over target" or "No updates yet".
- **Slowest updates** lists the ten slowest changes.
- Select **Check now** to write a test record and time how long it takes to become readable. It reports the time on the server and the round trip from your browser.

A miss is recorded in the Audit Log as "Freshness alert". The page notes that the demo reads straight from its database with no cache or replica, so it will measure cache and replica lag only once those exist.

## 9. Everyday checks

| When | Do |
|---|---|
| Each working day | Open Admin Dashboard (open compliance reviews, system health, notifications). Open Assistant Reviews if "Waiting for review" is above zero. |
| After any change to staff | Check Staff Access shows who you expect, then Audit Log for the entries. |
| After a model or document change | Run an evaluation on AI Quality, then mark it as the baseline if the level is intended. |
| Weekly | Read Observability, Alerts and Objectives, and the AI cost against the budget. |
| After a release | Ask the operator for the `verify-deploy.mjs` result (it is the operator's check, not yours). |

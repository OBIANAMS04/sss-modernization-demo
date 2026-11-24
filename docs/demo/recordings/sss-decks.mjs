// The seven narrated decks (plus architecture and handoff) for the Selective Service System (SSS) Modernization
// rehearsal build's demo-prep recordings. Same format as CRIS-Enhancement/framework/recordings/studio/extra-decks.mjs.
// Every fact comes from the repo: docs/PROJECT-FRAMEWORK.md, sss-modernization-demo/docs/*.md and docs/demo/screens.
// Run:  node sss-decks.mjs <outRoot>   -> <outRoot>/<key>/presentation.html and <outRoot>/screens/*.png
import { buildDeck } from '../../../../CRIS-Enhancement/framework/recordings/studio/deck-builder.mjs';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';

const R = 'A Colaberry rehearsal case study on synthetic data. Not connected to the real Selective Service System.';
const S = (f) => `../screens/${f}`;
const REG = S('deck-register.png'), ELIG = S('deck-eligibility.png'), DENY = S('deck-denial.png'), REV = S('deck-review.png');
const CHK = S('deck-checks.png'), AUD = S('deck-audit.png'), INF = S('deck-informed.png'), QUE = S('deck-queue.png');
const ANS = S('tour-24-assistant-answer.png'), RQ = S('tour-25-review-queue.png'), DRIFT = S('tour-29-drift-signals.png'), FAIR = S('tour-30-fairness.png');
const ATK = S('tour-44-attack-suite.png'), OUT = S('tour-41-database-outage.png');
const LEAD = S('tour-21-leadership-dashboard-crop.png'), POL = S('tour-23-access-policies-crop.png'), MFA = S('tour-17-mfa-setup-crop.png'), MY = S('tour-19-case-manager-dashboard-crop.png');

// ---------- 1. Project introduction (about 90 seconds) ----------
const intro = {
  title: 'Selective Service rehearsal · Project introduction', kicker: 'Project introduction · Selective Service rehearsal',
  slides: [
    { title: 'Who it helps', lede: R, cols: 4,
      tiles: [
        { h: 'Citizens', p: ['Register, check an exemption, apply, and see the reason for every decision.'] },
        { h: 'Case managers', p: ['One queue, automatic checks, a second reviewer when a check fails.'] },
        { h: 'Administrators', p: ['Give and remove access, with a reason, in the app.', 'Every action goes in a write-once audit log.'] },
        { h: 'Leadership', p: ['Totals and trends. No personal data.'] },
      ],
      say: [['OBI', "I'm OBI. This is a Colaberry rehearsal case study: a modernization of Selective Service systems, built on synthetic data. It is not connected to the real Selective Service System."], ['OGE', 'Who does it help?'], ['OBI', 'Four groups. Citizens register, check an exemption, apply, and see the reason for every decision. Case managers get one queue and automatic checks. Administrators give and remove access. Leadership sees totals and trends, with no personal data.'], ['OGE', 'And who watches the system itself?'], ['OBI', 'Everyone can be held to account, because every action goes in a write-once audit log that the database will not let anyone change.']] },
    { title: 'The cost, the human, the next work', cols: 4,
      tiles: [
        { h: 'Proof it runs', p: ['46 stories in 4 releases, all addressed. 1,737 tests passed from a fresh clone.'], tone: 'ok' },
        { h: 'A cost you can point to', p: ['Running cost is now zero. The hosted site is retired, and it runs locally.', 'The database cost $6 a month; the last charge was $1.12.'], tone: 'ok' },
        { h: 'What people still decide', p: ['Every exemption, denial and override is a person\'s decision. The assistant never decides eligibility.'], tone: 'ok' },
        { h: 'Real next work', p: ['A hands-on screen-reader test and an independent security test. Neither is done.'], tone: 'warn' },
      ],
      say: [['OGE', 'Does it actually run?'], ['OBI', 'Yes. Forty-six stories in four releases are all addressed, and seventeen hundred and thirty-seven tests passed from a fresh copy of the repository.'], ['OGE', 'What does it cost?'], ['OBI', 'The running cost is now zero. The hosted site was retired on 6 November 2026, and it runs locally. While it ran, the database cost six dollars a month, and the last charge was one dollar twelve.'], ['OGE', 'What do people still decide?'], ['OBI', "Every exemption, every denial and every override is a person's decision. The assistant never decides eligibility."], ['OGE', 'And what is next?'], ['OBI', 'A hands-on screen-reader test and an independent security test. Neither is done. Thank you.']] },
  ],
};

// ---------- 2. Working system demo (about 5 minutes) ----------
const demo = {
  title: 'Selective Service rehearsal · Working system demo', kicker: 'Working system demo · Selective Service rehearsal',
  slides: [
    { title: 'One outcome, end to end, including the failure', lede: R, cols: 3,
      tiles: [
        { h: 'The outcome', p: ['A citizen registers, is checked for an exemption, and gets a decision with a reason.'] },
        { h: 'The failure', p: ['A decision made without its evidence is caught and sent to a second case manager.'], tone: 'no' },
        { h: 'How it runs', p: ['Screens from the working build, captured on synthetic data. The hosted site is retired; it runs locally.'], tone: 'warn' },
      ],
      say: [['OBI', "I'm OBI. This is the working system, one outcome from start to finish, including what happens when it fails."], ['OGE', 'What are we watching?'], ['OBI', 'A citizen registers, is checked for an exemption, and gets a decision with a reason. Then a decision made without its evidence, which the system catches. These are screens from the working build on synthetic data. The hosted site is retired, and it runs locally.'], ['OGE', 'Who is involved?'], ['OBI', 'A citizen, a case manager who decides, and a second case manager who reviews when a check fails. Three people, and the system between them.']] },
    { title: 'Step 1: register, with the number protected', cols: 2,
      tiles: [
        { h: 'Registration form', p: ['Banner: synthetic data only.'], img: REG, alt: 'Registration form with a masked Social Security number field and a demo-data banner' },
        { h: 'What it protects', p: ['The number is masked, with a Show control.', 'Password: 12 characters, an uppercase letter, a digit and a special character.', 'The number is stored as a one-way hash, never logged.', 'The first screen the citizen meets already says what this is.'], tone: 'ok' },
      ],
      say: [['OBI', 'Step one: the registration form. The banner says synthetic data only, so nobody enters a real number.'], ['OGE', 'And the Social Security number?'], ['OBI', 'It is masked, with a Show control. The password needs twelve characters, an uppercase letter, a digit and a special character. The number is stored as a one-way hash, and never logged.']] },
    { title: 'Step 2: the exemption check gives a reason', cols: 2,
      tiles: [
        { h: 'My Profile and eligibility', p: ['Type A eligible. Types B and C not eligible, each with a reason.'], img: ELIG, alt: 'Eligibility results: Type A senior exemption eligible, Types B and C not eligible with reasons' },
        { h: 'The rules, as illustrations', p: ['Type A: age 65 or older.', 'Type B: income under $20,000.', 'Type C: hardship, which needs a case worker.', 'Illustrative rules, not Selective Service policy.'], tone: 'warn' },
      ],
      say: [['OBI', 'Step two: the citizen presses Check Eligibility. Type A, the senior exemption, comes back eligible because the applicant is sixty-five or older.'], ['OGE', 'And the other two?'], ['OBI', 'Not eligible, each with its reason: no income on file for the income-based type, and no documented hardship. Type B is income under twenty thousand dollars. Type C is a hardship that a case worker reviews. These are illustrative rules, not Selective Service policy.'], ['OBI', 'The profile also has a compliance check: age eighteen or older, a phone number and an address.']] },
    { title: 'Step 3: when the answer is no', cols: 2,
      tiles: [
        { h: 'A denied case, with its reason', p: ['Reason on the timeline: proof of age was not provided.'], img: DENY, alt: 'Denied Type A case with the timeline showing the reason and an Appeal this decision button', tone: 'no' },
        { h: 'Refused, not silent', p: ['A denial needs a reason; the case manager cannot skip it.', 'The citizen sees the reason and can appeal.', 'The timeline: submitted, in review, denied, each with who and when.'], tone: 'warn' },
      ],
      say: [['OBI', 'Step three: when the answer is no. This case is denied, and the timeline gives the reason: proof of age was not provided.'], ['OGE', 'Can the case manager just deny it?'], ['OBI', 'A denial needs a reason. The citizen sees it, and an appeal button is right there. The refusal is never silent. The timeline shows the case moved from submitted, to in review, to denied, each step with who did it and when.']] },
    { title: 'Step 4: a decision that fails its checks', cols: 2,
      tiles: [
        { h: 'Compliance review open', p: ['Approval failed two controls: no assigned reviewer, no proof of age on file.'], img: REV, alt: 'Compliance review open showing controls five and seven failed, with Accept exception and Reopen case', tone: 'no' },
        { h: 'A second person resolves it', p: ['Not the person who decided.', 'A written justification, kept in the audit trail.', 'Accept the exception, or reopen the case.', 'Eight controls are checked on every decision.'], tone: 'ok' },
      ],
      say: [['OBI', 'Step four: the failure. A case manager approved this case, but two decision controls failed: the case was assigned to nobody, and no proof of age was on file.'], ['OGE', 'What happens now?'], ['OBI', 'A compliance review opens. A second person resolves it, never the person who decided, with a written justification kept in the audit trail. They can accept the exception or reopen the case. Here the case is reopened so the applicant can provide proof.'], ['OGE', 'How many things are checked?'], ['OBI', 'Eight controls on every decision, from whether it matches the eligibility result to whether it is in the audit log with who, what and when.']] },
    { title: 'Step 5: the dashboard and the record', cols: 2,
      tiles: [
        { h: 'Compliance dashboard', p: ['66.67% against a 99% target: three decisions, one open review.'], img: CHK, alt: 'Compliance dashboard with a below-target alert, 66.67 percent against 99, and one open review', tone: 'no' },
        { h: 'Compliance audit log', p: ['Every failed control, with its evidence.'], img: AUD, alt: 'Compliance audit log listing the two failed controls for the approved case' },
      ],
      say: [['OBI', 'Step five: the dashboard. Sixty-six point six seven percent against a ninety-nine percent target. That is three decisions with one open review, so the alert is red.'], ['OGE', 'Is the failure recorded?'], ['OBI', 'Yes. The compliance audit log lists every failed control with its evidence: no assigned reviewer, and no proof of age on file.'], ['OBI', 'A caution: that percentage is arithmetic on three decisions. Read it as a demonstration of the alert, not as a measured statistic.']] },
    { title: 'Step 6: the citizen is told', cols: 2,
      tiles: [
        { h: 'Citizen dashboard', p: ['Five new notifications, in order: submitted, in review, approved, reopened, approved.'], img: INF, alt: 'Citizen dashboard with notifications showing the case being reopened for another review' },
        { h: 'What this proves', p: ['The decision, the check, the second review and the notice are all linked and recorded.'], tone: 'ok' },
      ],
      say: [['OBI', 'Step six: the citizen is told. The dashboard shows each step as a notification, including that the case was reopened for another review.'], ['OGE', 'So what does that prove?'], ['OBI', 'That the decision, the check, the second review and the notice are linked and recorded, and that a failure is caught rather than hidden. The citizen sees only the events meant for the applicant; internal notes stay with case managers.']] },
    { title: 'What this does and does not show', cols: 3,
      tiles: [
        { h: 'Shown', p: ['One outcome, end to end, with its failure path, on synthetic data.'], tone: 'ok' },
        { h: 'Not shown', p: ['Real applicants, real policy, or a live public site. The Render site was deleted on 2026-11-06.'], tone: 'no' },
        { h: 'Where to see more', p: ['Run it locally from the repository: docs/RUN-LOCALLY.md.'] },
      ],
      say: [['OBI', 'What this shows: one outcome, end to end, with its failure path, on synthetic data. What it does not show: real applicants, real policy, or a live public site. The Render site was deleted on 6 November 2026.'], ['OGE', 'How do I see more?'], ['OBI', 'Run it locally from the repository. The steps are in RUN-LOCALLY dot m d. Thank you.']] },
  ],
};

// ---------- 3. AI visual presentation (about 4 minutes, readable with sound off) ----------
const visual = {
  title: 'Selective Service rehearsal · AI visual presentation', kicker: 'AI visual presentation · Selective Service rehearsal',
  slides: [
    { title: 'Every decision shows its reason, and a person can overrule it', lede: R, cols: 3,
      tiles: [
        { h: 'Claim 1', p: ['A citizen sees why, not just what.'] },
        { h: 'Claim 2', p: ['A failed check goes to a second person.'], tone: 'warn' },
        { h: 'Claim 3', p: ['The AI answers from cited policy and never decides.'], tone: 'ok' },
      ],
      say: [['OBI', "I'm OBI. This is a visual argument with three claims, and every claim is a screen. This is a Colaberry rehearsal on synthetic data, not connected to the real Selective Service System."], ['OGE', 'What are the three claims?'], ['OBI', 'Claim one: a citizen sees why, not just what. Claim two: a failed check goes to a second person. Claim three: the AI answers from cited policy and never decides.']] },
    { title: 'Claim 1: the citizen sees why', cols: 2,
      tiles: [
        { h: 'Eligibility with reasons', p: ['Type A eligible: applicant is 65 or older. B and C: not eligible, with the reason.'], img: ELIG, alt: 'Eligibility results with reasons' },
        { h: 'Denial with its reason', p: ['Denied: proof of age was not provided. Appeal button shown.'], img: DENY, alt: 'Denied case with reason and appeal', tone: 'no' },
      ],
      say: [['OBI', 'Claim one. On the left, the eligibility check: eligible because the applicant is sixty-five or older, and a reason for each type that is not.'], ['OBI', 'On the right, a denial. It names its reason, proof of age was not provided, and offers an appeal.'], ['OGE', 'Is that the whole point?'], ['OBI', 'Yes. Nobody should have to guess why. The reason is on the screen, in plain words.']] },
    { title: 'Claim 2: a failed check goes to a second person', cols: 2,
      tiles: [
        { h: 'Review open', p: ['Two controls failed. Another case manager must justify the outcome.'], img: REV, alt: 'Compliance review with two failed controls and a justification box', tone: 'no' },
        { h: 'Dashboard alert', p: ['66.67% against a 99% target. One open review.'], img: CHK, alt: 'Compliance dashboard below target' },
      ],
      say: [['OBI', 'Claim two. On the left, a review that is open because two controls failed. Another case manager must justify the outcome in writing.'], ['OBI', 'On the right, the dashboard. Sixty-six point six seven percent against a ninety-nine percent target, so the alert is red, and one review is open. The system raises its own hand.']] },
    { title: 'Claim 3: the AI answers from cited policy', cols: 2,
      tiles: [
        { h: 'A cited answer', p: ['Numbered citations that open the quoted policy text. The policy is synthetic.'], img: ANS, alt: 'Policy assistant answer with two numbered citations and their quoted passages', tone: 'ok' },
        { h: 'The review queue', p: ['Personal questions and answers that fail the check wait for a case manager.'], img: RQ, alt: 'Assistant Reviews queue with a reported answer and a withheld personal question', tone: 'warn' },
      ],
      say: [['OBI', 'Claim three. On the left, a cited answer. The assistant answers only from the policy passages, with numbered citations that open the quoted text.'], ['OGE', 'And what about a personal question?'], ['OBI', "On the right, the review queue. A question about a person's own case is withheld and waits for a case manager. The assistant never decides eligibility. Twenty questions an hour per person, and a daily cap, keep it bounded."]] },
    { title: 'Is the AI drifting, and is it fair?', cols: 2,
      tiles: [
        { h: 'Quality signals', p: ['Last 7 days against the 28 before. Drift flagged. Fixture data.'], img: DRIFT, alt: 'AI quality signals with drift flagged, fixture data', tone: 'warn' },
        { h: 'Fairness check', p: ['Same passages for the same question, whatever the name or wording. Fixture data.'], img: FAIR, alt: 'Fairness page with the counterfactual check and four-fifths rule, fixture data', tone: 'ok' },
      ],
      say: [['OBI', 'Two checks on the AI itself. On the left, quality signals: the last seven days against the twenty-eight before, with drift flagged. This screen uses fixture data to show the alert.'], ['OBI', 'On the right, the fairness check: the same question must find the same passages, whatever name or wording is used. Also fixture data. The live evaluation scored one hundred percent in October, on thirty-three questions.']] },
    { title: 'The people who run it see only what they need', cols: 3,
      tiles: [
        { h: 'Case manager', p: ['My Work: open cases, waiting on me, overdue.'], img: MY, alt: 'Case manager dashboard' },
        { h: 'Administrator', p: ['Access Policies: switch rules, with a reason.'], img: POL, alt: 'Access policies page' },
        { h: 'Leadership', p: ['Totals and trends. No applicant data.'], img: LEAD, alt: 'Leadership dashboard with KPIs and trends' },
      ],
      say: [['OBI', 'Each role sees only what it needs. The case manager has My Work: open cases, what is waiting on them, and what is overdue.'], ['OBI', 'The administrator has Access Policies, where rules are switched on and off with a reason. Leadership has totals and trends, with no applicant data. A rule stops a case manager opening a case assigned to someone else.']] },
    { title: 'The checks behind the screens', cols: 2,
      tiles: [
        { h: 'Attack suite', p: ['52 of 52 checks pass: sign-in bypass, tampered tokens, records of other people, injection.'], img: ATK, alt: 'Attack suite results, 52 of 52 checks pass', tone: 'ok' },
        { h: 'Database outage', p: ['22 of 22 checks: the API stays up without its database and recovers by itself.'], img: OUT, alt: 'Database outage results, 22 of 22 checks pass', tone: 'ok' },
      ],
      say: [['OGE', 'How do we know the screens are not just pictures?'], ['OBI', 'Because scripts attack and break the system on purpose. On the left, the attack suite: fifty-two of fifty-two checks pass, covering sign-in bypass, tampered tokens, records belonging to other people, and injection.'], ['OBI', 'On the right, the database outage check: twenty-two of twenty-two. The API stays up without its database and recovers by itself. These are our own tests, not independent ones.']] },
    { title: 'Sign-in protects it, and the limits are plain', cols: 2,
      tiles: [
        { h: 'Two-step sign-in', p: ['An authenticator app, a 6-digit code, and ten one-time recovery codes.'], img: MFA, alt: 'Authenticator setup with a QR code and key', tone: 'ok' },
        { h: 'What this does not prove', p: ['No real applicants or policy. No independent security test. No hands-on screen-reader test.'], tone: 'no' },
      ],
      say: [['OBI', 'Sign-in is protected by two steps: an authenticator app and a six-digit code, with ten one-time recovery codes.'], ['OGE', 'What does the argument not prove?'], ['OBI', 'That it works on real applicants or real policy. There has been no independent security test and no hands-on screen-reader test. Everything you saw is on synthetic data. Thank you.']] },
  ],
};

// ---------- 4. Stakeholder update (about 2.5 minutes, to Ali) ----------
const update = {
  title: 'Selective Service rehearsal · Stakeholder update', kicker: 'Stakeholder update · Selective Service rehearsal',
  slides: [
    { title: 'What moved', lede: R, cols: 3,
      tiles: [
        { h: 'Wound down', p: ['The hosted demo was deleted on 2026-11-06. Running cost is zero.'], tone: 'ok' },
        { h: 'Proved from a clean clone', p: ['1,737 unit tests passed and 28 migrations applied on an empty database.'], tone: 'ok' },
        { h: 'Closed', p: ['Final update posted on the Daily Progress Tracker, 2026-11-10.'], tone: 'ok' },
      ],
      say: [['OBI', "Ali, I'm OBI. This is the Selective Service rehearsal update: what moved, what is stuck, and the one decision. It is a Colaberry rehearsal on synthetic data."], ['OGE', 'What moved?'], ['OBI', 'We wound it down. The hosted demo was deleted on 6 November, so the running cost is zero. Before that we proved the build from a clean clone: seventeen hundred and thirty-seven unit tests passed and all twenty-eight migrations applied on an empty database. And the final update is posted on the Daily Progress Tracker. Nothing more is being built on it.']] },
    { title: 'What it cost and what it left', cols: 3,
      tiles: [
        { h: 'Cost', p: ['Database $6 a month while hosted. Last charge $1.12. Now zero.'], tone: 'ok' },
        { h: 'Left behind', p: ['A public repository that runs locally, the evidence packs, the drills, and the readiness review.'], tone: 'ok' },
        { h: 'Not left behind', p: ['A live site, a launch approval, or any real data.'], tone: 'no' },
      ],
      say: [['OGE', 'What did it cost, and what is left?'], ['OBI', 'The database cost six dollars a month while hosted, the last charge was one dollar twelve, and the cost is now zero.'], ['OBI', 'What is left: a public repository that runs locally, the evidence packs, the drills and the readiness review. What is not left: a live site, a launch approval, or any real data.']] },
    { title: 'What is stuck', cols: 3,
      tiles: [
        { h: 'The portal card', p: ['"Rehearsal demo": 0 of 6 tasks, not syncing to GitHub. We asked on 2026-11-06 whether to remove it.'], tone: 'warn' },
        { h: 'Dead links', p: ['The deck and briefing describe the Render site. Their live links no longer answer.'], tone: 'warn' },
        { h: 'Open gaps, parked', p: ['No screen-reader test, no independent security test, no authority to operate.'], tone: 'no' },
      ],
      say: [['OGE', 'What is stuck?'], ['OBI', 'Three things. The portal card for the rehearsal still shows zero of six tasks and not syncing to GitHub. We asked on 6 November whether to remove it.'], ['OBI', 'Second, the deck and the briefing describe the Render site, and their live links no longer answer. Third, the open gaps are parked: no screen-reader test, no independent security test, and no authority to operate. None of these blocks the case study; they only block a real launch.']] },
    { title: 'The one decision: Option A, chosen', cols: 2,
      tiles: [
        { h: 'Option A (recommended, chosen)', p: ['Accept the Selective Service rehearsal as a completed case study, with its working assumptions documented.'], tone: 'ok' },
        { h: 'Option B (not chosen)', p: ['Hold it open until the gaps are closed.'], tone: 'no' },
      ],
      say: [['OBI', 'The one decision. Option A, which I recommended: accept the Selective Service rehearsal as a completed case study, with its working assumptions documented. Option B was to hold it open.'], ['OGE', 'Which one was chosen?'], ['OBI', 'Option A. The owner has chosen it. So there is nothing left to approve; I ask only that you record it, and the next work moves to Crash Records, with the ship-by date of 24 November. Thank you.']] },
  ],
};

// ---------- shared slide content for the showcase (5) and Demo Day (6) ----------
const sStory = (cond) => ({ title: 'The story: a decision a citizen can follow', lede: R, cols: 3,
  tiles: [
    { h: 'The problem', p: ['Exemption decisions that nobody can explain, check or appeal.'] },
    { h: 'What we built', p: ['46 stories in 4 releases: registration to go-live review.', 'All 46 addressed; 45 working, one written and not applied.'], tone: 'ok' },
    { h: 'What it is', p: ['A rehearsal that was never submitted. Synthetic data only.'], tone: 'warn' },
  ],
  say: cond
    ? [['OBI', "I'm OBI. This is a Colaberry rehearsal case study of Selective Service modernization, on synthetic data and never connected to the real system."], ['OGE', 'What problem?'], ['OBI', 'Exemption decisions that nobody can explain, check or appeal. We built forty-six stories in four releases, all addressed: forty-five working, and one written as code and never applied.']]
    : [['OBI', "I'm OBI. This is the final showcase of a Colaberry rehearsal case study: Selective Service modernization, on synthetic data. It was never submitted and is not connected to the real system."], ['OGE', 'What problem did it solve?'], ['OBI', 'Exemption decisions that nobody can explain, check or appeal.'], ['OGE', 'And what was built?'], ['OBI', 'Forty-six stories in four releases, from registration to a go-live review. All forty-six are addressed: forty-five are working, and one is written as code and was never applied. The one it describes is the cloud setup.']] });

const sProof = { title: 'Proof: the failure path, end to end', cols: 2,
  tiles: [
    { h: 'A denial gives its reason', p: ['Proof of age was not provided. The citizen can appeal.'], img: DENY, alt: 'Denied case with reason and appeal', tone: 'no' },
    { h: 'A failed check goes to a second person', p: ['Two controls failed. A different case manager must justify the outcome.'], img: REV, alt: 'Compliance review with two failed controls', tone: 'warn' },
  ],
  say: [['OBI', 'Proof. A denial gives its reason: proof of age was not provided, and the citizen can appeal.'], ['OGE', 'And when a decision is wrong?'], ['OBI', 'A failed check goes to a second person. Here two controls failed, so a different case manager must justify the outcome in writing. That is recorded in the audit log.']] };

const sProof2 = { title: 'Proof: the record, and the AI kept in its lane', cols: 2,
  tiles: [
    { h: 'The audit trail', p: ['Every failed control with its evidence. The audit log is write-once and kept 7 years.'], img: AUD, alt: 'Compliance audit log with two failed controls', tone: 'ok' },
    { h: 'A cited answer', p: ['The assistant answers from synthetic policy with citations, and never decides eligibility.'], img: ANS, alt: 'Policy assistant answer with citations', tone: 'ok' },
  ],
  say: [['OBI', 'More proof. The audit trail: every failed control with its evidence. The database itself refuses to change or delete the log, and each entry is kept for seven years.'], ['OGE', 'Where is the AI?'], ['OBI', 'A cited answer. The assistant answers only from synthetic policy passages, with numbered citations, and it never decides eligibility.']] };

const sWho = { title: 'Who decides what', cols: 3,
  tiles: [
    { h: 'The system decides alone', p: ['Whether a rule-based eligibility result applies.', 'Whether a decision passed its eight controls.'], tone: 'ok' },
    { h: 'People decide', p: ['Every approval, denial and override.', 'Who gets staff access, with a reason.', 'Reviews of answers the assistant withheld.'], tone: 'warn' },
    { h: 'Nobody delegates', p: ['The assistant never decides eligibility.', 'A decider never reviews their own decision.'], tone: 'no' },
  ],
  say: [['OGE', 'Where is the line between the machine and people?'], ['OBI', 'The system decides alone only whether a rule-based eligibility result applies, and whether a decision passed its eight controls.'], ['OBI', 'People decide every approval, denial and override, who gets staff access with a reason, and the review of any answer the assistant withheld.'], ['OBI', 'And two things are never delegated: the assistant never decides eligibility, and a decider never reviews their own decision.']] };

const sMeasured = (cond) => ({ title: 'Measured, derived and not measured', cols: 3,
  tiles: [
    { h: 'Measured', p: ['1,737 unit tests; 28 migrations on an empty database.', 'Attack suite 52 of 52.', 'AI evaluation 33 of 33; fairness 60 of 60 pairs.', 'Rollback 32 s; restore 10.5 s.'], tone: 'ok' },
    { h: 'Derived or estimate', p: ['Sizing for 10,000 users is derived.', 'GovCloud cost about $5,850 a month, plus or minus 40%: an estimate.'], tone: 'warn' },
    { h: 'Not measured', p: ['Real users. Load past 128 connections. A screen-reader user. An independent security test.'], tone: 'no' },
  ],
  say: cond
    ? [['OBI', 'Measured: seventeen hundred and thirty-seven unit tests, an attack suite of fifty-two of fifty-two, an AI evaluation of thirty-three of thirty-three, and a rollback in thirty-two seconds.'], ['OBI', 'Derived or estimate: the sizing for ten thousand users, and the cloud cost. Not measured: real users, load past one hundred and twenty-eight connections, and any independent test.']]
    : [['OGE', 'Which numbers can I trust?'], ['OBI', 'Measured: seventeen hundred and thirty-seven unit tests, twenty-eight migrations on an empty database, an attack suite of fifty-two of fifty-two, an AI evaluation of thirty-three of thirty-three, fairness on sixty of sixty pairs, a rollback in thirty-two seconds, and a restore in ten and a half.'], ['OBI', 'Derived or estimate: the sizing for ten thousand users is derived, and the cloud cost of about fifty-eight hundred and fifty dollars a month is an estimate, plus or minus forty percent.'], ['OBI', 'Not measured: real users, load past one hundred and twenty-eight connections, a screen-reader user, and an independent security test.']] });

const sLimits = (cond) => ({ title: 'The limits, plainly', cols: 2,
  tiles: [
    { h: 'No real anything', p: ['Synthetic data. The exemption rules are illustrative, not Selective Service policy.'], tone: 'no' },
    { h: 'Production is a no-go', p: ['Ten go/no-go criteria are not met. AWS GovCloud is closed: the code is written, never applied.'], tone: 'no' },
    { h: 'One operator', p: ['No staging, one environment, no second region. The hosted site is retired.'], tone: 'warn' },
    { h: 'Our own testing', p: ['Security and accessibility are our assessments, not independent ones.'], tone: 'warn' },
  ],
  say: cond
    ? [['OBI', 'The limits, plainly. No real data and no real policy: the exemption rules are illustrations. Production is a no-go: the ten criteria are not met and the cloud code was never applied. And security and accessibility are our own assessments.']]
    : [['OGE', 'What are the limits?'], ['OBI', 'No real anything. It is synthetic data, and the exemption rules are illustrative, not Selective Service policy.'], ['OBI', 'Production is a no-go. The ten criteria are not met, and AWS GovCloud is closed, so that code was written but never applied.'], ['OBI', 'It had one operator, no staging and no second region, and the hosted site is retired. And our security and accessibility results are our own testing, not independent.']] });

const sDecision = { title: 'Next decision: Option A, chosen', cols: 2,
  tiles: [
    { h: 'Option A (recommended, chosen)', p: ['Accept the rehearsal as a completed case study, with its working assumptions documented.'], tone: 'ok' },
    { h: 'Option B (not chosen)', p: ['Hold it open until the open gaps are closed.'], tone: 'no' },
  ],
  say: [['OBI', 'The next decision was between two options. Option A: accept the rehearsal as a completed case study, with its working assumptions documented. Option B: hold it open until the gaps are closed.'], ['OGE', 'Which did the owner pick?'], ['OBI', 'Option A. It is chosen. The gaps stay listed, and the next work moves to Crash Records.']] };

const sTempted = { title: 'The limit I was tempted to leave out', cols: 2,
  tiles: [
    { h: 'The 10,000-user number', p: ['It is a clean headline, and it is derived, not measured.'], tone: 'warn' },
    { h: 'What was measured', p: ['No request failed at any step up to 128 connections on one laptop. One live run: 25 connections for 60 seconds, p95 1.24 s, 0 errors.'], tone: 'ok' },
  ],
  say: [['OGE', 'Which limit were you tempted to leave out?'], ['OBI', 'The ten-thousand-user number. It is a clean headline, and it is derived, not measured.'], ['OBI', 'What we measured is smaller: no request failed at any step up to one hundred and twenty-eight connections on one laptop, and one live run of twenty-five connections for sixty seconds gave a p95 of one point two four seconds with no errors. I left the headline in the sizing document, labelled derived. Thank you.']] };

const sBuilt = { title: 'How it was built: four releases', cols: 4,
  tiles: [
    { h: 'R0 Walking skeleton', p: ['Registration, profile, two-step sign-in, data status. The cloud story is written, not applied.'], tone: 'warn' },
    { h: 'R1 Core', p: ['Eligibility, cases, compliance, freshness, audit, accessibility, dashboards, access policies. 11 of 11.'], tone: 'ok' },
    { h: 'R2 AI and governance', p: ['Policy assistant, oversight, drift, fairness, observability. 11 of 11.'], tone: 'ok' },
    { h: 'R3 Scale and launch', p: ['Load, outage survival, security testing, training, readiness review. 17 of 17.'], tone: 'ok' },
  ],
  say: [['OGE', 'How was it built?'], ['OBI', 'In four releases. R0, the walking skeleton: registration, profile, two-step sign-in and data status. Its cloud story is written, not applied.'], ['OBI', 'R1, the core: eligibility, cases, compliance, freshness, the audit log, accessibility, dashboards and access policies. Eleven of eleven.'], ['OBI', 'R2, AI and governance: the policy assistant, human oversight, drift, fairness and observability. Eleven of eleven. And R3, scale and launch: load, outage survival, security testing, training and the readiness review. Seventeen of seventeen.']] };

const sFound = { title: 'What our own review found', cols: 3,
  tiles: [
    { h: 'A check that could not fail', p: ['The old "immutable" audit table used CHECK (true). Replaced by database triggers.'], tone: 'no' },
    { h: 'A sign-in redeemed twice', p: ['A pending two-step sign-in could be used twice. Now single use.'], tone: 'no' },
    { h: 'A service that did nothing', p: ['An "API governance" service claimed to enforce policy but never ran. It was removed.'], tone: 'warn' },
  ],
  say: [['OGE', 'Did you find problems in your own work?'], ['OBI', 'Yes, and we said so. The old immutable audit table used CHECK true, a check that cannot fail. It was replaced by database triggers.'], ['OBI', 'A pending two-step sign-in could be redeemed twice; it is now single use, and a test reproduces the gap. And a so-called API governance service claimed to enforce policy but never ran, so it was removed. A check that cannot fail is worse than no check.']] };

const sCost = { title: 'What it cost to run', cols: 3,
  tiles: [
    { h: 'Hosting', p: ['Database $6 a month while hosted. Final charge $1.12. Running cost is now zero.'], tone: 'ok' },
    { h: 'AI, per run', p: ['An evaluation costs about 30 cents, a fairness run about 70 cents: estimates from the runbook.'], tone: 'warn' },
    { h: 'AI, capped', p: ['300 AI answers a day, and a daily spend objective of $2 by default.'], tone: 'ok' },
  ],
  say: [['OGE', 'And what did it cost to run?'], ['OBI', 'Hosting: the database was six dollars a month and the final charge was one dollar twelve. The running cost is now zero.'], ['OBI', 'The AI is capped. A quality evaluation costs about thirty cents and a fairness run about seventy, which are estimates from the runbook. Answers are limited to three hundred a day, with a default spend objective of two dollars a day.']] };

const showcase = {
  title: 'Selective Service rehearsal · Final showcase', kicker: 'Final showcase · Selective Service rehearsal',
  slides: [sStory(false), sBuilt, sProof, sProof2, sFound, sWho, sMeasured(false), sCost, sLimits(false), sDecision, sTempted],
};

// ---------- 6. Demo Day: condensed showcase (about 5 minutes) then Q&A ----------
const qa = (n, qs) => ({ title: `Audience questions, part ${n}`, cols: qs.length,
  tiles: qs.map((q) => ({ h: q.h, p: q.p, tone: q.tone })),
  say: qs.flatMap((q) => q.say) });
const demoDay = {
  title: 'Selective Service rehearsal · Demo Day', kicker: 'Demo Day · Selective Service rehearsal',
  slides: [
    sStory(true), sProof, sProof2, sFound, sWho, sMeasured(true), sLimits(true), sDecision,
    qa(1, [
      { h: 'Is this the real Selective Service?', p: ['No. A Colaberry rehearsal on synthetic data, never submitted.'], tone: 'no',
        say: [['OGE', 'Is this connected to the real Selective Service System?'], ['OBI', 'No. It is a Colaberry rehearsal on synthetic data. It was never submitted and is not connected to the real system. The framework and the readiness review both say so.']] },
      { h: 'Does the AI decide who is exempt?', p: ['No. Rules give a result; case managers decide. The assistant never decides eligibility.'], tone: 'ok',
        say: [['OGE', 'Does the AI decide who is exempt?'], ['OBI', 'No. Fixed rules give an eligibility result and case managers decide cases. The assistant only answers policy questions from eight synthetic documents, with citations, and it never decides eligibility.']] },
    ]),
    qa(2, [
      { h: 'Can I see it live?', p: ['The hosted site was deleted on 2026-11-06. It runs locally: docs/RUN-LOCALLY.md.'], tone: 'warn',
        say: [['OGE', 'Can I see it live?'], ['OBI', 'Not on the internet. The hosted site was deleted on 6 November 2026. It runs locally from a clean checkout, and the steps are in RUN-LOCALLY dot m d.']] },
      { h: 'How do you know the numbers?', p: ['Each is labelled measured, derived or assumed. Sizing for 10,000 users is derived.'], tone: 'ok',
        say: [['OGE', 'How do you know the numbers?'], ['OBI', 'Each is labelled measured, derived or assumed in the sizing document. The ten-thousand-user figure is derived. The unit tests and the evaluation were run, and their results are committed in the repository.']] },
    ]),
    qa(3, [
      { h: 'What would going live take?', p: ['Ten go/no-go criteria, an independent penetration test, a screen-reader test, real authority to operate. AWS GovCloud is closed.'], tone: 'no',
        say: [['OGE', 'What would it take to go live?'], ['OBI', 'The readiness review says a launch is a no-go today. It lists ten go/no-go criteria, an independent penetration test, a hands-on screen-reader test, and an authority to operate. AWS GovCloud is closed, so that code was never applied. Thank you.']] },
    ]),
  ],
};

// ---------- 7. Architecture review (about 4 minutes) ----------
const arch = {
  title: 'Selective Service rehearsal · Architecture review', kicker: 'Architecture review · Selective Service rehearsal',
  slides: [
    { title: 'What I chose, what I rejected, and what would change my mind', lede: R, cols: 4,
      tiles: [
        { h: 'Stack', p: ['React and Vite on the front, Node, Express and TypeScript behind.'] },
        { h: 'Database', p: ['One PostgreSQL database. Migrations, forward only.'] },
        { h: 'Sign-in', p: ['Passwords, two-step codes, and policy checks on every request.'] },
        { h: 'Audit and deployment', p: ['A write-once audit log. Hosted, then local.'] },
      ],
      say: [['OBI', "I'm OBI. This is the architecture review of the Selective Service rehearsal: five choices, what I rejected, and what would change my mind. It is a Colaberry rehearsal on synthetic data."], ['OGE', 'Start with the stack.']] },
    { title: 'Choice 1: the stack', cols: 3,
      tiles: [
        { h: 'Chosen', p: ['React 18, Vite and Tailwind. Node, Express and TypeScript. One deployable API.'], tone: 'ok' },
        { h: 'Rejected', p: ['LangChain and LangSmith for the assistant. Claude through the official SDK instead, with native citations.'], tone: 'no' },
        { h: 'Price paid', p: ['No frontend unit tests. The pages are checked end to end by scripts.'], tone: 'warn' },
      ],
      say: [['OBI', 'First choice, the stack. React, Vite and Tailwind in front, and Node, Express and TypeScript behind, as one deployable API.'], ['OGE', 'What did you turn down?'], ['OBI', 'LangChain and LangSmith for the assistant. I used Claude through the official SDK with its native citations instead. The price: there are no frontend unit tests, so the pages are checked end to end by scripts.']] },
    { title: 'Choice 2: one PostgreSQL database, no cache', cols: 3,
      tiles: [
        { h: 'Chosen', p: ['PostgreSQL only. 28 migrations apply by themselves on start, in order, forward only.'], tone: 'ok' },
        { h: 'Rejected', p: ['Redis and Elasticsearch, which the day-one plan named. A cache for data status: every page reads the database directly.'], tone: 'no' },
        { h: 'Price paid', p: ['No down migrations. A rollback of code does not undo a migration.'], tone: 'warn' },
      ],
      say: [['OBI', 'Second choice, the database. PostgreSQL only. Twenty-eight migrations apply by themselves on start, forward only.'], ['OGE', 'What about the cache?'], ['OBI', 'Rejected. The day-one plan named Redis and Elasticsearch, and neither was built. Every page reads the database directly, so data is never older than the read. The price: there are no down migrations, so rolling code back does not undo a migration.']] },
    { title: 'Choice 3: sign-in, two-step codes and policy checks', cols: 3,
      tiles: [
        { h: 'Chosen', p: ['Hashed passwords and a one-hour token. A 6-digit authenticator code, used once, 5 tries.', 'Open Policy Agent decides every request first.'], tone: 'ok' },
        { h: 'Rejected', p: ['Roles from an email list. Roles are now given in the app, with a reason, and a role is never cached between requests.'], tone: 'no' },
        { h: 'Accepted risk', p: ['Tokens in browser storage. Production should use HttpOnly cookies.'], tone: 'warn' },
      ],
      say: [['OBI', 'Third choice, sign-in. Passwords and Social Security numbers are hashed, and the token lasts an hour. After the password, a six-digit authenticator code, used once, with five tries. Then Open Policy Agent decides every request before any route runs, and it can only narrow what the code allows.'], ['OGE', 'What did you reject?'], ['OBI', 'Roles from an email list. Roles are now given in the app, with a reason, and a role is never cached between requests. One accepted risk: tokens sit in browser storage. Production should use HttpOnly cookies.']] },
    { title: 'Choice 4: an audit log the database protects', cols: 3,
      tiles: [
        { h: 'Chosen', p: ['The database refuses update, delete and truncate on the log. Kept 7 years. Secrets removed before writing.'], tone: 'ok' },
        { h: 'Rejected', p: ['A constraint that cannot fail. The first "immutable" table used CHECK (true).'], tone: 'no' },
        { h: 'Still open', p: ['A database superuser could disable the triggers. Production needs an append-only copy, which was never built.'], tone: 'warn' },
      ],
      say: [['OBI', 'Fourth choice, the audit log. The database itself refuses to update, delete or truncate it. Entries are kept seven years, and secrets are removed before writing.'], ['OGE', 'What did you reject?'], ['OBI', 'A constraint that cannot fail. The first immutable table used CHECK true, and a check that cannot fail is worse than no check. Still open: a database superuser could disable the triggers, so production needs an append-only copy, which was never built.']] },
    { title: 'Choice 5: deployment, hosted and then local', cols: 3,
      tiles: [
        { h: 'Chosen', p: ['Render for the demo, from 2026-08-31 to its deletion on 2026-11-06. Then a local run from a clean checkout.'], tone: 'ok' },
        { h: 'Rejected', p: ['Local Docker, because the machine blocked it. And applying AWS GovCloud, which is closed.'], tone: 'no' },
        { h: 'Written, not applied', p: ['GovCloud infrastructure as code is formatted and validated. About $5,850 a month, an estimate.'], tone: 'warn' },
      ],
      say: [['OBI', 'Fifth choice, deployment. Render for the demo, until it was deleted on 6 November 2026, and now a local run from a clean checkout.'], ['OGE', 'And the cloud code?'], ['OBI', 'Written, formatted and validated for AWS GovCloud, but never applied: GovCloud is closed. The cost of about fifty-eight hundred and fifty dollars a month is an estimate. Local Docker was rejected because the machine blocked it.']] },
    { title: 'What would change my mind', cols: 4,
      tiles: [
        { h: 'Real applicants', p: ['Then cookies for sessions, an append-only audit copy, and an independent test.'], tone: 'warn' },
        { h: 'Real load', p: ['Past 128 connections, measure again on a production-like stack.'], tone: 'warn' },
        { h: 'A real cloud', p: ['Then apply the infrastructure code after a plan and an approval.'], tone: 'warn' },
        { h: 'A real model risk', p: ['If answers drift, the quality alerts say so, and the model can be turned off.'], tone: 'warn' },
      ],
      say: [['OGE', 'So what would change your mind?'], ['OBI', 'Four things. Real applicants: then cookies for sessions, an append-only audit copy, and an independent test. Real load: past one hundred and twenty-eight connections I would measure again on a production-like stack.'], ['OBI', 'A real cloud: then apply the infrastructure code after a plan and an approval. And model risk: if answers drift, the quality alerts say so, and one setting turns the model off.']] },
    { title: 'The choice I am least sure of', cols: 2,
      tiles: [
        { h: 'Tokens in browser storage', p: ['Right for synthetic data. Wrong the day a real applicant signs in.'], tone: 'warn' },
        { h: 'What protects it', p: ['Sign-out ends the session on the server. Throttling and one-time recovery codes. Our own testing: attack suite 52 of 52.'], tone: 'ok' },
      ],
      say: [['OGE', 'Which choice are you least sure of?'], ['OBI', 'Tokens in browser storage. Right for synthetic data, wrong the day a real applicant signs in. What protects it today: sign-out ends the session on the server, sign-in is throttled, and the attack suite passes fifty-two of fifty-two. That is our own testing, not independent. Thank you.']] },
  ],
};

// ---------- 8. Client handoff (about 3.5 minutes) ----------
const handoff = {
  title: 'Selective Service rehearsal · Client handoff', kicker: 'Client handoff · Selective Service rehearsal',
  slides: [
    { title: 'Run it, find it, fix it', lede: R, cols: 3,
      tiles: [
        { h: 'Run it', p: ['Postgres, a build, a start. The hosted site is retired, so it runs locally.'] },
        { h: 'Where things live', p: ['Backend, frontend, scripts, docs.'] },
        { h: 'When it misbehaves', p: ['What to check first, and what the new owner owns.'], tone: 'warn' },
      ],
      say: [['OBI', "I'm OBI. This is the handoff of the Selective Service rehearsal: how to run it locally, where things live, and what to do when it misbehaves. It is on synthetic data, and the hosted site is retired."], ['OGE', "I'm the new owner. Where do I start?"]] },
    { title: 'Run it locally', cols: 3,
      tiles: [
        { h: '1. You need', p: ['Node 20 or later, and npm.', 'PostgreSQL 14 or later on localhost port 5432.', 'On Windows, clone to a short path.'] },
        { h: '2. Build and test', p: ['Clone the public repository, then in backend: npm ci, npm run build, npx jest.', 'Then npm ci in frontend.'], tone: 'ok' },
        { h: '3. Start the API', p: ['createdb sss_demo, then npm start in backend.', 'It applies all 28 migrations itself.'] },
      ],
      say: [['OBI', 'Run it locally. You need Node twenty or later, and PostgreSQL fourteen or later on port fifty-four thirty-two. On Windows, clone to a short path.'], ['OGE', 'And then?'], ['OBI', 'Clone the public repository. In the backend folder run npm c i, npm run build, and npx jest. Then npm c i in the frontend. Create the database called sss demo, and run npm start in the backend. It applies all twenty-eight migrations by itself.']] },
    { title: 'Settings are environment variables, set by name', cols: 3,
      tiles: [
        { h: 'Database', p: ['DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD.', 'The local defaults are development values only.'] },
        { h: 'First staff', p: ['CASE_MANAGER_EMAILS and ADMIN_EMAILS set up the first case manager and administrator.'], tone: 'ok' },
        { h: 'Secrets and AI', p: ['JWT_SECRET signs sign-in tokens. ANTHROPIC_API_KEY turns on AI answers; without it the assistant shows policy passages.', 'Never paste a value anywhere.'], tone: 'warn' },
      ],
      say: [['OBI', 'Settings are environment variables, and I give only their names. The database uses DATABASE HOST, PORT, NAME, USER and PASSWORD. The local defaults are for development only.'], ['OBI', 'CASE MANAGER EMAILS and ADMIN EMAILS set up the first staff. JWT SECRET signs the tokens. ANTHROPIC API KEY turns on AI answers; without it, the assistant shows policy passages. Never paste a value into a chat or a ticket.']] },
    { title: 'Load synthetic data, then open the site', cols: 3,
      tiles: [
        { h: 'Load data', p: ['From the project folder, run the end-to-end scripts in scripts/e2e: access, workflow, compliance, dashboards, training.', 'They refuse to run on anything but localhost.'] },
        { h: 'Open the site', p: ['In frontend, npm run dev. Open localhost port 5173.'], tone: 'ok' },
        { h: 'Trap', p: ['Do not follow the local-run section of the README. It dates from before the build and mentions Redis and Docker.'], tone: 'no' },
      ],
      say: [['OBI', 'To load synthetic data, run the end-to-end scripts in scripts slash e2e: access, workflow, compliance, dashboards and training. They refuse to run on anything but localhost. Then npm run dev in the frontend, and open localhost, port fifty-one seventy-three.'], ['OGE', 'Anything that trips people up?'], ['OBI', 'Yes. Do not follow the local-run section of the README. It dates from before the build and mentions Redis and Docker, which this project does not use. Use RUN-LOCALLY dot m d.']] },
    { title: 'Where things live', cols: 4,
      tiles: [
        { h: 'backend/src', p: ['The API: routes, services, security, and the migrations.'] },
        { h: 'frontend/src', p: ['The React pages for each role.'] },
        { h: 'scripts/', p: ['End-to-end, accessibility, load and attack checks.'], tone: 'ok' },
        { h: 'docs/', p: ['Runbook, incident playbook, readiness review, evidence.'], tone: 'warn' },
      ],
      say: [['OBI', 'Four places. backend slash src holds the API: routes, services, security and the migrations. frontend slash src holds the pages for each role.'], ['OBI', 'scripts holds the end-to-end, accessibility, load and attack checks. And docs holds the runbook, the incident playbook, the readiness review and the evidence.']] },
    { title: 'When it misbehaves', cols: 3,
      tiles: [
        { h: 'Check health first', p: ['Open /health on the API. database "ok", "down" or "starting".', 'Down: data routes answer 503 and recover by themselves.'], tone: 'warn' },
        { h: 'Read the alerts', p: ['Administrators open Observability. Each alert has a runbook entry in docs/RUNBOOK-ALERTS.md.'] },
        { h: 'Sign-in failures', p: ['"Invalid token" often means an expired token or a wrong JWT_SECRET. The older troubleshooting guide is a day-one document; trust the runbook.'], tone: 'no' },
      ],
      say: [['OGE', 'What if it misbehaves?'], ['OBI', 'Check health first. Open slash health on the API and read the database value: ok, down or starting. When it is down, data routes answer five oh three and recover by themselves when the database returns.'], ['OBI', 'Then administrators open the Observability page. Each alert has a runbook entry. For sign-in failures, an invalid token often means an expired token or a wrong JWT SECRET.'], ['OBI', 'The older troubleshooting guide is a day-one document that describes AWS and Redis. Trust the operator runbook and the incident playbook.']] },
    { title: 'What the new owner owns', cols: 3,
      tiles: [
        { h: 'You own', p: ['The tests, the migrations, the access rules and the runbook.', 'Every new route needs its access rule in the same change.'], tone: 'ok' },
        { h: 'You do not own', p: ['Real applicants, real policy, or any claim of production. This is a case study.'], tone: 'no' },
        { h: 'Open gaps, parked', p: ['A hands-on screen-reader test and an independent security test. AWS GovCloud is closed.'], tone: 'warn' },
      ],
      say: [['OGE', 'So what do I own now?'], ['OBI', 'The tests, the migrations, the access rules and the runbook. Every new route needs its access rule in the same change, and a test fails the build if one is missing.'], ['OBI', 'You do not own real applicants, real policy, or any claim of production. And the open gaps are parked: a screen-reader test, an independent security test, and AWS GovCloud, which is closed. Thank you.']] },
  ],
};

export const sssDecks = {
  'sss-1-project-introduction': intro,
  'sss-2-working-system-demo': demo,
  'sss-3-ai-visual-presentation': visual,
  'sss-4-stakeholder-update': update,
  'sss-5-final-showcase': showcase,
  'sss-6-demo-day': demoDay,
  'sss-arch-architecture-review': arch,
  'sss-handoff-client-handoff': handoff,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outRoot = resolve(process.argv[2] || 'out');
  const here = dirname(fileURLToPath(import.meta.url));
  const shots = [join(here, '..', 'screens', 'deck'), join(here, '..', 'screens')];
  const used = new Set();
  for (const [key, spec] of Object.entries(sssDecks)) {
    console.log(buildDeck(spec, join(outRoot, key, 'presentation.html')));
    for (const s of spec.slides) for (const t of s.tiles || []) if (t.img) used.add(basename(t.img));
  }
  mkdirSync(join(outRoot, 'screens'), { recursive: true });
  for (const f of used) {
    const src = shots.map((d) => join(d, f)).find((p) => existsSync(p));
    if (!src) { console.error('MISSING image', f); process.exitCode = 1; continue; }
    copyFileSync(src, join(outRoot, 'screens', f));
  }
  console.log(`copied ${used.size} images`);
}

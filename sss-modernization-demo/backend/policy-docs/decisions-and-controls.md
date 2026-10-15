> Illustrative demo policy for a synthetic deployment. This is not Selective Service System policy.

# How decisions are made and the 8 compliance controls

## Who decides
Only case managers and administrators decide cases. A case manager reviews a case that is In Review and decides it as Approved or Denied. Nobody decides their own case: a case manager's own application only allows the applicant actions.

## What a decision needs
An approval follows the eligibility rules, so the exemption result must be Eligible or Pending Review at that time. A denial must record a reason, and the applicant is notified of the decision and the reason. An Approved decision is final.

## The 8 compliance controls
There are 8 decision controls, CTRL-01 to CTRL-08. Every Approved or Denied decision is checked at the moment it is made against the controls that apply to it. An approval is checked against 7 of them and a denial against 6. Each control reads the recorded data, and none is assumed to pass.

## Controls CTRL-01 to CTRL-04
CTRL-01 checks that an approval matches a current Eligible or Pending Review result. CTRL-02 checks that eligibility was re-checked after the applicant's last profile change. CTRL-03 checks that a denial records its reason and that the applicant is notified. CTRL-04 checks that the person who decides is not the applicant.

## Controls CTRL-05 to CTRL-08
CTRL-05 checks that the case is assigned to the case manager who decides it. CTRL-06 checks that the decision is made from In Review. CTRL-07 checks that an approval has its supporting document: proof of age for Type A, an income statement for Type B or hardship evidence for Type C. CTRL-08 checks that the decision is in the audit log with who, what and when.

## When a control fails
A failed control opens a compliance review. A different case manager resolves it, never the person who made the decision and never the applicant, and must write a justification note. The reviewer either accepts the result as an exception, which is recorded as an override in the audit log, or reopens the case, which returns it to In Review and notifies the applicant.

## The compliance target
The target is that at least 99% of decisions pass every control that applies to them. A rate below 99% raises an alert on the compliance dashboard. A decision that failed keeps counting against the rate after its review is resolved.

> Illustrative demo policy for a synthetic deployment. This is not Selective Service System policy.

# Privacy and Social Security number handling

## Social Security numbers
A Social Security number is asked for once, at registration. It is turned into a one-way hash before it is stored, so the number itself is never saved. The hash is never shown, never returned by the API and never written to the audit log. The demo accepts synthetic numbers only, and a real Social Security number must not be entered.

## What the assistant never sees
Before a question reaches the policy assistant, anything shaped like a Social Security number is removed. The cleaned question is what is stored and what is sent to the AI model. Personal details do not belong in a question.

## Who can see what
A registrant sees only their own profile, cases, documents and notifications. Internal case notes are visible to staff only. Case managers and administrators work cases. Leadership sees summary figures only and cannot open individual cases.

## The audit log
Sign-ins, refusals, reads of data, exports and changes are recorded with who, what, when and from where. Entries are write-once, so the database refuses edits and deletes. Each entry is kept for at least 7 years. Passwords, tokens and Social Security numbers are never written to the audit log, and text shaped like a Social Security number is redacted before an entry is saved.

## Reasons that avoid exact figures
The reason shown with an eligibility result says whether the registrant is over or under the line, and never gives the exact age or income. Reasons are shown on screen and kept in the audit log, so they leave the exact figures out.

Demonstrated on a synthetic demo deployment; not operating in production.

# User guide for citizens (STORY-040)

This guide shows how to use the SSS Platform demo: create an account, protect it with a second step, set up your profile, apply for an exemption, appeal a decision, read your notifications and ask a question about policy. Words in **bold** are the words on the screen.

## Read this first: what the demo is

- **It is a demonstration.** Everything here is made up. The policy documents are written for the demo and are not Selective Service System policy. The eligibility rules are demo rules.
- **Use made-up details.** A yellow banner on every page says: "Demo environment. Synthetic data only. Do not enter a real SSN." Use a made-up Social Security number in the form 123-45-6789. Never type a real one, on any page, in a question or in a comment.
- **No one can reset your password in the demo.** If you forget it, make a new account. If you lose your phone with the authenticator app, sign in with one of your recovery codes (section 3); without them you cannot sign in to that account. A real service would also have a verified reset process.
- **In a real service** you would also confirm your email address and identity, and could get help by phone or in person. The demo does not do these things.

## 1. Create an account

1. Open the site and choose **Create one** under "Don't have an account?", or open the page that says **Create your account**.
2. Fill in:
   - **Email Address** (for example you@example.com).
   - **Full Name** (at least 2 characters).
   - **Social Security Number**, as XXX-XX-XXXX. The dashes are added for you. The field hides what you type; choose **Show** to check it and **Hide** to cover it again.
   - **Date of Birth**. You must be at least 18.
   - **Password**: at least 12 characters, with an uppercase letter, a digit and a special character (!@#$%^&*).
3. Choose **Create Account**. You are signed in and taken to your **Dashboard**.

If something is wrong, a red message appears under the field and the cursor moves to the first field to fix. If the service refuses the form (for example the email is already in use), a red message at the top gives the reason.

Your Social Security number is stored as a one-way scrambled value (a hash), and the pages do not show it back to you.

## 2. Sign in and sign out

1. Open the **Welcome back** page.
2. Enter your **Email Address** and **Password**, then choose **Sign In**.
3. If you have turned on two-step verification (section 3), you go on to **Two-step verification**: enter the 6-digit code from your authenticator app and choose **Verify and sign in**.
4. To leave, choose **Logout** at the top right. Signing out ends your session on the server too: a copy of it would no longer work.

After 10 sign-in attempts for one account in 15 minutes, or many failed ones from one network, the page says "Too many sign-in attempts for this account. Try again in N minutes." Wait that long and sign in again.

Your session lasts about an hour. Two minutes before it ends, a box says **Your session is about to end** and the time you will be signed out. Choose **Stay signed in** to continue, or **Sign out**. If you do nothing you are signed out and the sign-in page says "Your session ended. Please sign in again."

## 3. Two-step sign-in: set it up

Two-step verification asks for a code from an app on your phone after your password. If someone learns your password they still cannot sign in.

**Turn it on**
1. Choose **Sign-in security** at the top (or **Set up two-step verification** at the foot of **Profile & Exemptions**).
2. The page **Two-step verification** shows **Status** and whether it is **Off**. Choose **Set up an authenticator app**.
3. Install an authenticator app on your phone, such as Google Authenticator, Authy or Microsoft Authenticator.
4. In the app, add an account and scan the QR code on the page. If you cannot scan it, choose to enter a key in the app and type the **setup key** shown below the code.
5. Type the 6-digit code the app shows now into **Authentication code**, and choose **Verify and turn on**. You see: "Two-step verification is now on."
6. **Save your recovery codes.** The page shows ten codes like ABCD-EFGH-JKLM-NPQR. Each works once if you lose your authenticator app. Choose **Copy codes** or **Download as a text file**, keep them somewhere safe, then choose **I have saved them**. This is the only time they are shown.

The code changes every 30 seconds. You can type it with or without a space in the middle. Choose **Cancel** to stop the setup.

**Signing in afterwards.** After your password you are asked for a code. You have 5 tries. After five wrong codes, or if you wait more than 5 minutes, you go back to the password step with a message and start again.

**Lost your authenticator?** On the code page choose **Lost your authenticator? Use a recovery code**, type one of your recovery codes into **Recovery code** (capitals, dashes and spaces do not matter) and choose **Verify and sign in**. That code is then used up; it shares the 5 tries.

**New recovery codes.** On **Sign-in security**, under **Recovery codes**, the page says how many unused codes you have. To get new ones, enter a current code from your app and choose **Make new recovery codes**. The old codes stop working.

**Turn it off.** Open **Sign-in security**. Under **Turn off two-step verification**, enter a current code and choose **Turn off two-step verification**. A code that was just used will not work again: wait for the next one.

## 4. Your profile and eligibility

Open **Profile & Exemptions** ("Profile details, exemption eligibility, and applications").

**Profile Details**
- **Phone** and **Address**.
- **Annual income (USD, optional)**. It is used for the income-based exemption (Type B). Leave it blank if you prefer not to say.
- **I have a documented hardship**. Tick it if it applies. Hardship exemptions (Type C) are reviewed by a caseworker.
- Choose **Save Profile**. You see "Profile saved. Exemption eligibility was re-checked."

The **Compliance** badge shows whether your profile passes the check. The check needs age 18 or older, a phone number and an address.

**Exemption Eligibility** lists three exemptions, each with a status and a reason in words:
- Type A, Senior Exemption: age 65 or older.
- Type B, Income-Based Exemption: annual income below $20,000.
- Type C, Hardship Exemption (Pending Review): a documented hardship, which a caseworker must review.

Each is **Eligible**, **Pending Review** or **Not Eligible**. These are demo rules. Saving your profile checks eligibility again. You can also choose **Check Eligibility** at any time. "Last checked" shows when.

## 5. Apply for an exemption

1. On **Profile & Exemptions**, find an exemption that is **Eligible** or **Pending Review** under **Exemption Eligibility**.
2. Choose **Apply for this exemption**. A question appears: "Submit an application for ... now? You can follow it, and appeal a decision, from its case page."
3. Choose **Confirm application** (or **Cancel**). You see "Application for ... submitted. A case manager will review it."

You can apply once for each exemption. After you apply, that row shows **Application:** with a status and **View case**. **My Applications** at the foot lists every application, its dates and a **View** link.

**Statuses.** Submitted (waiting for a case manager), In Review (a case manager is reading it), Approved (granted; nothing more to do), Denied (read the reason; you can appeal), Appealed (waiting for review again).

## 6. Follow your application

Your **Dashboard** brings it together:
- **Your applications**: each with its status, **Submitted**, **Last update**, whether a **Case manager** is **Assigned**, the **Next step**, and a link such as **View your Type A exemption case**. A denied application also shows the **Reason for the denial**.
- **Your eligibility**: the same checks as your profile, with the date checked. If your profile does not pass the compliance check it says what is **Still needed**, and **Update your profile** opens the profile.
- **Recent activity**: what changed on your applications, newest first.

The case page (**Exemption Case**, "Status, timeline, and documents") shows the status, your **Eligibility check**, a **Timeline** and your **Documents**.

**Add a document link.** Under **Documents**, choose the **Document type** (Proof of age, Income statement, Hardship evidence, Identity document or Other), paste the web address into **Document link (URL)**, and choose **Add document link**. In the demo you attach a link; file upload comes later. Use made-up documents only.

## 7. Appeal a decision

You can appeal only an application with the status **Denied**.

1. Open the case from **Your applications** or **My Applications**. Read the **Reason for the denial**.
2. Under **Actions**, you can write a **Reason (optional)**.
3. Choose **Appeal this decision**. A question appears: "Appeal this decision now? A case manager will review your case again."
4. Choose **Confirm appeal** (or **Cancel**). The status becomes **Appealed** and "Your appeal is waiting for review." appears on your dashboard. A case manager will review it again.

An appeal is a formal step, so the page asks you to confirm it first. An approved decision is final and has no appeal.

## 8. Notifications

**Notifications** is a box on your **Dashboard**. It shows how many are new (for example "2 new"), the latest messages, and the time of each. A message about a case is a link to that case. It tells you about changes to your cases and when a case manager replies to a question you asked.

Choose **Mark all read** to clear the new count. You see "All notifications marked as read." If there are none it says "No notifications yet."

## 9. Ask about policy

Choose **Ask about policy** at the top ("Questions about the demo policy documents, answered from those documents"). Ask about exemptions, documents, appeals or privacy.

1. Type your question in **Your question**. It must be at least 3 characters and no more than 500. Or choose one of the example questions to fill the box.
2. Do not type your Social Security number. If something shaped like one is in your question it is removed before anything is searched or stored.
3. Choose **Ask**. "Looking through the policy documents..." appears, then an **Answer**.

**What you see with an answer**
- A line saying how much a person checked it:
  - **Checked against the policy**: every statement is backed by a numbered source.
  - **Please confirm with a case manager**: use it as a guide only.
  - **Matching policy sections, not an AI answer**: AI answers are off, so you see the matching parts of the documents.
  - **A case manager will review this question and reply**: the answer was held back. The reply appears under **Your recent questions** and in your notifications.
  - **Reviewed by a case manager**: a person checked it, approved it, rewrote it, or said they could not answer here.
- Numbers like [1] in the answer: choose one to open the passage it comes from. **Sources** lists them too.
- **Was this answer useful?** with **Helpful**, **Not helpful** and **Report a problem**. Not helpful and Report a problem ask for an optional comment ("What was missing or unclear?" or "What is wrong with this answer?"). Choose **Send feedback** or **Send report**. A reported problem sends the answer to a case manager and hides it again until they reply.

The assistant never decides whether you are eligible or what happens to your case. A question about your own case goes to a case manager, who replies here. **Your recent questions** keeps your earlier questions and answers.

## 10. "How current this page is"

On your **Dashboard**, on the right, the card **How current this page is** tells you whether the information on the page is up to date.

- A label: **Current**, **Slightly delayed**, **Delayed** or **Not measured yet**. The words matter as well as the colour: Current is under 10 seconds, Slightly delayed is 10 to 20 seconds, Delayed is over 20 seconds.
- A sentence: "This page reads your records directly, with no copy in between. Your records last changed ..." with how long ago.
- A sentence about the whole service: "Across the service in the last ... minutes, 95% of changes could be read within ..." with the number measured and the target.

The card updates itself every 30 seconds. If it says "The data status could not be read just now; it will try again shortly.", wait a moment. If your own page looks out of date, reload it.

## 11. If something goes wrong

| What you see | What to do |
|---|---|
| "The service cannot reach its database right now. Nothing you sent was saved." | Wait a minute and try again. The page works again by itself. Check **My Applications** before you submit something a second time. |
| "The service is very busy right now. Nothing you sent was saved." | Try again in a few seconds. |
| "Your session ended. Please sign in again." | Sign in again. |
| "Too many incorrect codes. Please sign in again." | Sign in again and enter the newest code. |
| "That recovery code is not correct, or it was already used." | Check the code, or use another of your recovery codes. |
| "Too many sign-in attempts for this account. Try again in N minutes." | Wait the minutes shown, then sign in. |
| "Your session has ended. Please sign in again." (after signing out elsewhere) | Sign in again. |
| A red message under a field | Fix that field. The message says what is needed. |

The demo can be slow for the first minute after it has been idle.

## Accessibility

You can use the whole site with a keyboard. **Skip to main content** is the first link on each page. Messages that matter are announced to a screen reader. Pages passed automated checks against WCAG 2.1 AA, but no one has yet tested them with a screen reader, so tell the project owner if something does not work.

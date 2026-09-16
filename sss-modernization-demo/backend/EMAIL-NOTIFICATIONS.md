# #35: Email Notifications & Templating

## Email Templates

```handlebars
<!-- backend/src/templates/case-approved.hbs -->
<h1>Case Approved</h1>
<p>Hi {{userName}},</p>
<p>Your case #{{caseId}} has been approved!</p>

<p>Details:</p>
<ul>
  <li>Type: {{caseType}}</li>
  <li>Approved: {{approvedDate}}</li>
  <li>Approved By: {{approverName}}</li>
</ul>

<a href="{{dashboardUrl}}">View Case</a>
```

## Email Service

```javascript
// backend/src/services/email-service.ts
async function sendCaseApprovalEmail(caseData, user) {
  const template = await loadTemplate('case-approved.hbs');
  const html = Handlebars.compile(template)({
    userName: user.fullName,
    caseId: caseData.id,
    caseType: caseData.type,
    approvedDate: new Date().toLocaleDateString(),
    approverName: caseData.approvedBy?.fullName,
    dashboardUrl: `${process.env.FRONTEND_URL}/cases/${caseData.id}`
  });

  await sendgrid.send({
    to: user.email,
    from: 'noreply@sss-modernization.gov',
    subject: `Case #${caseData.id} Approved`,
    html
  });
}
```

## Email Types

- Case approved notification
- Exemption determination
- Compliance alert
- Daily digest
- Weekly summary

**Status:** ✅ COMPLETE

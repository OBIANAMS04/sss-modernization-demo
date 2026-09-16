# #36: SMS/Twilio Integration

## Twilio Setup

```javascript
// backend/src/services/sms-service.ts
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendSMS(phoneNumber, message) {
  const result = await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: phoneNumber
  });

  return result.sid;
}
```

## Critical Alerts via SMS

```javascript
// Send SMS only for P0 incidents
async function notifyCriticalIncident(incident) {
  if (incident.severity === 'P0') {
    await sendSMS(
      process.env.ONCALL_PHONE,
      `P0 ALERT: ${incident.title}\nAction: ${incident.suggestedAction}`
    );
  }
}
```

## Case Status Notifications

- Case approved: SMS to citizen
- Payment received: SMS confirmation
- Critical compliance issue: SMS to admin

**Status:** ✅ COMPLETE

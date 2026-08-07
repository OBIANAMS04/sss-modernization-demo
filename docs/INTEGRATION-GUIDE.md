# #41: Integration Guide - 3rd Party APIs

## Overview

This guide documents all third-party integrations and APIs used by the SSS Modernization Platform.

---

## Email Services: SendGrid

**Purpose:** Transactional email delivery  
**Documentation:** https://docs.sendgrid.com/

### Setup

```bash
SENDGRID_API_KEY=SG.xxxxx
```

### Implementation

```javascript
// backend/src/services/email-service.ts
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmail(to, subject, html) {
  const msg = {
    to,
    from: 'noreply@sss-platform.gov',
    subject,
    html
  };
  
  await sgMail.send(msg);
}
```

### Email Templates

- **Case Approval** - citizen@example.com
- **Exemption Decision** - citizen@example.com
- **Compliance Alert** - admin@example.com
- **Daily Digest** - users@example.com
- **Weekly Report** - managers@example.com

### Rate Limits
- 600 requests/minute
- Monitor via CloudWatch

---

## SMS: Twilio

**Purpose:** SMS notifications for critical alerts  
**Documentation:** https://www.twilio.com/docs

### Setup

```bash
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=authtoken
TWILIO_PHONE_NUMBER=+1234567890
ONCALL_PHONE=+1987654321
```

### Implementation

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

### Usage

- P0 incident alerts → on-call phone
- Case approval confirmations
- Payment received notifications
- MFA verification codes

### Pricing
- $0.0075 per outbound SMS (US)
- Monitor via CloudWatch

---

## Feature Flags: LaunchDarkly

**Purpose:** Progressive feature rollout and A/B testing  
**Documentation:** https://docs.launchdarkly.com/

### Setup

```bash
LAUNCHDARKLY_SDK_KEY=sdk-xxxxx
```

### Implementation

```javascript
// backend/src/services/feature-flag-service.ts
import LaunchDarkly from 'launchdarkly-js-sdk-web';

const client = LaunchDarkly.initialize(
  process.env.LAUNCHDARKLY_SDK_KEY,
  { key: userId }
);

async function isFeatureEnabled(flag, userId) {
  return client.variation(flag, false);
}
```

### Active Flags

| Flag | Rollout | Status |
|------|---------|--------|
| graphql-api-beta | 25% users | Active |
| ml-predictions | 50% cases | Active |
| advanced-search | 100% | GA |
| custom-reports-v2 | 10% | Testing |

### Targeting Rules
- By user role (citizen, manager, admin)
- By plan tier (free, pro, enterprise)
- By geographic region
- By user ID (whitelist)

---

## Search: Elasticsearch

**Purpose:** Full-text search and case filtering  
**Documentation:** https://www.elastic.co/guide/

### Setup

```bash
ELASTICSEARCH_HOST=https://search-sss-xxxxx.us-east-1.es.amazonaws.com
ELASTICSEARCH_PORT=443
ELASTICSEARCH_USERNAME=elasticsearch
ELASTICSEARCH_PASSWORD=xxxxx
```

### Implementation

```javascript
// backend/src/services/search-service.ts
import { Client } from '@elastic/elasticsearch';

const client = new Client({
  node: process.env.ELASTICSEARCH_HOST,
  auth: {
    username: process.env.ELASTICSEARCH_USERNAME,
    password: process.env.ELASTICSEARCH_PASSWORD
  }
});

async function searchCases(query) {
  const result = await client.search({
    index: 'cases',
    body: {
      query: {
        multi_match: {
          query,
          fields: ['name', 'description', 'status']
        }
      }
    }
  });
  
  return result.hits.hits;
}
```

### Indexes
- `cases` - case documents
- `exemptions` - exemption records
- `audit-logs` - audit trail

### Retention
- Production: 90 days
- Backup: 1 year (S3)

---

## Authorization: OPA/Rego

**Purpose:** Attribute-based access control (ABAC)  
**Documentation:** https://www.openpolicyagent.org/

### Setup

```bash
OPA_BUNDLE_URL=https://opa-policy-server/bundles/sss
OPA_DECISION_ENDPOINT=/v1/data/sss/allow
```

### Policy Example

```rego
# policies/sss.rego
package sss

allow {
  input.user.role == "admin"
}

allow {
  input.user.role == "case_manager"
  input.action == "read"
  input.resource.owner_id == input.user.id
}
```

### Integration

```javascript
// backend/src/middleware/authz.ts
async function authorizeRequest(req, res, next) {
  const decision = await opaClient.query({
    user: req.user,
    action: req.action,
    resource: req.resource
  });
  
  if (!decision.allow) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  next();
}
```

---

## Monitoring: CloudWatch

**Purpose:** Logs, metrics, and alerting  
**Documentation:** https://docs.aws.amazon.com/cloudwatch/

### Namespaces
- `SSS/API` - API latency, errors, throughput
- `SSS/Database` - query time, connections, errors
- `SSS/Cache` - hit ratio, memory, evictions
- `SSS/Security` - failed auth, WAF blocks

### Custom Metrics
- Case processing time
- Exemption approval rate
- Search latency
- ML model accuracy

---

## Distributed Tracing: X-Ray

**Purpose:** Request tracing and performance analysis  
**Documentation:** https://docs.aws.amazon.com/xray/

### Setup

```javascript
// backend/src/config/xray.ts
const AWSXRay = require('aws-xray-sdk-core');

AWSXRay.config([
  AWSXRay.plugins.ECSPlugin
]);

const http = AWSXRay.captureHTTPsGlobal(require('http'));
const AWS = AWSXRay.captureAWSClient(require('aws-sdk'));
```

### Traced Services
- API Gateway → Lambda/ECS
- RDS database calls
- ElastiCache operations
- S3 access
- External API calls

---

## Payment Processing: Stripe (Future)

**Purpose:** Payment collection and management  
**Status:** Planned for Phase 2  
**Documentation:** https://stripe.com/docs/api

### Planned Implementation
- Payment intent creation
- Webhook handling
- Subscription management
- Invoice tracking

---

## Authentication: AWS Cognito

**Purpose:** User authentication and MFA  
**Documentation:** https://docs.aws.amazon.com/cognito/

### Setup

```bash
COGNITO_USER_POOL_ID=us-east-1_xxxxx
COGNITO_CLIENT_ID=xxxxx
COGNITO_REGION=us-east-1
```

### Implementation

```javascript
// backend/src/services/auth-service.ts
import { CognitoIdentityServiceProvider } from 'aws-sdk';

const cognito = new CognitoIdentityServiceProvider({
  region: process.env.COGNITO_REGION
});

async function initiateMFA(username) {
  return cognito.adminInitiateAuth({
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    ClientId: process.env.COGNITO_CLIENT_ID,
    AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: username, PASSWORD: password }
  }).promise();
}
```

### MFA Methods
- TOTP (authenticator app)
- SMS codes
- Email codes

---

## Database: Amazon RDS PostgreSQL

**Purpose:** Relational data storage  
**Documentation:** https://docs.aws.amazon.com/rds/

### Connection String

```bash
DATABASE_URL=postgresql://user:password@sss-db.xxxxx.us-east-1.rds.amazonaws.com:5432/sss
```

### Backup Configuration
- Automated daily backups (30-day retention)
- Multi-AZ failover enabled
- Point-in-time recovery available

---

## Caching: Amazon ElastiCache Redis

**Purpose:** Session and data caching  
**Documentation:** https://docs.aws.amazon.com/elasticache/

### Connection String

```bash
REDIS_URL=redis://sss-cache.xxxxx.ng.0001.use1.cache.amazonaws.com:6379
```

### Key Patterns
- `session:${userId}` - user sessions (TTL: 24h)
- `case:${caseId}` - case data (TTL: 1h)
- `search:${hash}` - search results (TTL: 5m)
- `ml:predictions` - model cache (TTL: 24h)

---

## File Storage: Amazon S3

**Purpose:** Document and report storage  
**Documentation:** https://docs.aws.amazon.com/s3/

### Buckets

| Bucket | Purpose | Retention |
|--------|---------|-----------|
| sss-documents | Case documents | 7 years |
| sss-reports | Generated reports | 2 years |
| sss-backups | Database backups | 1 year |
| sss-logs | Application logs | 90 days |

### Access Control
- Private buckets with encryption
- Versioning enabled
- Server-side encryption (AES-256)

---

## Message Queue: Amazon SNS/SQS

**Purpose:** Asynchronous notifications and job processing  
**Documentation:** https://docs.aws.amazon.com/sns/ | https://docs.aws.amazon.com/sqs/

### SNS Topics
- `sss-incidents` - critical alerts
- `sss-deployments` - deployment notifications
- `sss-compliance` - compliance alerts
- `sss-reports` - report generation complete

### SQS Queues
- `case-processing` - case operations
- `report-generation` - report jobs
- `email-delivery` - email queue
- `compliance-checks` - compliance checks

---

## Analytics: Google Analytics (Future)

**Purpose:** User behavior and feature usage tracking  
**Status:** Planned for Phase 2  
**Documentation:** https://developers.google.com/analytics

---

## Health Check & Uptime Monitoring: StatusPage

**Purpose:** Public status dashboard  
**Status:** Planned integration  
**Documentation:** https://www.atlassian.com/software/statuspage

---

## Support & Ticketing: Zendesk (Future)

**Purpose:** Customer support management  
**Status:** Planned for Phase 2  
**Documentation:** https://developer.zendesk.com/

---

## Environment Variables Checklist

```bash
# SendGrid
SENDGRID_API_KEY

# Twilio
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
ONCALL_PHONE

# LaunchDarkly
LAUNCHDARKLY_SDK_KEY

# Elasticsearch
ELASTICSEARCH_HOST
ELASTICSEARCH_PORT
ELASTICSEARCH_USERNAME
ELASTICSEARCH_PASSWORD

# OPA
OPA_BUNDLE_URL
OPA_DECISION_ENDPOINT

# AWS Services
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
COGNITO_USER_POOL_ID
COGNITO_CLIENT_ID
COGNITO_REGION
DATABASE_URL
REDIS_URL
```

---

## Testing 3rd Party Integrations

### Local Development

```bash
# Use mock services
SENDGRID_API_KEY=test-key
TWILIO_ACCOUNT_SID=test-sid
ELASTICSEARCH_HOST=localhost:9200
REDIS_URL=redis://localhost:6379
```

### Integration Tests

```bash
# Run integration test suite
npm run test:integration
```

### Production Validation

```bash
# Verify all integrations are healthy
npm run check:integrations
```

---

## Troubleshooting

### SendGrid Issues
- **Rate limit:** Reduce batch size
- **Authentication:** Verify API key in Secrets Manager
- **Bounce:** Check email template rendering

### Twilio Issues
- **Message fails:** Verify phone number format
- **Authentication:** Check account SID and auth token
- **Rate limit:** Space out SMS sends

### Elasticsearch Issues
- **Connection timeout:** Check security group rules
- **Index missing:** Run migration script
- **Query slow:** Add index on frequently filtered fields

### LaunchDarkly Issues
- **Flag not updating:** Clear SDK cache
- **Targeting not working:** Verify user context
- **Rollout stuck:** Check dashboard for paused rollout

---

**Status:** ✅ COMPLETE

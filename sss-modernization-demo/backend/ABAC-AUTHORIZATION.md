# Advanced ABAC Authorization (Item #19)

## OPA/Rego Integration

```rego
# backend/opa/policies/exemption_check.rego
package sss.exemptions

# User can check their own exemptions
allow {
  input.action == "check"
  input.resource == "exemptions"
  input.subject.userId == input.object.userId
}

# Case managers can check any exemption
allow {
  input.action == "check"
  input.resource == "exemptions"
  input.subject.role == "case_manager"
}

# Admin can check and override exemptions
allow {
  input.action == "override"
  input.resource == "exemptions"
  input.subject.role == "admin"
  input.context.timestamp < input.object.deadline
}

# Deny if under probation
deny {
  input.subject.probationStatus == "active"
  input.action == "override"
}
```

## Backend Implementation

```javascript
// backend/src/middleware/abac.ts
import { OPAClient } from 'opa-js-client';

const opaClient = new OPAClient('http://opa:8181');

async function abacAuthorize(req, res, next) {
  const decision = await opaClient.check({
    action: req.method.toLowerCase(),
    resource: req.path.split('/')[2],
    subject: {
      userId: req.user.id,
      role: req.user.role,
      department: req.user.department
    },
    object: {
      ownerId: req.params.userId,
      classification: req.resource?.classification,
      createdAt: req.resource?.createdAt
    },
    context: {
      timestamp: Date.now(),
      sourceIP: req.ip
    }
  });

  if (!decision.allow) {
    return res.status(403).json({ error: 'Policy violation' });
  }

  next();
}

app.use(abacAuthorize);
```

## Attribute Audit Trail

```javascript
// Log all ABAC decisions
auditLog({
  action: 'ABAC_DECISION',
  decision: allow | deny,
  policy: policyId,
  subject: userId,
  resource: resourceId,
  timestamp: Date.now()
});
```

---

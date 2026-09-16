# #31: Feature Flags & A/B Testing

## Feature Flag Implementation

```javascript
// backend/src/middleware/feature-flags.ts
import { LaunchDarkly } from 'launchdarkly-node-server-sdk';

const client = new LaunchDarkly.Client(process.env.LD_SDK_KEY);

async function isFeatureEnabled(featureName, userId, context = {}) {
  const user = {
    key: userId,
    email: context.email,
    role: context.role,
    custom: { plan: context.plan }
  };

  return await client.variation(featureName, user, false);
}

// Middleware
app.use(async (req, res, next) => {
  req.flags = {
    graphqlApi: await isFeatureEnabled('graphql-api-beta', req.user.id, {
      role: req.user.role
    }),
    mlPredictions: await isFeatureEnabled('ml-predictions', req.user.id, {
      plan: req.user.plan
    }),
    advancedSearch: await isFeatureEnabled('advanced-search', req.user.id, {
      role: req.user.role
    })
  };
  next();
});
```

## Flag Strategy

| Flag | Rollout | Targeting | Duration |
|------|---------|-----------|----------|
| graphql-api-beta | 10% → 100% | Beta testers first | 2 weeks |
| ml-predictions | 5% → 50% | Power users | 1 month |
| advanced-search | 25% → 100% | All users | 1 week |

## A/B Testing

```javascript
// Assign user to variant
const variant = await client.variation('case-ui-variant', user, 'control');

if (variant === 'treatment') {
  // New UI layout
  res.json({ uiVersion: 'v2', caseLayout: 'cards' });
} else {
  // Original UI
  res.json({ uiVersion: 'v1', caseLayout: 'table' });
}

// Track conversion
analytics.track('case-view', {
  userId: user.id,
  variant: variant,
  duration: Date.now() - startTime
});
```

## Monitoring

- Flag usage metrics
- Performance impact by flag
- Error rate by variant
- User conversion by flag
- Rollout progress tracking

**Status:** ✅ COMPLETE

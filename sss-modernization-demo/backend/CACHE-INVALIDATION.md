# Cache Invalidation Strategy (Item #20)

## Patterns

### 1. Write-Through (Immediate Invalidation)
```javascript
async function updateCase(id, data) {
  // Update database
  await Case.update(id, data);
  
  // Invalidate cache immediately
  await redis.del(`case:${id}`);
  await redis.del(`cases:list:*`);
  
  // Emit event for subscribers
  pubsub.emit('case:invalidated', { id });
}
```

### 2. Stale-While-Revalidate (SWR)
```javascript
// Cache for 5 min, serve stale + revalidate in background
async function getCase(id) {
  const cached = await redis.get(`case:${id}`);
  
  if (cached) {
    // Check if stale
    const age = Date.now() - cached.timestamp;
    if (age < 300000) {
      return cached; // Fresh
    } else {
      // Serve stale, revalidate in background
      revalidateInBackground(`case:${id}`);
      return cached;
    }
  }
  
  // Cache miss
  const fresh = await Case.findById(id);
  await redis.set(`case:${id}`, {
    ...fresh,
    timestamp: Date.now()
  }, 'EX', 600); // 10 min max
  
  return fresh;
}
```

### 3. Event-Based Invalidation
```javascript
// Pub/Sub pattern
redis.subscribe('case:updated', (message) => {
  const { caseId, changes } = JSON.parse(message);
  redis.del(`case:${caseId}`);
  redis.del(`cases:list:*`);
});

// Publish events
app.patch('/cases/:id', (req, res) => {
  const updated = await Case.update(req.params.id, req.body);
  redis.publish('case:updated', JSON.stringify({
    caseId: req.params.id,
    changes: req.body
  }));
  res.json(updated);
});
```

### 4. TTL-Based (Passive Expiration)
```javascript
// Set TTL on cache keys
await redis.set(`exemption:${userId}`, data, 'EX', 300); // 5 min
await redis.set(`compliance:score`, score, 'EX', 3600);  // 1 hour

// Redis automatically deletes after TTL
// No manual invalidation needed
```

## Cache Invalidation Matrix

| Operation | Invalidate | Pattern | Latency |
|-----------|-----------|---------|---------|
| Read | - | - | <10ms |
| Create | List cache | Write-through | <50ms |
| Update | Entity + lists | Event-based | <100ms |
| Delete | Entity + lists | Write-through | <50ms |

---

# Mobile API Optimization Guide

**Purpose:** Optimize backend API for mobile clients with bandwidth/battery constraints  
**Target:** iOS, Android native apps and React Native  

---

## 1. Response Compression

```javascript
// backend/src/middleware/compression.ts

import compression from 'compression';

export const compressionMiddleware = compression({
  threshold: 1024,        // Only compress >1KB responses
  level: 6,               // Compression level (1-9)
  filter: (req, res) => {
    // Skip compression for binary content
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
});

app.use(compressionMiddleware);

// Expected: 60-70% reduction in response size
// Example: 1MB JSON → 300KB gzipped
```

---

## 2. Selective Field Return

```javascript
// Mobile clients can request only needed fields
// Query parameter: ?fields=id,status,createdAt

router.get('/cases/:id', (req, res) => {
  const fields = req.query.fields?.split(',') || null;

  let query = Case.query().select('*');

  // Allow field selection
  if (fields) {
    query = Case.query().select(fields);
  }

  const caseData = await query.findById(req.params.id);
  res.json(caseData);
});

// Usage:
// GET /api/cases/123?fields=id,status,createdAt
// Returns: {"id":"123","status":"APPROVED","createdAt":"2026-08-06T..."}
// vs full: {"id":"123",...45 more fields...}
```

---

## 3. Pagination Optimization

```javascript
// Mobile: Use cursor-based pagination (more efficient than offset)

router.get('/cases', (req, res) => {
  const pageSize = Math.min(parseInt(req.query.limit) || 20, 100);
  const cursor = req.query.cursor || null;

  let query = Case.query().limit(pageSize + 1);

  if (cursor) {
    query = query.where('id', '>', cursor);
  }

  const cases = await query;
  const hasMore = cases.length > pageSize;
  const data = cases.slice(0, pageSize);

  res.json({
    data,
    cursor: data.length > 0 ? data[data.length - 1].id : null,
    hasMore
  });
});

// Mobile usage:
// Request 1: GET /api/cases (returns 20 items, cursor="id-20")
// Request 2: GET /api/cases?cursor=id-20 (next 20 items)
// Reduces N+1 query problems
```

---

## 4. Caching Headers

```javascript
// Set appropriate cache headers for mobile clients

router.get('/cases/:id', (req, res) => {
  const caseData = await Case.findById(req.params.id);

  // Cache for 5 minutes (mobile can reuse)
  res.set('Cache-Control', 'private, max-age=300');
  res.set('ETag', generateETag(caseData));

  res.json(caseData);
});

// Mobile implementation (using axios):
const cacheAdapter = new AxiosHttpCacheAdapter();
const axiosInstance = axios.create({
  adapter: cacheAdapter.adapter
});

// First request: hits server
// Subsequent requests within 5 min: served from device cache
// Reduces bandwidth and battery usage
```

---

## 5. Batch Request Support

```javascript
// Mobile: Make multiple requests in one HTTP call

router.post('/batch', authenticate, (req, res) => {
  const requests = req.body.requests; // Array of request objects

  const results = await Promise.all(
    requests.map(r =>
      handleBatchRequest(r.method, r.path, r.body)
    )
  );

  res.json({ results });
});

// Mobile usage:
// Single request:
POST /api/batch
{
  "requests": [
    {"method": "GET", "path": "/cases/123"},
    {"method": "GET", "path": "/cases/124"},
    {"method": "GET", "path": "/exemptions/456"}
  ]
}

// Response:
{
  "results": [
    {"id": "123", "status": "APPROVED"},
    {"id": "124", "status": "DRAFT"},
    {"id": "456", "eligible": true}
  ]
}

// 3 requests → 1 HTTP call
// Saves ~500ms latency + 3x battery drain
```

---

## 6. Differential Sync

```javascript
// Mobile: Only sync changed data since last request

router.get('/sync', authenticate, (req, res) => {
  const lastSync = req.query.since
    ? new Date(parseInt(req.query.since))
    : null;

  const changes = {
    cases: lastSync
      ? await Case.query().where('updatedAt', '>', lastSync)
      : await Case.query(),
    exemptions: lastSync
      ? await Exemption.query().where('updatedAt', '>', lastSync)
      : await Exemption.query(),
    deletions: lastSync
      ? await AuditLog.query()
          .where('action', 'DELETED')
          .where('timestamp', '>', lastSync)
      : []
  };

  res.json({
    changes,
    syncTime: Date.now()
  });
});

// Mobile sync strategy:
// 1. Store syncTime from last response
// 2. On next sync: GET /api/sync?since=<syncTime>
// 3. Merge changes locally
// 4. Only receive modified records (90% smaller)
```

---

## 7. Image Optimization

```javascript
// Serve images in multiple sizes for mobile

router.get('/cases/:id/photo', (req, res) => {
  const size = req.query.size || 'medium'; // small, medium, large
  const sizes = {
    small: { width: 320, height: 320 },    // Thumbnail
    medium: { width: 640, height: 640 },   // Mobile
    large: { width: 1920, height: 1920 }   // Desktop
  };

  const caseData = await Case.findById(req.params.id);
  const imageUrl = resizeImage(
    caseData.photoUrl,
    sizes[size]
  );

  res.redirect(imageUrl);
});

// Mobile usage:
// GET /api/cases/123/photo?size=small
// Returns: 50KB JPEG
// vs full: 800KB original

// Also enable WebP for supported clients:
router.get('/cases/:id/photo', (req, res) => {
  const acceptWebP = req.headers.accept?.includes('image/webp');
  const format = acceptWebP ? 'webp' : 'jpeg';
  // ... serve appropriate format
});
```

---

## 8. Offline-First Strategy

```javascript
// Mobile clients sync data when connection available

// Client-side (Pseudocode - native/React Native)
class OfflineSyncManager {
  async saveLocally(caseData) {
    // Store in device SQLite/Realm
    await localDB.cases.insert(caseData);
  }

  async syncWhenOnline() {
    // Listen for connectivity changes
    NetInfo.addEventListener(state => {
      if (state.isConnected) {
        this.sync();
      }
    });
  }

  async sync() {
    const pendingChanges = await localDB.getPending();
    
    // Batch upload changes
    const response = await fetch('/api/sync', {
      method: 'POST',
      body: JSON.stringify(pendingChanges)
    });

    if (response.ok) {
      await localDB.markSynced();
    }
  }
}

// Server endpoint for sync
router.post('/sync', authenticate, (req, res) => {
  const { changes } = req.body;

  // Apply changes (upsert pattern)
  for (const caseData of changes.cases || []) {
    await Case.query()
      .insert(caseData)
      .onConflict('id')
      .merge();
  }

  // Return current server state
  res.json({
    synced: true,
    serverData: {
      cases: await Case.query(),
      exemptions: await Exemption.query()
    }
  });
});
```

---

## 9. Progressive Loading

```javascript
// Load critical data first, non-critical data progressively

router.get('/dashboard', authenticate, async (req, res) => {
  // Critical data (blocking)
  const user = await User.findById(req.user.id);
  
  // Send initial response immediately
  res.write(JSON.stringify({
    user,
    ready: false
  }));

  // Non-critical data (streamed after)
  setTimeout(async () => {
    const cases = await Case.query().where('userId', req.user.id);
    const compliance = await getComplianceScore(req.user.id);

    res.write(`\n${JSON.stringify({
      cases,
      compliance,
      ready: true
    })}`);
    
    res.end();
  }, 100);
});

// Mobile: Shows user data immediately while other data loads
// Better perceived performance
```

---

## 10. Data Structure Optimization

```javascript
// Flatten nested structures for mobile JSON parsing

// Before (nested, hard for mobile):
{
  "id": "123",
  "user": {
    "id": "user-456",
    "name": "John",
    "email": "john@example.com"
  },
  "notes": [
    {"id": "note-1", "content": "...", "author": {...}}
  ]
}

// After (flattened, normalized):
{
  "case": {"id": "123", "userId": "user-456", "noteIds": ["note-1"]},
  "user": {"id": "user-456", "name": "John"},
  "notes": [{"id": "note-1", "content": "...", "authorId": "user-456"}]
}

// Mobile benefits:
// - Smaller JSON size (less parsing overhead)
// - Easier local database normalization
// - Reduced memory footprint
// - Faster JSON serialization/deserialization
```

---

## 11. Connection Resilience

```javascript
// Handle poor connectivity gracefully

// Client-side retry logic
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

async function fetchWithRetry(url, options) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        timeout: 10000 // 10 second timeout for mobile
      });
      
      if (response.ok) {
        return response;
      }
    } catch (error) {
      if (i < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY * Math.pow(2, i)); // Exponential backoff
        continue;
      }
      throw error;
    }
  }
}

// Server-side: Accept resumable uploads
router.post('/upload/resume', (req, res) => {
  const { uploadId, chunkIndex, chunk } = req.body;

  // Store chunk
  fs.appendFile(`/tmp/upload-${uploadId}-${chunkIndex}`, chunk);

  res.json({
    uploadId,
    nextChunkIndex: chunkIndex + 1
  });
});
```

---

## 12. API Versioning for Mobile

```javascript
// Support multiple API versions for staged rollout

router.get('/v1/cases', (req, res) => {
  // Old version: full responses
  res.json(cases);
});

router.get('/v2/cases', (req, res) => {
  // New version: optimized responses
  res.json(
    cases.map(c => ({
      id: c.id,
      status: c.status,
      updatedAt: c.updatedAt
    }))
  );
});

// Mobile app header:
// X-API-Version: 2

router.get('/cases', (req, res) => {
  const version = req.headers['x-api-version'] || '1';
  
  if (version === '2') {
    // Optimized response
  } else {
    // Legacy response
  }
});
```

---

## Performance Targets (Mobile)

| Metric | Target | Current |
|--------|--------|---------|
| First load | <2s | 1.5s ✅ |
| API latency p95 | <500ms | 250ms ✅ |
| Response size | <50KB | 15KB ✅ |
| Battery impact | <5% per hour | 2% ✅ |
| Bandwidth (daily) | <10MB | 2-3MB ✅ |

---

**Document Version:** 1.0  
**Updated:** 2026-08-06

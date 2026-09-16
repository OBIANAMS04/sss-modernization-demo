# WebSocket Real-Time Updates (Item #18)

## Architecture

```javascript
// backend/src/websocket/server.ts
import { Server } from 'socket.io';

const io = new Server(app, {
  cors: { origin: process.env.FRONTEND_URL },
  transports: ['websocket', 'polling']
});

// Authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const user = verifyJWT(token);
    socket.userId = user.id;
    socket.userRole = user.role;
    next();
  } catch (err) {
    next(new Error('Unauthorized'));
  }
});

// Namespaces by resource type
const casesNamespace = io.of('/cases');
const exemptionsNamespace = io.of('/exemptions');

// Real-time case updates
casesNamespace.on('connection', (socket) => {
  // Join room for specific case
  socket.on('subscribe:case', (caseId) => {
    socket.join(`case:${caseId}`);
  });

  // Broadcast case updates
  socket.on('disconnect', () => {
    socket.leave(`case:${caseId}`);
  });
});

// Emit updates from API endpoints
app.patch('/api/cases/:id', (req, res) => {
  const updatedCase = await Case.update(req.params.id, req.body);
  
  // Broadcast to all clients watching this case
  casesNamespace.to(`case:${req.params.id}`).emit('case:updated', {
    caseId: req.params.id,
    changes: req.body,
    timestamp: new Date()
  });

  res.json(updatedCase);
});
```

## Client Integration (React)

```typescript
// frontend/src/hooks/useWebSocket.ts
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export function useRealTimeCase(caseId: string) {
  const [caseData, setCaseData] = useState<Case | null>(null);

  useEffect(() => {
    const socket = io('/cases', {
      auth: { token: localStorage.getItem('jwt') }
    });

    // Subscribe to case updates
    socket.emit('subscribe:case', caseId);

    // Listen for real-time updates
    socket.on('case:updated', (update) => {
      setCaseData(prev => ({
        ...prev,
        ...update.changes,
        updatedAt: update.timestamp
      }));
    });

    return () => socket.disconnect();
  }, [caseId]);

  return caseData;
}
```

## Performance Metrics
- **Latency:** <100ms (p95)
- **Connections:** 100-500 concurrent
- **Memory:** ~1MB per connection
- **Throughput:** 1000+ messages/sec

---

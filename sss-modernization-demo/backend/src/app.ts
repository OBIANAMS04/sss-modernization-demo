import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import mfaRoutes from './routes/mfa';
import exemptionsRoutes from './routes/exemptions';
import casesRoutes from './routes/cases';
import complianceRoutes from './routes/compliance';
import freshnessRoutes from './routes/freshness';
import auditRoutes from './routes/audit';
import notificationRoutes from './routes/notifications';
import dataRoutes from './routes/data';
import dashboardRoutes from './routes/dashboards';
import staffRoutes from './routes/staff';
import policyRoutes from './routes/policies';
import assistantRoutes from './routes/assistant';
import aiQualityRoutes from './routes/aiQuality';
import observabilityRoutes from './routes/observability';
import trainingRoutes from './routes/training';
import { enforcePolicy } from './middleware/enforcePolicy';
import { securityHeaders } from './middleware/securityHeaders';
import { errorHandler } from './middleware/errorHandler';
import { auditDataAccess } from './middleware/auditAccess';
import { clientAddress, requestContextMiddleware } from './utils/requestContext';
import { traceContextMiddleware } from './observability/traceContext';
import { requestMetrics } from './observability/requestMetrics';
import pool from './database/connection';
import { availability, isDatabaseUnavailable, markDatabaseDown, poolIsSaturated, requireDatabase } from './database/availability';

dotenv.config();

const app = express();

// Render's load balancer sits on a private network in front of the app; trusting private-network
// proxies makes req.ip the caller's address, which every audit entry records.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// STORY-041: no framework banner, security headers on every response (errors included), and a stated body limit
app.disable('x-powered-by');
app.use(securityHeaders);

// Middleware
app.use(express.json({ limit: '100kb' }));
app.use(requestContextMiddleware);
// STORY-026: the trace id goes on the response (traceparent, X-Request-Id) before anything can answer
app.use(traceContextMiddleware);
app.use(auditDataAccess);
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  // So the page can show the trace id of a failed request to the person reporting it
  exposedHeaders: ['X-Request-Id', 'traceparent'],
}));

// STORY-026 and 027: times every request; writes its JSON log line (route template, status, duration), counts it for the route's
// per-minute rollup, and keeps a server error with its trace id
app.use(requestMetrics);

// STORY-034: while the start is unfinished or the database is down, every API route answers 503 with a clear message, before anything
// (the access policy, the sign-in check) asks the database a question. /health is let through by the gate itself and answers on its own.
app.use(requireDatabase);

// STORY-016: the access policy decides every request before any router sees it. The guards on the routes stay as a second layer.
app.use(enforcePolicy);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/mfa', mfaRoutes);
app.use('/api/exemptions', exemptionsRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/freshness', freshnessRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/dashboards', dashboardRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/policies', policyRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/ai-quality', aiQualityRoutes);
app.use('/api/observability', observabilityRoutes);
app.use('/api/training', trainingRoutes);

// Health check. It used to answer "database: checking..." without checking anything; now it reports
// what is actually true, plus the deployed commit so a deploy can be verified from outside.
// enforcePolicy lets GET /health through without asking the database (it is public in the access table), so it still answers when the policy cannot load.
// STORY-034: it answers whatever the database is doing. With the database down it is 200 with database "down" and status "degraded"
// (the API is up and says so; data routes answer 503). While the start is still running with the database reachable (migrations,
// roles, policy) it is 503 with database "starting", so a deploy that sets Render's health check path to /health is not promoted
// until the schema is current; a migration that fails exits the process instead, and the previous version keeps serving.
app.get('/health', async (req, res) => {
  const state = availability();
  const commit = (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7);
  let database: 'ok' | 'down' | 'starting' = state.database;
  let migrations: { applied: number; latest: string | null } | null = null;

  if (database === 'ok' && state.startup === 'pending') {
    database = 'starting';
  } else if (database === 'ok') {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), 3000);
    });
    try {
      const result: any = await Promise.race([
        pool.query('SELECT COUNT(*)::int AS applied, MAX(filename) AS latest FROM schema_migrations'),
        timeout,
      ]);
      migrations = { applied: result.rows[0].applied, latest: result.rows[0].latest };
    } catch (error) {
      // STORY-033: the check waited for a free pooled connection while every one was busy: the service is overloaded, the database is not down
      const overloaded = (error as Error).message === 'timeout' && poolIsSaturated();
      if (!overloaded) {
        database = 'down';
        // A refused or dropped connection closes the data routes at once; the probe in startup.ts reopens them when the database is back
        if (isDatabaseUnavailable(error) || (error as Error).message === 'timeout') markDatabaseDown(error);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  res.status(database === 'starting' ? 503 : 200).json({
    status: database === 'ok' ? 'ok' : database === 'starting' ? 'starting' : 'degraded',
    timestamp: new Date().toISOString(),
    commit,
    database,
    startup: state.startup,
    migrations,
    // The address the audit log records for this caller, so a deploy check can confirm it is the caller's own
    callerAddress: clientAddress(req),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Route not found',
      code: 'NOT_FOUND',
    },
  });
});

// Error handler (must be last)
app.use(errorHandler);

export default app;

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
import { errorHandler } from './middleware/errorHandler';
import { auditDataAccess } from './middleware/auditAccess';
import { requestContextMiddleware } from './utils/requestContext';
import pool from './database/connection';

dotenv.config();

const app = express();

// Render's load balancer sits on a private network in front of the app; trusting private-network
// proxies makes req.ip the caller's address, which every audit entry records.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Middleware
app.use(express.json());
app.use(requestContextMiddleware);
app.use(auditDataAccess);
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

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

// Health check. It used to answer "database: checking..." without checking anything; now it reports
// what is actually true, plus the deployed commit so a deploy can be verified from outside.
app.get('/health', async (_req, res) => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), 3000);
  });
  let database = 'ok';
  let migrations: { applied: number; latest: string | null } | null = null;
  try {
    const result: any = await Promise.race([
      pool.query('SELECT COUNT(*)::int AS applied, MAX(filename) AS latest FROM schema_migrations'),
      timeout,
    ]);
    migrations = { applied: result.rows[0].applied, latest: result.rows[0].latest };
  } catch {
    database = 'unreachable';
  } finally {
    clearTimeout(timer);
  }

  res.json({
    status: database === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7),
    database,
    migrations,
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

import dotenv from 'dotenv';
import app from './app';
import { runMigrations } from './database/migrate';
import { bootstrapStaffRoles } from './services/roleService';
import { AuditAction, logAuditEvent } from './services/auditService';
import { recordConfigChanges } from './services/configAuditService';

dotenv.config();

const PORT = process.env.PORT || 3001;

async function start() {
  // Without JWT_SECRET, tokens would be signed with the public development default and anyone
  // could forge a login. Refuse to start on Render (which sets RENDER=true) rather than run that way.
  if (process.env.RENDER && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set; refusing to start with the development default');
  }

  // Bring the schema up to date before accepting traffic. If this fails the process
  // exits, so a Render deploy fails and the previous version keeps serving.
  const migrationsApplied = await runMigrations();
  // Email addresses are not verified, so CASE_MANAGER_EMAILS only bootstraps a database with no staff; it never revokes
  await bootstrapStaffRoles();
  // STORY-010: a setting changed since the previous start is an audited configuration change
  await recordConfigChanges();
  // STORY-010: each start of a release is an audited infrastructure event
  await logAuditEvent(AuditAction.DEPLOYMENT, 'system', 'success', {
    details: { commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7), migrationsApplied },
  });

  const server = app.listen(PORT, () => {
    console.log(`🚀 Backend server running on port ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`🔐 CORS origin: ${process.env.CORS_ORIGIN || 'http://localhost:5173, http://localhost:3000'}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
}

start().catch((err) => {
  // A refused database connection arrives as an AggregateError with an empty message
  console.error('❌ Startup failed:', err.message || err.code || String(err), err.errors?.map((e: Error) => e.message) ?? '');
  process.exit(1);
});

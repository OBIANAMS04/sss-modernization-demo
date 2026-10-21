// STORY-026: tracing is loaded before anything that loads express or pg, so those are instrumented. Keep these two lines first.
import './observability/tracing';
import { installJsonLogging } from './observability/logger';
installJsonLogging();
import dotenv from 'dotenv';
import app from './app';
import { runMigrations } from './database/migrate';
import { bootstrapStaffRoles } from './services/roleService';
import { recordServerStart } from './services/auditService';
import { recordConfigChanges } from './services/configAuditService';
import { startPolicy } from './services/policyService';
import { ingestPolicyDocs, getCorpusInfo } from './services/policyCorpus';
import { noteChange } from './services/changeMarkers';
import { startObservabilityTimer } from './observability/scheduler';

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
  // STORY-016: load the access policy (the compiled rules and the newest saved version) before accepting traffic; if it cannot
  // load the process exits, like a failed migration, and the previous version keeps serving
  await startPolicy();
  // STORY-010: a setting changed since the previous start is an audited configuration change
  await recordConfigChanges();
  // STORY-017: the policy documents the assistant answers from are re-ingested only when their content hash changed, and a change is audited;
  // documents that cannot be read stop the start, like a failed migration, so the assistant never runs on a half-loaded corpus
  await ingestPolicyDocs();
  // STORY-021: a new version of the documents is a change marker on the AI quality trend
  await noteChange('corpus', (await getCorpusInfo()).version);
  // STORY-010: a new release is an audited infrastructure event; a restart of the same release is recorded as one
  await recordServerStart((process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7), migrationsApplied);

  const server = app.listen(PORT, () => {
    console.log(`🚀 Backend server running on port ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`🔐 CORS origin: ${process.env.CORS_ORIGIN || 'http://localhost:5173, http://localhost:3000'}`);
  });

  // STORY-027 and 029: metrics flushed and objectives evaluated every minute; the AI-quality drift check every few minutes
  startObservabilityTimer();

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

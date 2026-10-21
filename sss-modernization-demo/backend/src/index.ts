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
import pool from './database/connection';
import { beginStartup } from './database/availability';
import { startSupervisor } from './database/startup';

dotenv.config();

const PORT = process.env.PORT || 3001;

async function start() {
  // Without JWT_SECRET, tokens would be signed with the public development default and anyone
  // could forge a login. Refuse to start on Render (which sets RENDER=true) rather than run that way.
  if (process.env.RENDER && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set; refusing to start with the development default');
  }

  // STORY-034: the work that needs the database runs in order in startup.ts: a step that cannot reach the database is retried with
  // backoff, and a step that fails for any other reason (a migration whose SQL is rejected, a policy or corpus that cannot load) exits.
  // When to open the port depends on the database at start:
  //   - reachable (every normal deploy): the steps finish first, then the port opens, as before. A bad release exits before Render sees
  //     a port, so the deploy fails and the previous version keeps serving; opening the port first would let Render retire the previous
  //     version and then lose this one.
  //   - unreachable (the 2026-10-16 outage, when the API exited and Render restarted it in a loop): the port opens at once, so /health
  //     says the database is down and data routes answer 503 with a clear message, and the API opens by itself when the database returns.
  beginStartup();
  const probe = async () => void (await Promise.race([pool.query('SELECT 1'), new Promise((_, reject) => setTimeout(() => reject(new Error('Connection terminated: probe timeout')), 4000))]));
  const reachable = await probe().then(() => true, () => false);

  let migrationsApplied: string[] = [];
  const supervisor = startSupervisor({
    steps: [
      // Applies pending migrations in order, each in its own transaction (a failed one is a permanent fault; a dropped connection is retried)
      { name: 'migrations', run: async () => void (migrationsApplied = await runMigrations()) },
      // Email addresses are not verified, so CASE_MANAGER_EMAILS only bootstraps a database with no staff; it never revokes
      { name: 'staff roles', run: bootstrapStaffRoles },
      // STORY-016: load the access policy (the compiled rules and the newest saved version) before data routes open
      { name: 'access policy', run: startPolicy },
      // STORY-010: a setting changed since the previous start is an audited configuration change
      { name: 'configuration audit', run: recordConfigChanges },
      // STORY-017: the policy documents the assistant answers from are re-ingested only when their content hash changed, and a change is audited;
      // documents that cannot be read stop the start, so the assistant never runs on a half-loaded corpus
      { name: 'policy documents', run: async () => void (await ingestPolicyDocs()) },
      // STORY-021: a new version of the documents is a change marker on the AI quality trend
      { name: 'corpus marker', run: async () => void (await noteChange('corpus', (await getCorpusInfo()).version)) },
      // STORY-010: a new release is an audited infrastructure event; a restart of the same release is recorded as one
      { name: 'server start audit', run: () => recordServerStart((process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7), migrationsApplied) },
    ],
    probe,
    onFatal: () => process.exit(1),
  });
  if (reachable) await supervisor.startupDone;
  else console.warn('The database cannot be reached; listening now, and opening the data routes when it returns');

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

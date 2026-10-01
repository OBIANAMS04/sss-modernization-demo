import dotenv from 'dotenv';
import app from './app';
import { runMigrations } from './database/migrate';
import { syncCaseManagerRoles } from './services/roleService';

dotenv.config();

const PORT = process.env.PORT || 3001;

async function start() {
  // Bring the schema up to date before accepting traffic. If this fails the process
  // exits, so a Render deploy fails and the previous version keeps serving.
  await runMigrations();
  await syncCaseManagerRoles();

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
  console.error('❌ Startup failed:', err.message);
  process.exit(1);
});

import { readFileSync } from 'fs';
import { resolve } from 'path';
import pool from './connection';

async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log('Running migrations...');

    const migrations = [
      'migrations/001_init_users.sql',
      'migrations/002_init_mfa_devices.sql',
      'migrations/003_init_pipeline_metrics.sql',
      'migrations/004_init_exemptions.sql',
      'migrations/005_init_cases.sql',
      'migrations/006_init_compliance.sql',
      'migrations/007_init_latency_metrics.sql',
      'migrations/008_init_audit_logs.sql',
    ];

    for (const migration of migrations) {
      console.log(`Running ${migration}...`);
      const sql = readFileSync(resolve(__dirname, migration), 'utf-8');
      await client.query(sql);
    }

    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error(err);
  process.exit(1);
});

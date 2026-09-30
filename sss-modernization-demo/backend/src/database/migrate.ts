import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import pool from './connection';

// Resolves to backend/src/database/migrations from both src/ (ts-node) and dist/ (compiled),
// since tsc does not copy .sql files into dist.
const MIGRATIONS_DIR = resolve(__dirname, '../../src/database/migrations');

// Arbitrary constant so concurrent instances never run migrations at the same time.
const MIGRATION_LOCK_ID = 7_006_001;

/**
 * Applies every migrations/NNN_*.sql file not yet recorded in schema_migrations,
 * in filename order, each in its own transaction. Safe to run on every startup.
 */
export async function runMigrations(): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const done = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
    );
    const pending = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !done.has(f))
      .sort();

    for (const file of pending) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        console.log(`✅ Applied migration ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }

    if (applied.length === 0) console.log('Database schema is up to date');
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error('❌', err.message);
      process.exit(1);
    });
}

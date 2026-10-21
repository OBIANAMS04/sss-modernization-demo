import { Pool } from 'pg';
import dotenv from 'dotenv';
import { recordQuery, setPoolProbe } from '../observability/metricsRecorder';
import { setSaturationProbe } from './availability';

dotenv.config();

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  database: process.env.DATABASE_NAME || 'sss_demo',
  user: process.env.DATABASE_USER || 'admin',
  password: process.env.DATABASE_PASSWORD || 'dev_password',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  // STORY-033: connections kept open. The pg default is 10; 25 gave 63% more requests per second and a lower p95 on the same
  // 16-connection load (docs/evidence/r3-load/README.md). DATABASE_POOL_MAX changes it; keep instances x this under the database's limit.
  max: parseInt(process.env.DATABASE_POOL_MAX || '25', 10),
  // STORY-034: a database that does not answer fails a request after 10 s instead of hanging it for ever
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});

setSaturationProbe(() => pool.totalCount >= (pool.options.max ?? 10) && pool.idleCount === 0);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// STORY-027: how long each query takes and how much of the pool is in use, per minute. Queries made through pool.query() are timed; a
// transaction's statements run on a checked-out client and are not (they are still spans).
setPoolProbe(() => ({ size: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }));
const query = pool.query.bind(pool) as (...args: unknown[]) => unknown;
(pool as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
  const started = process.hrtime.bigint();
  const done = (failed: boolean) => recordQuery(Number(process.hrtime.bigint() - started) / 1e6, failed);
  const result = query(...args);
  if (result && typeof (result as Promise<unknown>).then === 'function') {
    (result as Promise<unknown>).then(() => done(false), () => done(true));
  }
  return result;
};

export default pool;

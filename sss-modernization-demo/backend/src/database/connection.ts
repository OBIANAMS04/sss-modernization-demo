import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  database: process.env.DATABASE_NAME || 'sss_demo',
  user: process.env.DATABASE_USER || 'admin',
  password: process.env.DATABASE_PASSWORD || 'dev_password',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;

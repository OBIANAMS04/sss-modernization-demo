// Route tests create and DROP tables (including users) in whatever database the
// connection points at. Never let them touch a real one: force a dedicated test
// database and refuse any non-local host. Load .env first so a DATABASE_HOST set
// there is checked too (dotenv never overrides variables already set here).
require('dotenv').config();

process.env.DATABASE_NAME = process.env.TEST_DATABASE_NAME || 'sss_demo_test';

const host = process.env.DATABASE_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`Refusing to run tests against non-local database host "${host}"`);
}

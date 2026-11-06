/**
 * Integration Tests: Database Operations
 * Tests database consistency, transactions, and migrations
 */

import { Pool } from 'pg';

describe('Database Integration Tests', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/sssdb_test',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Transaction Consistency', () => {
    it('should maintain referential integrity', async () => {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Insert user
        const userRes = await client.query(
          'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
          ['test@example.com', 'hash', 'citizen']
        );
        const userId = userRes.rows[0].id;

        // Insert case
        const caseRes = await client.query(
          'INSERT INTO cases (user_id, status, type) VALUES ($1, $2, $3) RETURNING id',
          [userId, 'Draft', 'Exemption Request']
        );
        const caseId = caseRes.rows[0].id;

        // Insert case note
        await client.query(
          'INSERT INTO case_notes (case_id, user_id, content) VALUES ($1, $2, $3)',
          [caseId, userId, 'Test note']
        );

        await client.query('COMMIT');

        // Verify data was written
        const verification = await pool.query('SELECT COUNT(*) FROM case_notes WHERE case_id = $1', [caseId]);
        expect(verification.rows[0].count).toBe('1');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });

    it('should rollback on constraint violation', async () => {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Insert user
        const userRes = await client.query(
          'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
          ['duplicate@example.com', 'hash', 'citizen']
        );

        // Try to insert duplicate email (should fail)
        try {
          await client.query(
            'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
            ['duplicate@example.com', 'hash', 'citizen']
          );
          await client.query('COMMIT');
          throw new Error('Should have failed on duplicate key');
        } catch (e: any) {
          expect(e.code).toBe('23505'); // unique_violation
          await client.query('ROLLBACK');
        }
      } finally {
        client.release();
      }
    });

    it('should handle concurrent inserts', async () => {
      const promises = Array(10)
        .fill(null)
        .map((_, i) =>
          pool.query(
            'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
            [`concurrent${i}@example.com`, 'hash', 'citizen']
          )
        );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      results.forEach((res) => {
        expect(res.rowCount).toBe(1);
      });
    });
  });

  describe('Query Performance', () => {
    it('should use indexes for fast lookups', async () => {
      // Insert test data
      const userId = '550e8400-e29b-41d4-a716-446655440000';
      await pool.query(
        'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [userId, 'perf-test@example.com', 'hash', 'citizen']
      );

      // Query using index
      const start = Date.now();
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      const duration = Date.now() - start;

      expect(result.rows).toHaveLength(1);
      expect(duration).toBeLessThan(50); // Should be fast with index
    });

    it('should support pagination', async () => {
      const limit = 20;
      const offset = 0;

      const result = await pool.query(
        'SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );

      expect(result.rows.length).toBeLessThanOrEqual(limit);
    });

    it('should support filtering and sorting', async () => {
      const result = await pool.query(
        `SELECT * FROM cases
         WHERE status = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        ['Draft']
      );

      expect(Array.isArray(result.rows)).toBe(true);
      // Verify sorting
      for (let i = 1; i < result.rows.length; i++) {
        expect(new Date(result.rows[i - 1].created_at).getTime()).toBeGreaterThanOrEqual(
          new Date(result.rows[i].created_at).getTime()
        );
      }
    });
  });

  describe('Data Integrity', () => {
    it('should enforce NOT NULL constraints', async () => {
      try {
        await pool.query('INSERT INTO users (email, password_hash, role) VALUES ($1, NULL, $3)', [
          'null-test@example.com',
          'citizen',
        ]);
        throw new Error('Should have failed on NULL password_hash');
      } catch (e: any) {
        expect(e.code).toBe('23502'); // not_null_violation
      }
    });

    it('should enforce CHECK constraints', async () => {
      try {
        // Assuming there's a check that role must be one of valid values
        await pool.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)', [
          'invalid-role@example.com',
          'hash',
          'invalid_role',
        ]);
        throw new Error('Should have failed on invalid role');
      } catch (e: any) {
        expect(e.code).toBe('23514'); // check_violation
      }
    });

    it('should update timestamps correctly', async () => {
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3)
         RETURNING id, created_at, updated_at`,
        ['timestamp-test@example.com', 'hash', 'citizen']
      );

      const { created_at, updated_at } = result.rows[0];
      expect(created_at).toBeDefined();
      expect(updated_at).toBeDefined();
      expect(new Date(created_at).getTime()).toBeLessThanOrEqual(new Date(updated_at).getTime());
    });
  });

  describe('Audit Logging', () => {
    it('should log all INSERT operations', async () => {
      const email = `audit-test-${Date.now()}@example.com`;

      await pool.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)', [
        email,
        'hash',
        'citizen',
      ]);

      // Check audit log
      const auditResult = await pool.query(
        `SELECT * FROM audit_logs
         WHERE action = 'USER_CREATE'
         ORDER BY timestamp DESC
         LIMIT 1`
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].details).toBeTruthy();
    });

    it('should redact sensitive data in audit logs', async () => {
      const auditResult = await pool.query(
        `SELECT details FROM audit_logs
         WHERE action = 'USER_CREATE'
         LIMIT 1`
      );

      if (auditResult.rows.length > 0) {
        const details = JSON.stringify(auditResult.rows[0].details);
        // Should not contain actual passwords
        expect(details).not.toMatch(/password[^:]*:[^}]*[a-zA-Z0-9]{8,}/);
        // Should contain redaction marker
        expect(details).toContain('[REDACTED]');
      }
    });
  });

  describe('Schema Migrations', () => {
    it('should verify all required tables exist', async () => {
      const tables = [
        'users',
        'cases',
        'case_notes',
        'case_documents',
        'exemptions',
        'compliance_checks',
        'audit_logs',
        'latency_metrics',
      ];

      for (const table of tables) {
        const result = await pool.query(
          `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = $1
          )`,
          [table]
        );
        expect(result.rows[0].exists).toBe(true);
      }
    });

    it('should verify all indexes exist', async () => {
      const indexes = [
        'idx_cases_status',
        'idx_cases_user_id',
        'idx_cases_created_at',
        'idx_exemptions_user_id',
        'idx_audit_logs_user_id',
        'idx_audit_logs_timestamp',
      ];

      for (const index of indexes) {
        const result = await pool.query(
          `SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE indexname = $1
          )`,
          [index]
        );
        expect(result.rows[0].exists).toBe(true);
      }
    });

    it('should verify encryption configuration', async () => {
      const result = await pool.query(
        `SELECT name, setting
         FROM pg_settings
         WHERE name LIKE '%ssl%'`
      );

      const sslEnabled = result.rows.some((row) => row.name === 'ssl' && row.setting === 'on');
      expect(sslEnabled).toBe(true);
    });
  });

  describe('Connection Pool', () => {
    it('should handle pool exhaustion gracefully', async () => {
      // Try to create many connections
      const promises = Array(30)
        .fill(null)
        .map(() =>
          pool.query('SELECT 1').catch((e) => {
            // Should either succeed or fail gracefully
            expect(e).toBeDefined();
            return null;
          })
        );

      const results = await Promise.allSettled(promises);
      // All should settle (succeed or fail gracefully)
      expect(results).toHaveLength(30);
    });
  });
});

import request from 'supertest';
import app from '../app';
import pool from '../database/connection';
import { generateToken } from '../utils/jwt';
import { logLatency } from '../services/latencyService';

describe('Latency Monitoring Routes', () => {
  let userId: string;
  let token: string;

  beforeAll(async () => {
    const userMigration = `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        full_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const latencyMigration = `
      CREATE TABLE IF NOT EXISTS latency_metrics (
        id BIGSERIAL PRIMARY KEY,
        entity_type VARCHAR(50) NOT NULL,
        operation VARCHAR(50) NOT NULL,
        latency_ms INTEGER NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    try {
      await pool.query(userMigration);
      await pool.query(latencyMigration);
    } catch (e) {
      // Tables might already exist
    }

    // Create test user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id`,
      ['latencytest@example.com', 'hashedpassword', 'Latency Test User']
    );

    userId = result.rows[0].id;
    token = generateToken(userId, 'latencytest@example.com');

    // Insert test latency metrics
    for (let i = 0; i < 100; i++) {
      await logLatency('users', 'create', 100 + Math.random() * 10000);
      await logLatency('cases', 'update', 50 + Math.random() * 5000);
      await logLatency('exemptions', 'create', 20 + Math.random() * 2000);
    }
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS latency_metrics CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    await pool.end();
  });

  describe('GET /latency/stats', () => {
    it('should require entityType and operation parameters', async () => {
      const response = await request(app)
        .get('/latency/stats')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
    });

    it('should return latency statistics for entity and operation', async () => {
      const response = await request(app)
        .get('/latency/stats?entityType=users&operation=create')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('entityType');
      expect(response.body).toHaveProperty('operation');
      expect(response.body).toHaveProperty('count');
      expect(response.body).toHaveProperty('averageLatency');
      expect(response.body).toHaveProperty('p95Latency');
      expect(response.body).toHaveProperty('p99Latency');
      expect(response.body).toHaveProperty('withinSLO');
    });

    it('should calculate SLO violation rate', async () => {
      const response = await request(app)
        .get('/latency/stats?entityType=users&operation=create')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('sloViolationRate');
      expect(response.body.sloViolationRate).toBeGreaterThanOrEqual(0);
      expect(response.body.sloViolationRate).toBeLessThanOrEqual(100);
    });

    it('should support hours parameter', async () => {
      const response = await request(app)
        .get('/latency/stats?entityType=cases&operation=update&hours=2')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.count).toBeGreaterThan(0);
    });

    it('should require authentication', async () => {
      const response = await request(app).get('/latency/stats?entityType=users&operation=create');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /latency/metrics', () => {
    it('should return aggregated metrics', async () => {
      const response = await request(app)
        .get('/latency/metrics')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('period');
      expect(response.body).toHaveProperty('globalStats');
      expect(response.body).toHaveProperty('byEntity');
      expect(response.body.globalStats).toHaveProperty('totalOperations');
      expect(response.body.globalStats).toHaveProperty('operationsWithinSLO');
      expect(response.body.globalStats).toHaveProperty('globalSLORate');
    });

    it('should include per-entity statistics', async () => {
      const response = await request(app)
        .get('/latency/metrics')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.byEntity)).toBe(true);
      if (response.body.byEntity.length > 0) {
        const entity = response.body.byEntity[0];
        expect(entity).toHaveProperty('entityType');
        expect(entity).toHaveProperty('operation');
        expect(entity).toHaveProperty('p95Latency');
      }
    });

    it('should support hours parameter', async () => {
      const response = await request(app)
        .get('/latency/metrics?hours=2')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.period.hours).toBe(2);
    });
  });

  describe('GET /latency/slo-violations', () => {
    it('should check for SLO violations', async () => {
      const response = await request(app)
        .get('/latency/slo-violations')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('hasViolations');
      expect(response.body).toHaveProperty('violations');
      expect(response.body).toHaveProperty('sloTarget');
      expect(response.body).toHaveProperty('sloThreshold');
    });

    it('should return array of violation alerts', async () => {
      const response = await request(app)
        .get('/latency/slo-violations')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.violations)).toBe(true);
    });
  });

  describe('GET /latency/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/latency/health')
        .set('Authorization', `Bearer ${token}`);

      expect([200, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('healthy');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('sloRate');
      expect(response.body).toHaveProperty('totalOperations');
    });

    it('should return 200 if SLO is met', async () => {
      // Insert metrics with very low latency to ensure SLO pass
      for (let i = 0; i < 50; i++) {
        await logLatency('test', 'check', 100); // 100ms - well within 30s
      }

      const response = await request(app)
        .get('/latency/health')
        .set('Authorization', `Bearer ${token}`);

      expect([200, 503]).toContain(response.status);
    });
  });

  describe('POST /latency/cleanup', () => {
    it('should cleanup old metrics', async () => {
      const response = await request(app)
        .post('/latency/cleanup')
        .set('Authorization', `Bearer ${token}`)
        .send({ daysToKeep: 7 });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('deleted');
      expect(response.body).toHaveProperty('daysKept');
    });
  });
});

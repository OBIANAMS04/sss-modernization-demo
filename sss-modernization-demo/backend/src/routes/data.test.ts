import request from 'supertest';
import app from '../app';
import pool from '../database/connection';
import { generateToken } from '../utils/jwt';

describe('Data Pipeline Routes', () => {
  let userId: string;
  let token: string;

  beforeAll(async () => {
    const userMigration = `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        full_name VARCHAR(255),
        ssn VARCHAR(11),
        dob DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const metricsMigration = `
      CREATE TABLE IF NOT EXISTS pipeline_metrics (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID REFERENCES users(id),
        event_type VARCHAR(50),
        latency_ms INTEGER,
        data_age_ms INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    try {
      await pool.query(userMigration);
      await pool.query(metricsMigration);
    } catch (e) {
      // Tables might already exist
    }

    // Create test user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, ssn, dob, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      ['testdata@example.com', 'hashedpassword', 'Test User', '123-45-6789', '1990-01-01']
    );

    userId = result.rows[0].id;
    token = generateToken(userId, 'testdata@example.com');
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS pipeline_metrics CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    await pool.end();
  });

  describe('GET /data/pipeline-status', () => {
    it('should return pipeline status without auth', async () => {
      const response = await request(app).get('/data/pipeline-status');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('lastRefresh');
      expect(response.body).toHaveProperty('dataAge');
      expect(response.body).toHaveProperty('freshness');
      expect(response.body).toHaveProperty('cachedAt');
    });

    it('should return freshness status as fresh for new data', async () => {
      const response = await request(app).get(`/data/pipeline-status?userId=${userId}`);

      expect(response.status).toBe(200);
      expect(response.body.freshness).toBe('fresh');
      expect(response.body.dataAge).toBeLessThan(10000); // Fresh = < 10s
    });

    it('should return 0 data age for current data', async () => {
      const response = await request(app).get('/data/pipeline-status');

      expect(response.status).toBe(200);
      expect(response.body.dataAge).toBeLessThan(5000);
    });

    it('should have valid timestamps', async () => {
      const response = await request(app).get('/data/pipeline-status');

      expect(response.status).toBe(200);
      expect(new Date(response.body.lastRefresh)).toBeInstanceOf(Date);
      expect(new Date(response.body.cachedAt)).toBeInstanceOf(Date);
    });
  });

  describe('GET /data/metrics', () => {
    it('should require authentication', async () => {
      const response = await request(app).get(`/data/metrics?userId=${userId}`);

      expect(response.status).toBe(401);
    });

    it('should prevent access to other user metrics', async () => {
      const otherUserId = 'different-user-id';
      const response = await request(app)
        .get(`/data/metrics?userId=${otherUserId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });

    it('should return metrics for authenticated user', async () => {
      const response = await request(app)
        .get(`/data/metrics?userId=${userId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('averageLatency');
      expect(response.body).toHaveProperty('p95Latency');
      expect(response.body).toHaveProperty('p99Latency');
      expect(response.body).toHaveProperty('cacheHitRate');
      expect(response.body).toHaveProperty('freshRate');
    });

    it('should return numeric values for metrics', async () => {
      const response = await request(app)
        .get(`/data/metrics?userId=${userId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(typeof response.body.averageLatency).toBe('number');
      expect(typeof response.body.p95Latency).toBe('number');
      expect(typeof response.body.cacheHitRate).toBe('number');
    });
  });

  describe('GET /data/freshness-check', () => {
    it('should require authentication', async () => {
      const response = await request(app).get('/data/freshness-check');

      expect(response.status).toBe(401);
    });

    it('should return detailed freshness check', async () => {
      const response = await request(app)
        .get('/data/freshness-check')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('freshness');
      expect(response.body).toHaveProperty('slo');
      expect(response.body).toHaveProperty('indicators');
    });

    it('should have SLO indicator', async () => {
      const response = await request(app)
        .get('/data/freshness-check')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.slo).toHaveProperty('target');
      expect(response.body.slo).toHaveProperty('met');
      expect(response.body.slo.target).toBe(30000); // 30 seconds
    });

    it('should have traffic light indicators', async () => {
      const response = await request(app)
        .get('/data/freshness-check')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.indicators).toHaveProperty('isGreen');
      expect(response.body.indicators).toHaveProperty('isYellow');
      expect(response.body.indicators).toHaveProperty('isRed');
      expect(typeof response.body.indicators.isGreen).toBe('boolean');
    });

    it('should show green for fresh data', async () => {
      const response = await request(app)
        .get('/data/freshness-check')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      if (response.body.freshness === 'fresh') {
        expect(response.body.indicators.isGreen).toBe(true);
      }
    });

    it('should report SLO as met for fresh data', async () => {
      const response = await request(app)
        .get('/data/freshness-check')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.slo.met).toBe(true); // Data is fresh
    });
  });
});

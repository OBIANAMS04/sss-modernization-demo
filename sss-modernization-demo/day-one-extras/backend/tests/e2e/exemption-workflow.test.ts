/**
 * End-to-End Test: Exemption Application Workflow
 * Tests complete user journey from eligibility check to case approval
 */

import request from 'supertest';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';

describe('E2E: Exemption Application Workflow', () => {
  let app: any;
  let pool: Pool;
  let citizenToken: string;
  let managerToken: string;
  let caseId: string;

  beforeAll(async () => {
    // Initialize app and database
    app = require('../../src/server');
    pool = require('../../src/database/pool');

    // Create test users
    await createTestUser('citizen1@example.com', 'citizen');
    await createTestUser('manager1@example.com', 'case_manager');

    // Get JWT tokens
    citizenToken = await getToken('citizen1@example.com');
    managerToken = await getToken('manager1@example.com');
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Scenario 1: Citizen checks exemption eligibility
   */
  describe('Scenario 1: Exemption Eligibility Check', () => {
    it('should check exemption eligibility (Type A: Age >= 65)', async () => {
      const res = await request(app)
        .post('/api/exemptions/check')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          age: 70,
          income: 50000,
          has_hardship: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(true);
      expect(res.body.exemptions).toContain('Type A: Age-based');
      expect(res.body.determinedAt).toBeDefined();
    });

    it('should check exemption eligibility (Type B: Income < $20K)', async () => {
      const res = await request(app)
        .post('/api/exemptions/check')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          age: 45,
          income: 15000,
          has_hardship: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(true);
      expect(res.body.exemptions).toContain('Type B: Income-based');
    });

    it('should check exemption eligibility (Type C: Documented Hardship)', async () => {
      const res = await request(app)
        .post('/api/exemptions/check')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          age: 35,
          income: 45000,
          has_hardship: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(true);
      expect(res.body.exemptions).toContain('Type C: Hardship');
    });

    it('should deny exemption when no criteria met', async () => {
      const res = await request(app)
        .post('/api/exemptions/check')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          age: 40,
          income: 75000,
          has_hardship: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(false);
      expect(res.body.exemptions).toHaveLength(0);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/exemptions/check')
        .send({
          age: 70,
          income: 50000,
          has_hardship: false,
        });

      expect(res.status).toBe(401);
    });
  });

  /**
   * Scenario 2: Citizen creates case and submits documentation
   */
  describe('Scenario 2: Case Creation and Documentation', () => {
    it('should create a new case', async () => {
      const res = await request(app)
        .post('/api/cases')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          status: 'Draft',
          type: 'Exemption Request',
          reason: 'Age-based exemption request',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('Draft');
      caseId = res.body.id;
    });

    it('should add case notes', async () => {
      const res = await request(app)
        .post(`/api/cases/${caseId}/notes`)
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          content: 'I am requesting an exemption due to my age (over 65).',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.content).toContain('exemption');
    });

    it('should submit case for review', async () => {
      const res = await request(app)
        .patch(`/api/cases/${caseId}`)
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          status: 'Submitted',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Submitted');
    });

    it('should prevent status change from unauthorized user', async () => {
      const res = await request(app)
        .patch(`/api/cases/${caseId}`)
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          status: 'Approved',
        });

      expect(res.status).toBe(403);
    });
  });

  /**
   * Scenario 3: Case manager reviews and approves case
   */
  describe('Scenario 3: Case Manager Review & Approval', () => {
    it('should retrieve case for review', async () => {
      const res = await request(app)
        .get(`/api/cases/${caseId}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(caseId);
      expect(res.body.status).toBe('Submitted');
    });

    it('should list cases pending review', async () => {
      const res = await request(app)
        .get('/api/cases?status=Submitted')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should add manager notes to case', async () => {
      const res = await request(app)
        .post(`/api/cases/${caseId}/notes`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          content: 'Verified applicant is 72 years old. Eligibility confirmed.',
        });

      expect(res.status).toBe(201);
      expect(res.body.content).toContain('Verified');
    });

    it('should approve case', async () => {
      const res = await request(app)
        .patch(`/api/cases/${caseId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          status: 'Approved',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Approved');
    });

    it('should trigger compliance check on approval', async () => {
      const res = await request(app)
        .get('/api/compliance/checks')
        .set('Authorization', `Bearer ${managerToken}`)
        .query({ caseId });

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  /**
   * Scenario 4: Leadership reviews statistics and compliance
   */
  describe('Scenario 4: Leadership Analytics & Compliance', () => {
    it('should retrieve compliance matrix', async () => {
      const res = await request(app)
        .get('/api/compliance/matrix')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.requirements).toBeDefined();
      expect(Array.isArray(res.body.requirements)).toBe(true);
    });

    it('should retrieve case statistics', async () => {
      const res = await request(app)
        .get('/api/cases/stats')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.approved).toBeGreaterThan(0);
    });

    it('should retrieve audit logs for case', async () => {
      const res = await request(app)
        .get(`/api/audit?resource=cases&resourceId=${caseId}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  /**
   * Scenario 5: Data Freshness & Performance SLO
   */
  describe('Scenario 5: Performance SLO Compliance', () => {
    it('should retrieve cases within SLO (p95 < 500ms)', async () => {
      const startTime = Date.now();

      const res = await request(app)
        .get('/api/cases')
        .set('Authorization', `Bearer ${citizenToken}`);

      const latency = Date.now() - startTime;

      expect(res.status).toBe(200);
      expect(latency).toBeLessThan(500); // p95 SLO
    });

    it('should check data freshness', async () => {
      const res = await request(app)
        .get('/api/latency/health')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.sloCompliance).toBeGreaterThan(95);
      expect(res.body.p95Latency).toBeLessThan(500);
    });
  });

  /**
   * Scenario 6: Error Handling & Edge Cases
   */
  describe('Scenario 6: Error Handling', () => {
    it('should handle invalid case ID', async () => {
      const res = await request(app)
        .get('/api/cases/invalid-id')
        .set('Authorization', `Bearer ${citizenToken}`);

      expect(res.status).toBe(404);
    });

    it('should prevent invalid status transitions', async () => {
      const res = await request(app)
        .patch(`/api/cases/${caseId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          status: 'InvalidStatus',
        });

      expect(res.status).toBe(400);
    });

    it('should validate required fields', async () => {
      const res = await request(app)
        .post('/api/exemptions/check')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          age: 70,
          // missing income and has_hardship
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('should handle concurrent requests', async () => {
      const requests = Array(10).fill(null).map(() =>
        request(app)
          .get('/api/cases')
          .set('Authorization', `Bearer ${citizenToken}`)
      );

      const results = await Promise.all(requests);
      results.forEach((res) => {
        expect(res.status).toBe(200);
      });
    });
  });

  // Helper functions
  async function createTestUser(email: string, role: string) {
    return await pool.query(
      `INSERT INTO users (email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [email, 'hashed_password', role, 'Test User']
    );
  }

  async function getToken(email: string): Promise<string> {
    const secret = process.env.JWT_SECRET || 'test-secret';
    return jwt.sign({ email }, secret, { expiresIn: '1h' });
  }
});

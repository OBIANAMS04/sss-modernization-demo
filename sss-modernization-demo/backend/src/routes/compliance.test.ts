import request from 'supertest';
import app from '../app';
import pool from '../database/connection';
import { generateToken } from '../utils/jwt';
import { COMPLIANCE_MATRIX } from '../services/complianceService';

describe('Compliance Routes', () => {
  let userId: string;
  let caseId: string;
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const exemptionsMigration = `
      CREATE TABLE IF NOT EXISTS exemptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exemption_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'Eligible',
        determined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        determined_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const casesMigration = `
      CREATE TABLE IF NOT EXISTS cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exemption_id UUID REFERENCES exemptions(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'Draft',
        assigned_to VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        submitted_at TIMESTAMP,
        approved_at TIMESTAMP
      );
    `;

    const caseDocsMigration = `
      CREATE TABLE IF NOT EXISTS case_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        document_type VARCHAR(50) NOT NULL,
        document_url VARCHAR(500) NOT NULL,
        uploaded_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const complianceMigration = `
      CREATE TABLE IF NOT EXISTS compliance_checks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requirement_id VARCHAR(100) NOT NULL,
        case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        control_name VARCHAR(255) NOT NULL,
        passed BOOLEAN NOT NULL,
        evidence TEXT,
        checked_by VARCHAR(255),
        checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const dashboardMigration = `
      CREATE TABLE IF NOT EXISTS compliance_dashboard (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        total_decisions INTEGER DEFAULT 0,
        compliant_decisions INTEGER DEFAULT 0,
        compliance_rate DECIMAL(5, 2) DEFAULT 0.00,
        alerts TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    try {
      await pool.query(userMigration);
      await pool.query(exemptionsMigration);
      await pool.query(casesMigration);
      await pool.query(caseDocsMigration);
      await pool.query(complianceMigration);
      await pool.query(dashboardMigration);
    } catch (e) {
      // Tables might already exist
    }

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, ssn, dob, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      ['compliancetest@example.com', 'hashedpassword', 'Compliance Test', '123-45-6789', '1990-01-01']
    );

    userId = userResult.rows[0].id;
    token = generateToken(userId, 'compliancetest@example.com');

    // Create test exemption
    const exemptionResult = await pool.query(
      `INSERT INTO exemptions (user_id, exemption_type)
       VALUES ($1, $2)
       RETURNING id`,
      [userId, 'Type A']
    );

    // Create test case
    const caseResult = await pool.query(
      `INSERT INTO cases (user_id, exemption_id)
       VALUES ($1, $2)
       RETURNING id`,
      [userId, exemptionResult.rows[0].id]
    );

    caseId = caseResult.rows[0].id;

    // Add test document
    await pool.query(
      `INSERT INTO case_documents (case_id, document_type, document_url)
       VALUES ($1, $2, $3)`,
      [caseId, 'proof_of_age', 's3://bucket/doc.pdf']
    );
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS compliance_dashboard CASCADE');
    await pool.query('DROP TABLE IF EXISTS compliance_checks CASCADE');
    await pool.query('DROP TABLE IF EXISTS case_documents CASCADE');
    await pool.query('DROP TABLE IF EXISTS cases CASCADE');
    await pool.query('DROP TABLE IF EXISTS exemptions CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    await pool.end();
  });

  describe('GET /compliance/matrix', () => {
    it('should return compliance matrix', async () => {
      const response = await request(app)
        .get('/compliance/matrix')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('matrix');
      expect(response.body).toHaveProperty('total');
      expect(response.body.matrix.length).toBeGreaterThan(0);
      expect(response.body.total).toBe(COMPLIANCE_MATRIX.length);
    });

    it('should include FAR requirements', async () => {
      const response = await request(app)
        .get('/compliance/matrix')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const requirementIds = response.body.matrix.map((r: any) => r.requirementId);
      expect(requirementIds).toContain('FAR 52.209-2');
      expect(requirementIds).toContain('FAR 52.210-1');
      expect(requirementIds).toContain('FAR 52.212-1');
    });
  });

  describe('POST /compliance/check/case/:caseId', () => {
    it('should perform compliance checks for case', async () => {
      const response = await request(app)
        .post(`/compliance/check/case/${caseId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('caseId');
      expect(response.body).toHaveProperty('checks');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('passed');
      expect(response.body).toHaveProperty('failed');
      expect(response.body.total).toBeGreaterThan(0);
    });

    it('should require authentication', async () => {
      const response = await request(app).post(`/compliance/check/case/${caseId}`);

      expect(response.status).toBe(401);
    });

    it('should log all compliance checks', async () => {
      const response = await request(app)
        .post(`/compliance/check/case/${caseId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(201);
      // Should have one check per requirement
      expect(response.body.total).toBe(COMPLIANCE_MATRIX.length);
    });
  });

  describe('GET /compliance/checks/case/:caseId', () => {
    it('should return checks for case', async () => {
      const response = await request(app)
        .get(`/compliance/checks/case/${caseId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('checks');
      expect(response.body).toHaveProperty('passed');
      expect(response.body).toHaveProperty('failed');
    });
  });

  describe('GET /compliance/audit', () => {
    it('should return audit log for date range', async () => {
      const today = new Date().toISOString().split('T')[0];
      const response = await request(app)
        .get(`/compliance/audit?startDate=${today}&endDate=${today}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('checks');
      expect(response.body).toHaveProperty('total');
    });

    it('should require date parameters', async () => {
      const response = await request(app)
        .get('/compliance/audit')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
    });

    it('should support limit parameter', async () => {
      const today = new Date().toISOString().split('T')[0];
      const response = await request(app)
        .get(`/compliance/audit?startDate=${today}&endDate=${today}&limit=5`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.checks.length).toBeLessThanOrEqual(5);
    });
  });

  describe('GET /compliance/dashboard', () => {
    it('should return compliance dashboard', async () => {
      const response = await request(app)
        .get('/compliance/dashboard')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('period');
      expect(response.body).toHaveProperty('aggregates');
      expect(response.body).toHaveProperty('daily');
      expect(response.body.aggregates).toHaveProperty('totalDecisions');
      expect(response.body.aggregates).toHaveProperty('compliantDecisions');
      expect(response.body.aggregates).toHaveProperty('averageComplianceRate');
    });

    it('should support days parameter', async () => {
      const response = await request(app)
        .get('/compliance/dashboard?days=30')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.period.days).toBe(30);
    });
  });

  describe('POST /compliance/recalculate/:dateStr', () => {
    it('should recalculate metrics for date', async () => {
      const today = new Date().toISOString().split('T')[0];
      const response = await request(app)
        .post(`/compliance/recalculate/${today}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('date');
      expect(response.body).toHaveProperty('totalDecisions');
      expect(response.body).toHaveProperty('complianceRate');
    });

    it('should reject invalid date format', async () => {
      const response = await request(app)
        .post('/compliance/recalculate/invalid-date')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
    });
  });
});

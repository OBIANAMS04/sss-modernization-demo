import request from 'supertest';
import app from '../app';
import pool from '../database/connection';
import { generateToken } from '../utils/jwt';

describe('Case Management Routes', () => {
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
        reason TEXT,
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

    const caseNotesMigration = `
      CREATE TABLE IF NOT EXISTS case_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        note_by VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    try {
      await pool.query(userMigration);
      await pool.query(exemptionsMigration);
      await pool.query(casesMigration);
      await pool.query(caseNotesMigration);
      await pool.query(caseDocsMigration);
    } catch (e) {
      // Tables might already exist
    }

    // Create test user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, ssn, dob, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      ['casetest@example.com', 'hashedpassword', 'Case Test User', '123-45-6789', '1990-01-01']
    );

    userId = result.rows[0].id;
    token = generateToken(userId, 'casetest@example.com');
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS case_documents CASCADE');
    await pool.query('DROP TABLE IF EXISTS case_notes CASCADE');
    await pool.query('DROP TABLE IF EXISTS cases CASCADE');
    await pool.query('DROP TABLE IF EXISTS exemptions CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    await pool.end();
  });

  describe('POST /cases', () => {
    it('should create a new case', async () => {
      const response = await request(app)
        .post('/cases')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('status');
      expect(response.body.status).toBe('Draft');
      expect(response.body.userId).toBe(userId);

      caseId = response.body.id;
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/cases')
        .send({});

      expect(response.status).toBe(401);
    });
  });

  describe('GET /cases', () => {
    it('should require authentication', async () => {
      const response = await request(app).get('/cases');

      expect(response.status).toBe(401);
    });

    it('should return user cases', async () => {
      const response = await request(app)
        .get('/cases')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('cases');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.cases)).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/cases?page=1&limit=5')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.cases.length).toBeLessThanOrEqual(5);
    });
  });

  describe('GET /cases/:id', () => {
    it('should return case details', async () => {
      const response = await request(app)
        .get(`/cases/${caseId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(caseId);
      expect(response.body).toHaveProperty('notes');
      expect(response.body).toHaveProperty('documents');
    });

    it('should require authentication', async () => {
      const response = await request(app).get(`/cases/${caseId}`);

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent case', async () => {
      const response = await request(app)
        .get('/cases/non-existent-id')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /cases/:id', () => {
    it('should update case status', async () => {
      const response = await request(app)
        .put(`/cases/${caseId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'Submitted' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('Submitted');
      expect(response.body.submittedAt).toBeDefined();
    });

    it('should update assigned case manager', async () => {
      const response = await request(app)
        .put(`/cases/${caseId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ assignedTo: 'manager@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.assignedTo).toBe('manager@example.com');
    });

    it('should reject invalid status', async () => {
      const response = await request(app)
        .put(`/cases/${caseId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'InvalidStatus' });

      expect(response.status).toBe(400);
    });

    it('should set approvedAt when status is Approved', async () => {
      const response = await request(app)
        .put(`/cases/${caseId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'Approved' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('Approved');
      expect(response.body.approvedAt).toBeDefined();
    });
  });

  describe('POST /cases/:id/documents', () => {
    it('should add document to case', async () => {
      const response = await request(app)
        .post(`/cases/${caseId}/documents`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          documentType: 'proof_of_age',
          documentUrl: 's3://bucket/document.pdf',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.documentType).toBe('proof_of_age');
      expect(response.body.documentUrl).toBe('s3://bucket/document.pdf');
    });

    it('should require documentType and documentUrl', async () => {
      const response = await request(app)
        .post(`/cases/${caseId}/documents`)
        .set('Authorization', `Bearer ${token}`)
        .send({ documentType: 'proof_of_age' });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /cases/:id/documents', () => {
    it('should return case documents', async () => {
      const response = await request(app)
        .get(`/cases/${caseId}/documents`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('documents');
      expect(Array.isArray(response.body.documents)).toBe(true);
    });
  });

  describe('GET /cases/:id/notes', () => {
    it('should return case notes', async () => {
      const response = await request(app)
        .get(`/cases/${caseId}/notes`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('notes');
      expect(Array.isArray(response.body.notes)).toBe(true);
    });
  });

  describe('GET /cases/stats', () => {
    it('should return case statistics', async () => {
      const response = await request(app)
        .get('/cases/stats')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('byStatus');
      expect(response.body).toHaveProperty('averageTimeInReview');
    });
  });
});

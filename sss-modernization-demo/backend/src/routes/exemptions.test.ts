import request from 'supertest';
import app from '../app';
import pool from '../database/connection';
import { generateToken } from '../utils/jwt';
import {
  checkExemptionEligibility,
  calculateAge,
} from '../services/exemptionService';

describe('Exemption Service', () => {
  describe('calculateAge', () => {
    it('should calculate age correctly', () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 30);
      const age = calculateAge(dob.toISOString().split('T')[0]);

      expect(age).toBe(30);
    });

    it('should calculate age for senior (65+)', () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 70);
      const age = calculateAge(dob.toISOString().split('T')[0]);

      expect(age).toBe(70);
    });

    it('should calculate age correctly before birthday', () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 30);
      dob.setMonth(dob.getMonth() + 1); // Birthday is next month
      const age = calculateAge(dob.toISOString().split('T')[0]);

      expect(age).toBe(29);
    });
  });

  describe('checkExemptionEligibility', () => {
    it('should return no exemptions for young person with no hardship', () => {
      const user = {
        id: '123',
        dob: (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 25);
          return d.toISOString().split('T')[0];
        })(),
        phone: '1234567890',
        address: '123 Main St',
        income: 50000,
        hasDocumentedHardship: false,
      };

      const result = checkExemptionEligibility(user);

      expect(result.eligible).toBe(false);
      expect(result.exemptions).toHaveLength(0);
    });

    it('should return Type A exemption for senior (65+)', () => {
      const user = {
        id: '123',
        dob: (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 70);
          return d.toISOString().split('T')[0];
        })(),
        phone: '1234567890',
        address: '123 Main St',
      };

      const result = checkExemptionEligibility(user);

      expect(result.eligible).toBe(true);
      expect(result.exemptions).toContain('Type A - Senior Exemption');
    });

    it('should return Type B exemption for low income', () => {
      const user = {
        id: '123',
        dob: (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 30);
          return d.toISOString().split('T')[0];
        })(),
        phone: '1234567890',
        address: '123 Main St',
        income: 15000,
        hasDocumentedHardship: false,
      };

      const result = checkExemptionEligibility(user);

      expect(result.eligible).toBe(true);
      expect(result.exemptions).toContain('Type B - Income-Based Exemption');
    });

    it('should return Type C exemption for documented hardship', () => {
      const user = {
        id: '123',
        dob: (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 30);
          return d.toISOString().split('T')[0];
        })(),
        phone: '1234567890',
        address: '123 Main St',
        income: 50000,
        hasDocumentedHardship: true,
      };

      const result = checkExemptionEligibility(user);

      expect(result.eligible).toBe(true);
      expect(result.exemptions).toContain('Type C - Hardship Exemption (Pending Review)');
    });

    it('should return multiple exemptions for senior with low income', () => {
      const user = {
        id: '123',
        dob: (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 70);
          return d.toISOString().split('T')[0];
        })(),
        phone: '1234567890',
        address: '123 Main St',
        income: 15000,
      };

      const result = checkExemptionEligibility(user);

      expect(result.eligible).toBe(true);
      expect(result.exemptions.length).toBeGreaterThan(1);
      expect(result.exemptions).toContain('Type A - Senior Exemption');
      expect(result.exemptions).toContain('Type B - Income-Based Exemption');
    });
  });
});

describe('Exemptions Routes', () => {
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
        phone VARCHAR(20),
        address TEXT,
        mfa_enabled BOOLEAN DEFAULT FALSE,
        compliance_status VARCHAR(50) DEFAULT 'Pending Review',
        compliance_checked_at TIMESTAMP,
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

    try {
      await pool.query(userMigration);
      await pool.query(exemptionsMigration);
    } catch (e) {
      // Tables might already exist
    }

    // Create test user (senior for Type A exemption)
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, ssn, dob, phone, address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [
        'exemptiontest@example.com',
        'hashedpassword',
        'Exemption Test User',
        '123-45-6789',
        '1960-01-01', // 64 years old (will be 65 soon or already 65 depending on current date)
        '1234567890',
        '123 Test Street',
      ]
    );

    userId = result.rows[0].id;
    token = generateToken(userId, 'exemptiontest@example.com');
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS exemptions CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    await pool.end();
  });

  describe('POST /exemptions/check', () => {
    it('should check exemption eligibility', async () => {
      const response = await request(app)
        .post('/exemptions/check')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('eligible');
      expect(response.body).toHaveProperty('exemptions');
      expect(response.body).toHaveProperty('determinedAt');
    });

    it('should require authentication', async () => {
      const response = await request(app).post('/exemptions/check');

      expect(response.status).toBe(401);
    });

    it('should return array of exemptions', async () => {
      const response = await request(app)
        .post('/exemptions/check')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.exemptions)).toBe(true);
    });
  });

  describe('GET /exemptions', () => {
    it('should require authentication', async () => {
      const response = await request(app).get('/exemptions');

      expect(response.status).toBe(401);
    });

    it('should return user exemptions', async () => {
      // First trigger a check to create exemptions
      await request(app)
        .post('/exemptions/check')
        .set('Authorization', `Bearer ${token}`);

      const response = await request(app)
        .get('/exemptions')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('exemptions');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.exemptions)).toBe(true);
    });

    it('should return empty array if no exemptions', async () => {
      // Create a new user with no exemptions
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, ssn, dob, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        ['newuser@example.com', 'hash', 'New User', '999-99-9999', '2000-01-01']
      );

      const newUserId = result.rows[0].id;
      const newToken = generateToken(newUserId, 'newuser@example.com');

      const response = await request(app)
        .get('/exemptions')
        .set('Authorization', `Bearer ${newToken}`);

      expect(response.status).toBe(200);
      expect(response.body.exemptions).toHaveLength(0);
    });
  });

  describe('GET /exemptions/stats', () => {
    it('should return exemption statistics', async () => {
      const response = await request(app)
        .get('/exemptions/stats')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('byType');
    });

    it('should require authentication', async () => {
      const response = await request(app).get('/exemptions/stats');

      expect(response.status).toBe(401);
    });
  });
});

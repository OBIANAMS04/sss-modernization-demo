import request from 'supertest';
import app from '../app';
import pool from '../database/connection';
import { generateToken } from '../utils/jwt';
import speakeasy from 'speakeasy';

describe('MFA Routes', () => {
  let userId: string;
  let token: string;
  let mfaSecret: string;

  beforeAll(async () => {
    const userMigration = `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        ssn VARCHAR(11) NOT NULL,
        dob DATE NOT NULL,
        mfa_enabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const mfaMigration = `
      CREATE TABLE IF NOT EXISTS mfa_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        device_name VARCHAR(255),
        secret_key VARCHAR(255) NOT NULL,
        verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    try {
      await pool.query(userMigration);
      await pool.query(mfaMigration);
    } catch (e) {
      // Tables might already exist
    }

    // Create test user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, ssn, dob, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id`,
      ['testmfa@example.com', 'hashedpassword', 'Test User', '123-45-6789', '1990-01-01']
    );

    userId = result.rows[0].id;
    token = generateToken(userId, 'testmfa@example.com');
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS mfa_devices CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    await pool.end();
  });

  describe('POST /mfa/setup', () => {
    it('should generate MFA secret and QR code', async () => {
      const response = await request(app)
        .post('/mfa/setup')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('secret');
      expect(response.body).toHaveProperty('qrCode');
      expect(response.body.secret).toMatch(/^[A-Z2-7]+$/); // Base32 format

      // Save secret for verification tests
      mfaSecret = response.body.secret;
    });

    it('should reject request without auth', async () => {
      const response = await request(app).post('/mfa/setup');

      expect(response.status).toBe(401);
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .post('/mfa/setup')
        .set('Authorization', 'Bearer invalid_token');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /mfa/verify', () => {
    it('should enable MFA with valid TOTP code', async () => {
      // Generate valid TOTP code
      const totpCode = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32',
      });

      const response = await request(app)
        .post('/mfa/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({
          secret: mfaSecret,
          totpCode,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });

    it('should reject invalid TOTP code', async () => {
      // Create another user for this test
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, ssn, dob, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id`,
        ['testmfa2@example.com', 'hashedpassword', 'Test User 2', '987-65-4321', '1985-06-15']
      );

      const newUserId = result.rows[0].id;
      const newToken = generateToken(newUserId, 'testmfa2@example.com');

      const setupResponse = await request(app)
        .post('/mfa/setup')
        .set('Authorization', `Bearer ${newToken}`);

      const newSecret = setupResponse.body.secret;

      const response = await request(app)
        .post('/mfa/verify')
        .set('Authorization', `Bearer ${newToken}`)
        .send({
          secret: newSecret,
          totpCode: '000000', // Invalid code
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_TOTP');
    });

    it('should reject non-numeric TOTP code', async () => {
      const response = await request(app)
        .post('/mfa/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({
          secret: mfaSecret,
          totpCode: 'invalid',
        });

      expect(response.status).toBe(400);
    });

    it('should reject missing secret or code', async () => {
      const response = await request(app)
        .post('/mfa/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({
          secret: mfaSecret,
          // totpCode missing
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /mfa/verify-code', () => {
    it('should verify TOTP code during login', async () => {
      const totpCode = speakeasy.totp({
        secret: mfaSecret,
        encoding: 'base32',
      });

      const response = await request(app)
        .post('/mfa/verify-code')
        .set('Authorization', `Bearer ${token}`)
        .send({
          totpCode,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });

    it('should reject invalid TOTP code', async () => {
      const response = await request(app)
        .post('/mfa/verify-code')
        .set('Authorization', `Bearer ${token}`)
        .send({
          totpCode: '000000',
        });

      expect(response.status).toBe(400);
    });

    it('should reject non-numeric code', async () => {
      const response = await request(app)
        .post('/mfa/verify-code')
        .set('Authorization', `Bearer ${token}`)
        .send({
          totpCode: 'invalid',
        });

      expect(response.status).toBe(400);
    });

    it('should reject request without auth', async () => {
      const response = await request(app).post('/mfa/verify-code').send({
        totpCode: '123456',
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /mfa/status', () => {
    it('should return MFA status', async () => {
      const response = await request(app)
        .get('/mfa/status')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('mfaEnabled');
      expect(response.body.mfaEnabled).toBe(true); // Enabled from verify test
    });

    it('should reject request without auth', async () => {
      const response = await request(app).get('/mfa/status');

      expect(response.status).toBe(401);
    });
  });
});

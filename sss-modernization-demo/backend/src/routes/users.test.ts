import request from 'supertest';
import app from '../app';
import pool from '../database/connection';
import { generateToken } from '../utils/jwt';

describe('Users Routes', () => {
  let userId: string;
  let token: string;

  beforeAll(async () => {
    const migration = `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        ssn VARCHAR(11) NOT NULL,
        dob DATE NOT NULL,
        phone VARCHAR(20),
        address TEXT,
        mfa_enabled BOOLEAN DEFAULT FALSE,
        compliance_status VARCHAR(50) DEFAULT 'Pending Review',
        compliance_checked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    try {
      await pool.query(migration);
    } catch (e) {
      // Table might already exist
    }

    // Create test user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, ssn, dob, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id`,
      ['testuser@example.com', 'hashedpassword', 'Test User', '123-45-6789', '1990-01-01']
    );

    userId = result.rows[0].id;
    token = generateToken(userId, 'testuser@example.com');
  });

  afterAll(async () => {
    await pool.query('TRUNCATE TABLE users CASCADE');
    await pool.end();
  });

  describe('GET /users/:id', () => {
    it('should return user profile with valid auth', async () => {
      const response = await request(app)
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', userId);
      expect(response.body).toHaveProperty('email', 'testuser@example.com');
      expect(response.body).toHaveProperty('fullName', 'Test User');
      expect(response.body).toHaveProperty('complianceStatus');
    });

    it('should reject request without auth header', async () => {
      const response = await request(app).get(`/users/${userId}`);

      expect(response.status).toBe(401);
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get(`/users/${userId}`)
        .set('Authorization', 'Bearer invalid_token');

      expect(response.status).toBe(401);
    });

    it('should reject access to other users profile', async () => {
      const otherToken = generateToken('other-user-id', 'other@example.com');
      const response = await request(app)
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(403);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get('/users/non-existent-id')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /users/:id', () => {
    it('should update user profile with valid data', async () => {
      const response = await request(app)
        .put(`/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          phone: '+1-555-123-4567',
          address: '123 Main St, City, State 12345',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('phone', '+1-555-123-4567');
      expect(response.body).toHaveProperty('address', '123 Main St, City, State 12345');
    });

    it('should update compliance status to Eligible when phone and address provided', async () => {
      const response = await request(app)
        .put(`/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          phone: '+1-555-999-8888',
          address: '456 Oak Ave, Town, State 54321',
        });

      expect(response.status).toBe(200);
      expect(response.body.complianceStatus).toBe('Eligible');
    });

    it('should set compliance status to Pending Review if missing phone or address', async () => {
      // Create user without phone/address
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, ssn, dob, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id`,
        ['testuser2@example.com', 'hashedpassword', 'Test User 2', '987-65-4321', '1985-06-15']
      );

      const newUserId = result.rows[0].id;
      const newToken = generateToken(newUserId, 'testuser2@example.com');

      const response = await request(app)
        .put(`/users/${newUserId}`)
        .set('Authorization', `Bearer ${newToken}`)
        .send({
          phone: '+1-555-111-2222',
          // address missing
        });

      expect(response.status).toBe(200);
      expect(response.body.complianceStatus).toBe('Pending Review');
    });

    it('should reject invalid phone format', async () => {
      const response = await request(app)
        .put(`/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          phone: 'not-a-phone',
        });

      expect(response.status).toBe(400);
    });

    it('should reject address longer than 500 characters', async () => {
      const response = await request(app)
        .put(`/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          address: 'a'.repeat(501),
        });

      expect(response.status).toBe(400);
    });

    it('should reject request without auth', async () => {
      const response = await request(app).put(`/users/${userId}`).send({
        phone: '+1-555-123-4567',
      });

      expect(response.status).toBe(401);
    });

    it('should reject access to update other users profile', async () => {
      const otherToken = generateToken('other-user-id', 'other@example.com');
      const response = await request(app)
        .put(`/users/${userId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          phone: '+1-555-123-4567',
        });

      expect(response.status).toBe(403);
    });
  });
});

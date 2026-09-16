import request from 'supertest';
import app from '../app';
import pool from '../database/connection';

describe('Auth Routes', () => {
  beforeAll(async () => {
    // Run migrations before tests
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
  });

  afterAll(async () => {
    // Clean up
    await pool.query('TRUNCATE TABLE users CASCADE');
    await pool.end();
  });

  describe('POST /auth/register', () => {
    it('should create a user with valid input', async () => {
      const response = await request(app).post('/auth/register').send({
        email: 'test@example.com',
        password: 'SecurePass123!',
        fullName: 'John Doe',
        ssn: '123-45-6789',
        dob: '1990-01-01',
      });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.email).toBe('test@example.com');
    });

    it('should reject duplicate email', async () => {
      await request(app).post('/auth/register').send({
        email: 'duplicate@example.com',
        password: 'SecurePass123!',
        fullName: 'John Doe',
        ssn: '123-45-6789',
        dob: '1990-01-01',
      });

      const response = await request(app).post('/auth/register').send({
        email: 'duplicate@example.com',
        password: 'SecurePass123!',
        fullName: 'Jane Doe',
        ssn: '987-65-4321',
        dob: '1985-06-15',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should reject invalid email', async () => {
      const response = await request(app).post('/auth/register').send({
        email: 'invalid-email',
        password: 'SecurePass123!',
        fullName: 'John Doe',
        ssn: '123-45-6789',
        dob: '1990-01-01',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject weak password', async () => {
      const response = await request(app).post('/auth/register').send({
        email: 'test@example.com',
        password: 'weak',
        fullName: 'John Doe',
        ssn: '123-45-6789',
        dob: '1990-01-01',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid SSN', async () => {
      const response = await request(app).post('/auth/register').send({
        email: 'test@example.com',
        password: 'SecurePass123!',
        fullName: 'John Doe',
        ssn: 'invalid',
        dob: '1990-01-01',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject underage applicant', async () => {
      const response = await request(app).post('/auth/register').send({
        email: 'test@example.com',
        password: 'SecurePass123!',
        fullName: 'John Doe',
        ssn: '123-45-6789',
        dob: '2020-01-01', // Too young
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject missing required fields', async () => {
      const response = await request(app).post('/auth/register').send({
        email: 'test@example.com',
        // password missing
        fullName: 'John Doe',
        ssn: '123-45-6789',
        dob: '1990-01-01',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/auth/register').send({
        email: 'login@example.com',
        password: 'SecurePass123!',
        fullName: 'John Doe',
        ssn: '123-45-6789',
        dob: '1990-01-01',
      });
    });

    it('should login with valid credentials', async () => {
      const response = await request(app).post('/auth/login').send({
        email: 'login@example.com',
        password: 'SecurePass123!',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
    });

    it('should reject invalid password', async () => {
      const response = await request(app).post('/auth/login').send({
        email: 'login@example.com',
        password: 'WrongPassword123!',
      });

      expect(response.status).toBe(400);
    });

    it('should reject non-existent user', async () => {
      const response = await request(app).post('/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'SecurePass123!',
      });

      expect(response.status).toBe(400);
    });
  });
});

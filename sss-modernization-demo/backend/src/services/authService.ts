import bcrypt from 'bcrypt';
import pool from '../database/connection';
import { generateToken } from '../utils/jwt';
import { ConflictError, ValidationError } from '../utils/errors';
import { roleForNewUser, Role } from './roleService';

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  ssn: string;
  dob: string;
}

export interface RegisterResponse {
  user: {
    id: string;
    email: string;
    fullName: string;
    createdAt: string;
    role: Role;
  };
  token: string;
}

export async function registerUser(input: RegisterInput): Promise<RegisterResponse> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if email already exists
    const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [input.email]);

    if (existingUser.rows.length > 0) {
      throw new ConflictError('Email already registered');
    }

    // Hash password and SSN — the raw SSN is never persisted or logged
    const passwordHash = await bcrypt.hash(input.password, 12);
    const ssnHash = await bcrypt.hash(input.ssn, 12);

    // Insert user
    const result = await client.query(
      `INSERT INTO users (email, password_hash, full_name, ssn_hash, dob, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id, email, full_name, role, created_at`,
      [input.email, passwordHash, input.fullName, ssnHash, input.dob, roleForNewUser(input.email)]
    );

    await client.query('COMMIT');

    const user = result.rows[0];
    const token = generateToken(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        createdAt: user.created_at,
        role: user.role,
      },
      token,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function loginUser(email: string, password: string) {
  const result = await pool.query(
    'SELECT id, email, password_hash, full_name, role, created_at FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    throw new ValidationError('Invalid email or password');
  }

  const user = result.rows[0];
  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    throw new ValidationError('Invalid email or password');
  }

  const token = generateToken(user.id, user.email);

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      createdAt: user.created_at,
      role: user.role,
    },
    token,
  };
}

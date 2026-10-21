import bcrypt from 'bcrypt';
import pool from '../database/connection';
import { generatePendingToken, generateToken } from '../utils/jwt';
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
  // STORY-033: no database connection is held while the two bcrypt hashes are computed (about half a second of CPU). Registering used to
  // check out a connection first and keep it, inside a transaction, for the whole of that time, so a few registrations at once took the
  // pool away from every other request. The duplicate check is cheap and answers before any hashing; the unique index on email is
  // what makes two registrations of one address at the same moment safe (the second gets the same conflict).
  const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [input.email]);
  if (existingUser.rows.length > 0) {
    throw new ConflictError('Email already registered');
  }

  // Hash password and SSN (in parallel, on the thread pool) — the raw SSN is never persisted or logged
  const [passwordHash, ssnHash] = await Promise.all([bcrypt.hash(input.password, 12), bcrypt.hash(input.ssn, 12)]);

  const role = await roleForNewUser(input.email);
  let result;
  try {
    result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, ssn_hash, dob, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id, email, full_name, role, created_at`,
      [input.email, passwordHash, input.fullName, ssnHash, input.dob, role]
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ConflictError('Email already registered');
    throw error;
  }

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
}

export async function loginUser(email: string, password: string) {
  const result = await pool.query(
    'SELECT id, email, password_hash, full_name, role, mfa_enabled, created_at FROM users WHERE email = $1',
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

  const profile = {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    createdAt: user.created_at,
    role: user.role,
  };

  // STORY-003: with two-step verification on, a correct password earns only a short-lived pending token. The
  // session comes from POST /auth/mfa/verify, once the authentication code is right.
  if (user.mfa_enabled === true) {
    return { user: profile, mfaRequired: true as const, pendingToken: generatePendingToken(user.id, user.email) };
  }

  return { user: profile, token: generateToken(user.id, user.email) };
}

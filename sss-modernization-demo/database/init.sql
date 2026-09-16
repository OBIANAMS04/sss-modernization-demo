-- SSS Modernization Platform - Database Initialization Script
-- PostgreSQL 18.6
-- Created: August 31, 2026

-- ============================================================================
-- Create Users Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  mfa_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indices for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- ============================================================================
-- Create MFA Devices Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret VARCHAR(32) NOT NULL,
  enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for foreign key lookups
CREATE INDEX IF NOT EXISTS idx_mfa_user_id ON mfa_devices(user_id);

-- ============================================================================
-- Verify Tables Created
-- ============================================================================

-- Check users table
SELECT 'Users table created' AS status;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users';

-- Check mfa_devices table
SELECT 'MFA Devices table created' AS status;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'mfa_devices';

-- ============================================================================
-- Display Indices
-- ============================================================================

SELECT indexname FROM pg_indexes WHERE tablename = 'users' OR tablename = 'mfa_devices';

-- 001_init_users.sql
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

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

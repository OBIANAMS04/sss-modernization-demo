-- 002_init_mfa_devices.sql
CREATE TABLE IF NOT EXISTS mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name VARCHAR(255) DEFAULT 'Primary Device',
  secret_key VARCHAR(255) NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mfa_devices_user_id ON mfa_devices(user_id);

-- Add mfa_enabled column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE;

-- 004_init_exemptions.sql
CREATE TABLE IF NOT EXISTS exemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exemption_type VARCHAR(50) NOT NULL, -- 'Type A', 'Type B', 'Type C'
  status VARCHAR(50) DEFAULT 'Eligible', -- 'Eligible', 'Pending Review', 'Denied'
  reason TEXT,
  determined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  determined_by VARCHAR(100), -- 'system' or user_id
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exemptions_user_id ON exemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_exemptions_type ON exemptions(exemption_type);
CREATE INDEX IF NOT EXISTS idx_exemptions_status ON exemptions(status);
CREATE INDEX IF NOT EXISTS idx_exemptions_created_at ON exemptions(created_at);

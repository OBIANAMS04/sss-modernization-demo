-- 005_init_cases.sql
CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exemption_id UUID REFERENCES exemptions(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'Draft', -- Draft, Submitted, In Review, Approved, Denied, Appealed
  assigned_to VARCHAR(255), -- case manager user_id or email
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMP,
  approved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  note_by VARCHAR(255) NOT NULL, -- case manager name or id
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL, -- proof_of_age, income_statement, medical, etc.
  document_url VARCHAR(500) NOT NULL,
  uploaded_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cases_user_id ON cases(user_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_assigned_to ON cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at);

CREATE INDEX IF NOT EXISTS idx_case_notes_case_id ON case_notes(case_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_created_at ON case_notes(created_at);

CREATE INDEX IF NOT EXISTS idx_case_documents_case_id ON case_documents(case_id);
CREATE INDEX IF NOT EXISTS idx_case_documents_type ON case_documents(document_type);

-- 009_hash_ssn.sql
-- SSN was stored as raw plaintext. Store a bcrypt hash instead, matching
-- password_hash, and never persist or log the raw value.
-- Idempotent: databases hashed by hand before the migration runner tracked
-- applied files already have ssn_hash, so only rename when ssn still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'ssn'
  ) THEN
    ALTER TABLE users RENAME COLUMN ssn TO ssn_hash;
  END IF;
END $$;

ALTER TABLE users ALTER COLUMN ssn_hash TYPE VARCHAR(255);

-- 009_hash_ssn.sql
-- SSN was stored as raw plaintext. Store a bcrypt hash instead, matching
-- password_hash, and never persist or log the raw value.
ALTER TABLE users RENAME COLUMN ssn TO ssn_hash;
ALTER TABLE users ALTER COLUMN ssn_hash TYPE VARCHAR(255);

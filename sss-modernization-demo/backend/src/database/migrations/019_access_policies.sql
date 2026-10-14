-- 019_access_policies.sql
-- STORY-016: the versions of the API access policy. The policy itself is Rego (backend/policy/sss_authz.rego, compiled to
-- WebAssembly) and its defaults are in code. A version stores only what an administrator changed from those defaults:
--   rules        every attribute rule's switch (rule id -> on or off)
--   route_roles  only the routes limited to fewer roles than the code allows (route -> roles)
-- so a deploy that adds or changes routes needs no data migration. No row means the code defaults (version 0). The newest
-- version is the one in force; every instance re-reads it within seconds, so a change needs no deploy.
CREATE TABLE IF NOT EXISTS access_policy_versions (
  version SERIAL PRIMARY KEY,
  rules JSONB NOT NULL,
  route_roles JSONB NOT NULL,
  summary TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by UUID,
  changed_by_email VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Write-once, like the audit log (015): a change is a new version, never an edit, so the history cannot be rewritten.
-- The person's id and email stay as recorded; there is no foreign key, so removing a user never alters a version.
CREATE OR REPLACE FUNCTION access_policy_versions_refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'access_policy_versions is write-once: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS access_policy_versions_no_update_delete ON access_policy_versions;
CREATE TRIGGER access_policy_versions_no_update_delete
  BEFORE UPDATE OR DELETE ON access_policy_versions
  FOR EACH ROW EXECUTE FUNCTION access_policy_versions_refuse_change();

DROP TRIGGER IF EXISTS access_policy_versions_no_truncate ON access_policy_versions;
CREATE TRIGGER access_policy_versions_no_truncate
  BEFORE TRUNCATE ON access_policy_versions
  FOR EACH STATEMENT EXECUTE FUNCTION access_policy_versions_refuse_change();

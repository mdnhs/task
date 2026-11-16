-- Runs as app_owner (the roles themselves come from src/db/bootstrap/roles.sql, run by a superuser).
-- Every table app_owner creates from now on is readable/writable by app_user, which has no BYPASSRLS
-- and does not own tables, so RLS applies to it. Tables with a tenant_id column MUST also copy
-- (nullif is required: a pooled connection keeps the setting as '' after a tenant tx, and ''::uuid would raise):
--   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY; ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON <t> USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
--     WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

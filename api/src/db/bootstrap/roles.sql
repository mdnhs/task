-- Run ONCE per database by a superuser (CREATE ROLE needs it; app_owner cannot create roles).
-- Idempotent. After this, set passwords and enable login out of band, e.g.:
--   ALTER ROLE app_owner LOGIN PASSWORD '...'; ALTER ROLE app_user LOGIN PASSWORD '...';
-- Migrations (incl. 0000_roles_rls.sql) then run as app_owner; the API connects as app_user.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    CREATE ROLE app_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT CREATE ON DATABASE %I TO app_owner', current_database());
END $$;
GRANT CREATE, USAGE ON SCHEMA public TO app_owner;
GRANT USAGE ON SCHEMA public TO app_user;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

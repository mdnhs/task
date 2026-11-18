-- B7 Task 15: /readyz reports the migration version without giving app_user any access to the drizzle schema.
-- One integer, read by a SECURITY DEFINER function owned by the migrator (app_owner); it carries no tenant data, so no RLS applies.
CREATE FUNCTION "public"."schema_migration_count"() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT count(*)::integer FROM drizzle.__drizzle_migrations $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."schema_migration_count"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."schema_migration_count"() TO app_user;

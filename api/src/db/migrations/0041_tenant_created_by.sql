ALTER TABLE "tenants" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenants_created_by_idx" ON "tenants" USING btree ("created_by");
-- Backfill: the oldest owner membership of each tenant. memberships and roles are FORCE ROW LEVEL SECURITY and the migrator has no BYPASSRLS, so this runs once per tenant with app.tenant_id set.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT "id" FROM "tenants" WHERE "created_by" IS NULL LOOP
    PERFORM set_config('app.tenant_id', t."id"::text, true);
    UPDATE "tenants" SET "created_by" = (
      SELECT m."user_id" FROM "memberships" m JOIN "roles" r ON r."tenant_id" = m."tenant_id" AND r."id" = m."role_id"
      WHERE m."tenant_id" = t."id" AND r."key" = 'owner' ORDER BY m."joined_at", m."user_id" LIMIT 1
    ) WHERE "id" = t."id";
  END LOOP;
END $$;

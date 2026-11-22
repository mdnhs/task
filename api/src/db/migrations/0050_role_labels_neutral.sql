-- The built-in role templates used to be seeded as "Tenant Owner" / "Tenant Admin"; the tenant app never says "tenant", so the stored labels become "Owner" / "Admin".
-- Only rows still holding the exact old seed text are touched (a label an admin renamed is left alone). roles is FORCE RLS and this migration has no tenant context,
-- so the force is lifted for the statements (app_owner owns the table) and restored at once.
ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "roles" SET "label" = 'Owner' WHERE "key" = 'owner' AND "label" = 'Tenant Owner';--> statement-breakpoint
UPDATE "roles" SET "label" = 'Admin' WHERE "key" = 'admin' AND "label" = 'Tenant Admin';--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;

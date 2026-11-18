ALTER TABLE "memberships" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "home_location_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_home_location_fk" FOREIGN KEY ("tenant_id","home_location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE SET NULL ("home_location_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_home_location_idx" ON "memberships" USING btree ("tenant_id","home_location_id");
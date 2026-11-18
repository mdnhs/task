CREATE TABLE "location_supervisors" (
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "location_supervisors_tenant_id_location_id_user_id_pk" PRIMARY KEY("tenant_id","location_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "location_supervisors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"zone_radius_m" integer,
	"opening_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"swap_approval_delegated" boolean DEFAULT false NOT NULL,
	"time_zone" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "locations_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "locations_name_check" CHECK (char_length("locations"."name") BETWEEN 1 AND 120),
	CONSTRAINT "locations_radius_check" CHECK ("locations"."zone_radius_m" is null or "locations"."zone_radius_m" BETWEEN 0 AND 5000),
	CONSTRAINT "locations_lat_check" CHECK ("locations"."lat" is null or "locations"."lat" BETWEEN -90 AND 90),
	CONSTRAINT "locations_lng_check" CHECK ("locations"."lng" is null or "locations"."lng" BETWEEN -180 AND 180)
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"expires_on" date,
	"file_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "member_qualifications_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "member_qualifications_key" UNIQUE("tenant_id","user_id","type"),
	CONSTRAINT "member_qualifications_type_check" CHECK (char_length("member_qualifications"."type") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "member_qualifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roster_office_limits" (
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	CONSTRAINT "roster_office_limits_tenant_id_user_id_location_id_pk" PRIMARY KEY("tenant_id","user_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "roster_office_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_type_targets" (
	"tenant_id" uuid NOT NULL,
	"shift_type_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"count" smallint NOT NULL,
	CONSTRAINT "shift_type_targets_tenant_id_shift_type_id_weekday_pk" PRIMARY KEY("tenant_id","shift_type_id","weekday"),
	CONSTRAINT "shift_type_targets_weekday_check" CHECK ("shift_type_targets"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "shift_type_targets_count_check" CHECK ("shift_type_targets"."count" BETWEEN 0 AND 99)
);
--> statement-breakpoint
ALTER TABLE "shift_type_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"unpaid_break_min" smallint DEFAULT 0 NOT NULL,
	"role" text NOT NULL,
	"requires" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shift_types_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "shift_types_name_check" CHECK (char_length("shift_types"."name") BETWEEN 1 AND 80),
	CONSTRAINT "shift_types_start_check" CHECK ("shift_types"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "shift_types_end_check" CHECK ("shift_types"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "shift_types_break_check" CHECK ("shift_types"."unpaid_break_min" BETWEEN 0 AND 480),
	CONSTRAINT "shift_types_role_check" CHECK (char_length("shift_types"."role") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "shift_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "roster_level" text;--> statement-breakpoint
ALTER TABLE "location_supervisors" ADD CONSTRAINT "location_supervisors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_supervisors" ADD CONSTRAINT "location_supervisors_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_supervisors" ADD CONSTRAINT "location_supervisors_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_qualifications" ADD CONSTRAINT "member_qualifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_qualifications" ADD CONSTRAINT "member_qualifications_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_qualifications" ADD CONSTRAINT "member_qualifications_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE SET NULL ("file_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_office_limits" ADD CONSTRAINT "roster_office_limits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_office_limits" ADD CONSTRAINT "roster_office_limits_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_office_limits" ADD CONSTRAINT "roster_office_limits_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_type_targets" ADD CONSTRAINT "shift_type_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_type_targets" ADD CONSTRAINT "shift_type_targets_type_fk" FOREIGN KEY ("tenant_id","shift_type_id") REFERENCES "public"."shift_types"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_types" ADD CONSTRAINT "shift_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_types" ADD CONSTRAINT "shift_types_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_supervisors_user_idx" ON "location_supervisors" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_name_uq" ON "locations" USING btree ("tenant_id",lower("name")) WHERE "locations"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "member_qualifications_expiry_idx" ON "member_qualifications" USING btree ("tenant_id","expires_on") WHERE "member_qualifications"."expires_on" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_types_location_name_uq" ON "shift_types" USING btree ("tenant_id","location_id","name") WHERE "shift_types"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "shift_types_location_idx" ON "shift_types" USING btree ("tenant_id","location_id") WHERE "shift_types"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_roster_level_check" CHECK ("roles"."roster_level" is null or "roles"."roster_level" in ('office','supervisor'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "location_supervisors" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "locations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "member_qualifications" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roster_office_limits" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_type_targets" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_types" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- FORCE ROW LEVEL SECURITY by hand (R8): the owner is bound by the policy too, so the migrator itself sees no tenant row without app.tenant_id.
ALTER TABLE "locations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "location_supervisors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roster_office_limits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_type_targets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_qualifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Grants follow the 0000 default privileges (app_user: SELECT, INSERT, UPDATE, DELETE); no extra GRANT or REVOKE is needed.
-- Backfill roles.roster_level for the template roles (R8-3) by key: owner, admin, roster-manager = office; location-supervisor = supervisor.
-- roles is FORCE ROW LEVEL SECURITY and the migrator has no BYPASSRLS, so this runs once per tenant with app.tenant_id set.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', t."id"::text, true);
    UPDATE "roles" SET "roster_level" = 'office' WHERE "tenant_id" = t."id" AND "is_template" AND "key" IN ('owner', 'admin', 'roster-manager');
    UPDATE "roles" SET "roster_level" = 'supervisor' WHERE "tenant_id" = t."id" AND "is_template" AND "key" = 'location-supervisor';
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true); -- the migrator runs every pending migration in ONE transaction: do not leak the last tenant into later ones
END $$;

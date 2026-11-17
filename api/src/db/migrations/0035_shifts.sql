CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"pattern_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"until_date" date,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shift_assignments_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "shift_assignments_dates_check" CHECK ("shift_assignments"."until_date" is null or "shift_assignments"."until_date" >= "shift_assignments"."from_date")
);
--> statement-breakpoint
ALTER TABLE "shift_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"days" smallint[] NOT NULL,
	"time_zone" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shift_patterns_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "shift_patterns_name_check" CHECK (char_length("shift_patterns"."name") BETWEEN 1 AND 80),
	CONSTRAINT "shift_patterns_start_check" CHECK ("shift_patterns"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "shift_patterns_end_check" CHECK ("shift_patterns"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "shift_patterns_days_check" CHECK (cardinality("shift_patterns"."days") BETWEEN 1 AND 7 AND "shift_patterns"."days" <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
);
--> statement-breakpoint
ALTER TABLE "shift_patterns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_reporting_people" (
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"on" boolean NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shift_reporting_people_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "shift_reporting_people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_reporting_teams" (
	"tenant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"on" boolean NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shift_reporting_teams_tenant_id_team_id_pk" PRIMARY KEY("tenant_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "shift_reporting_teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_pattern_fk" FOREIGN KEY ("tenant_id","pattern_id") REFERENCES "public"."shift_patterns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD CONSTRAINT "shift_patterns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD CONSTRAINT "shift_patterns_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reporting_people" ADD CONSTRAINT "shift_reporting_people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reporting_people" ADD CONSTRAINT "shift_reporting_people_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reporting_teams" ADD CONSTRAINT "shift_reporting_teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reporting_teams" ADD CONSTRAINT "shift_reporting_teams_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_assignments_user_idx" ON "shift_assignments" USING btree ("tenant_id","user_id","from_date");--> statement-breakpoint
CREATE INDEX "shift_assignments_pattern_idx" ON "shift_assignments" USING btree ("tenant_id","pattern_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_patterns_team_name_uq" ON "shift_patterns" USING btree ("tenant_id","team_id","name") WHERE "shift_patterns"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "shift_patterns_team_idx" ON "shift_patterns" USING btree ("tenant_id","team_id") WHERE "shift_patterns"."archived_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_assignments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_patterns" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_reporting_people" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_reporting_teams" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "shift_patterns" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shift_assignments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shift_reporting_teams" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shift_reporting_people" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Notification kind "report" (F19): the CHECK is hand-managed (see 0013, 0023, 0027), so it is widened here.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN ('invite','member','file','security','dsr','billing','system','task','report'));
--> statement-breakpoint
-- Minimal app_user grants (ruling 9). A pattern is never deleted (F14: archive), so it has no DELETE; the team default is never removed by the app (its
-- team's delete cascades as the table owner); a person's override is removed when the manager sets it back to "follow the team".
REVOKE ALL ON "shift_patterns" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "shift_patterns" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("name", "team_id", "start_time", "end_time", "days", "time_zone", "version", "archived_at", "updated_at") ON "shift_patterns" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "shift_assignments" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "shift_assignments" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("until_date") ON "shift_assignments" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "shift_reporting_teams" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "shift_reporting_teams" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("on", "updated_by", "updated_at") ON "shift_reporting_teams" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "shift_reporting_people" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "shift_reporting_people" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("on", "updated_by", "updated_at") ON "shift_reporting_people" TO app_user;

CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "leave_requests_dates_check" CHECK ("leave_requests"."to_date" >= "leave_requests"."from_date"),
	CONSTRAINT "leave_requests_status_check" CHECK ("leave_requests"."status" in ('requested','approved','rejected','cancelled')),
	CONSTRAINT "leave_requests_kind_check" CHECK (char_length("leave_requests"."kind") BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "qualification_expiry_notices" (
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"expires_on" date NOT NULL,
	"lead_days" smallint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "qualification_expiry_notices_tenant_id_user_id_type_expires_on_lead_days_pk" PRIMARY KEY("tenant_id","user_id","type","expires_on","lead_days")
);
--> statement-breakpoint
ALTER TABLE "qualification_expiry_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roster_auto_repeat_runs" (
	"tenant_id" uuid NOT NULL,
	"source_week_id" uuid NOT NULL,
	"target_week_start" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "roster_auto_repeat_runs_tenant_id_source_week_id_target_week_start_pk" PRIMARY KEY("tenant_id","source_week_id","target_week_start")
);
--> statement-breakpoint
ALTER TABLE "roster_auto_repeat_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roster_availability" (
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"weekday" smallint NOT NULL,
	"from_time" text NOT NULL,
	"to_time" text NOT NULL,
	CONSTRAINT "roster_availability_tenant_id_user_id_weekday_from_time_to_time_pk" PRIMARY KEY("tenant_id","user_id","weekday","from_time","to_time"),
	CONSTRAINT "roster_availability_weekday_check" CHECK ("roster_availability"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "roster_availability_from_check" CHECK ("roster_availability"."from_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "roster_availability_to_check" CHECK ("roster_availability"."to_time" ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'),
	CONSTRAINT "roster_availability_order_check" CHECK ("roster_availability"."from_time" < "roster_availability"."to_time")
);
--> statement-breakpoint
ALTER TABLE "roster_availability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roster_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"patch" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "roster_change_requests_status_check" CHECK ("roster_change_requests"."status" in ('requested','approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "roster_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roster_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"shift_id" uuid NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "roster_exchanges_kind_check" CHECK ("roster_exchanges"."kind" in ('claim','swap')),
	CONSTRAINT "roster_exchanges_status_check" CHECK ("roster_exchanges"."status" in ('requested','recommended','approved','rejected','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "roster_exchanges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roster_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"week_id" uuid,
	"location_id" uuid NOT NULL,
	"shift_id" uuid,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "roster_history_action_check" CHECK (char_length("roster_history"."action") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "roster_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roster_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"week_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"date" date NOT NULL,
	"user_id" text,
	"shift_type_id" uuid NOT NULL,
	"role" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"unpaid_break_min" smallint DEFAULT 0 NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"source_shift_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "roster_shifts_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "roster_shifts_time_check" CHECK ("roster_shifts"."end_at" > "roster_shifts"."start_at"),
	CONSTRAINT "roster_shifts_start_check" CHECK ("roster_shifts"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "roster_shifts_end_check" CHECK ("roster_shifts"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "roster_shifts_break_check" CHECK ("roster_shifts"."unpaid_break_min" BETWEEN 0 AND 480),
	CONSTRAINT "roster_shifts_role_check" CHECK (char_length("roster_shifts"."role") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "roster_shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roster_week_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"shifts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "roster_week_templates_name_uq" UNIQUE("tenant_id","location_id","name"),
	CONSTRAINT "roster_week_templates_name_check" CHECK (char_length("roster_week_templates"."name") BETWEEN 1 AND 80),
	CONSTRAINT "roster_week_templates_shifts_check" CHECK (jsonb_typeof("roster_week_templates"."shifts") = 'array')
);
--> statement-breakpoint
ALTER TABLE "roster_week_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roster_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"auto_repeat_days" smallint,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "roster_weeks_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "roster_weeks_location_start_uq" UNIQUE("tenant_id","location_id","week_start"),
	CONSTRAINT "roster_weeks_monday_check" CHECK (extract(isodow from "roster_weeks"."week_start") = 1),
	CONSTRAINT "roster_weeks_status_check" CHECK ("roster_weeks"."status" in ('draft','published')),
	CONSTRAINT "roster_weeks_repeat_check" CHECK ("roster_weeks"."auto_repeat_days" is null or "roster_weeks"."auto_repeat_days" BETWEEN 1 AND 365)
);
--> statement-breakpoint
ALTER TABLE "roster_weeks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "shift_types_location_name_uq";--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_expiry_notices" ADD CONSTRAINT "qualification_expiry_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_expiry_notices" ADD CONSTRAINT "qualification_expiry_notices_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_auto_repeat_runs" ADD CONSTRAINT "roster_auto_repeat_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_auto_repeat_runs" ADD CONSTRAINT "roster_auto_repeat_runs_week_fk" FOREIGN KEY ("tenant_id","source_week_id") REFERENCES "public"."roster_weeks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_availability" ADD CONSTRAINT "roster_availability_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_availability" ADD CONSTRAINT "roster_availability_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_change_requests" ADD CONSTRAINT "roster_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_change_requests" ADD CONSTRAINT "roster_change_requests_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."roster_shifts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_change_requests" ADD CONSTRAINT "roster_change_requests_member_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_exchanges" ADD CONSTRAINT "roster_exchanges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_exchanges" ADD CONSTRAINT "roster_exchanges_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."roster_shifts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_exchanges" ADD CONSTRAINT "roster_exchanges_from_fk" FOREIGN KEY ("tenant_id","from_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_exchanges" ADD CONSTRAINT "roster_exchanges_to_fk" FOREIGN KEY ("tenant_id","to_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE SET NULL ("to_user_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_history" ADD CONSTRAINT "roster_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_history" ADD CONSTRAINT "roster_history_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_week_fk" FOREIGN KEY ("tenant_id","week_id") REFERENCES "public"."roster_weeks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_type_fk" FOREIGN KEY ("tenant_id","shift_type_id") REFERENCES "public"."shift_types"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE SET NULL ("user_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_source_fk" FOREIGN KEY ("tenant_id","source_shift_id") REFERENCES "public"."roster_shifts"("tenant_id","id") ON DELETE SET NULL ("source_shift_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_week_templates" ADD CONSTRAINT "roster_week_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_week_templates" ADD CONSTRAINT "roster_week_templates_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_weeks" ADD CONSTRAINT "roster_weeks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_weeks" ADD CONSTRAINT "roster_weeks_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_requests_user_idx" ON "leave_requests" USING btree ("tenant_id","user_id","from_date");--> statement-breakpoint
CREATE INDEX "roster_change_requests_shift_idx" ON "roster_change_requests" USING btree ("tenant_id","shift_id");--> statement-breakpoint
CREATE INDEX "roster_change_requests_open_idx" ON "roster_change_requests" USING btree ("tenant_id","created_at") WHERE "roster_change_requests"."status" = 'requested';--> statement-breakpoint
CREATE UNIQUE INDEX "roster_exchanges_open_uq" ON "roster_exchanges" USING btree ("tenant_id","shift_id","from_user_id","kind") WHERE "roster_exchanges"."status" in ('requested','recommended');--> statement-breakpoint
CREATE INDEX "roster_exchanges_shift_idx" ON "roster_exchanges" USING btree ("tenant_id","shift_id");--> statement-breakpoint
CREATE INDEX "roster_history_location_idx" ON "roster_history" USING btree ("tenant_id","location_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "roster_shifts_user_idx" ON "roster_shifts" USING btree ("tenant_id","user_id","start_at");--> statement-breakpoint
CREATE INDEX "roster_shifts_location_date_idx" ON "roster_shifts" USING btree ("tenant_id","location_id","date");--> statement-breakpoint
CREATE INDEX "roster_shifts_week_idx" ON "roster_shifts" USING btree ("tenant_id","week_id");--> statement-breakpoint
CREATE INDEX "member_qualifications_file_idx" ON "member_qualifications" USING btree ("tenant_id","file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_types_location_name_uq" ON "shift_types" USING btree ("tenant_id","location_id",lower("name")) WHERE "shift_types"."archived_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "leave_requests" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "qualification_expiry_notices" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roster_auto_repeat_runs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roster_availability" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roster_change_requests" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roster_exchanges" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roster_history" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roster_shifts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roster_week_templates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roster_weeks" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- FORCE ROW LEVEL SECURITY by hand (R8): the owner is bound by the policy too. Grants follow the 0000 default privileges; no backfill (new tables start empty).
ALTER TABLE "roster_weeks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roster_shifts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roster_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roster_change_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roster_exchanges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leave_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roster_availability" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roster_week_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roster_auto_repeat_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qualification_expiry_notices" FORCE ROW LEVEL SECURITY;

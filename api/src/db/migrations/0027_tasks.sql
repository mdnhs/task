CREATE TABLE "task_assignees" (
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "task_assignees_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "task_assignees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_counters" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"next_no" integer DEFAULT 1000 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_id" text,
	"kind" text NOT NULL,
	"text" text,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notified" text[] DEFAULT '{}'::text[] NOT NULL,
	"update_id" text,
	CONSTRAINT "task_history_update_uq" UNIQUE("tenant_id","task_id","update_id")
);
--> statement-breakpoint
ALTER TABLE "task_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" text,
	"minutes" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"update_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "task_time_entries_update_uq" UNIQUE("tenant_id","update_id"),
	CONSTRAINT "task_time_entries_minutes_check" CHECK ("task_time_entries"."minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "task_time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ref_no" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"team_id" uuid,
	"creator_id" text,
	"priority" smallint DEFAULT 2 NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"estimate_min" integer,
	"client" text,
	"project_id" uuid,
	"milestone_id" uuid,
	"parent_id" uuid,
	"evidence_rule" jsonb NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"repeat" jsonb,
	"series_id" uuid,
	"occurrence_date" date,
	"repeat_cursor" date,
	"proposal" jsonb,
	"overdue_plan" jsonb,
	"voice_file_id" uuid,
	"voice_meta" jsonb,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by" text,
	"archive_batch_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tasks_tenant_ref" UNIQUE("tenant_id","ref_no"),
	CONSTRAINT "tasks_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "tasks_title_check" CHECK (char_length("tasks"."title") BETWEEN 1 AND 200),
	CONSTRAINT "tasks_description_check" CHECK (char_length("tasks"."description") <= 10000),
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" BETWEEN 1 AND 3),
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" IN ('not_started','in_progress','blocked','submitted','changes_requested','completed','cancelled')),
	CONSTRAINT "tasks_dates_check" CHECK ("tasks"."start_at" <= "tasks"."due_at")
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_counters" ADD CONSTRAINT "task_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creator_fk" FOREIGN KEY ("tenant_id","creator_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_assignees_primary_uidx" ON "task_assignees" USING btree ("task_id") WHERE "task_assignees"."is_primary";--> statement-breakpoint
CREATE INDEX "task_assignees_user_idx" ON "task_assignees" USING btree ("tenant_id","user_id","task_id");--> statement-breakpoint
CREATE INDEX "task_history_task_idx" ON "task_history" USING btree ("tenant_id","task_id","at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "task_time_entries_task_idx" ON "task_time_entries" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "tasks_live_due_idx" ON "tasks" USING btree ("tenant_id","due_at","id") WHERE "tasks"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_live_status_due_idx" ON "tasks" USING btree ("tenant_id","status","due_at","id") WHERE "tasks"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_labels_gin" ON "tasks" USING gin ("labels");--> statement-breakpoint
CREATE INDEX "tasks_title_trgm_idx" ON "tasks" USING gin (lower("title") gin_trgm_ops);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_assignees" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_counters" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_history" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_time_entries" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tasks" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "task_counters" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "task_assignees" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "task_history" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "task_time_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Notification kind "task" (ruling D15): the CHECK is hand-managed (see 0013, 0023), so it is widened here.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN ('invite','member','file','security','dsr','billing','system','task'));
--> statement-breakpoint
-- Minimal app_user grants (ruling 9): only what the code uses. Task rows leave through app_user DELETE on `tasks` (purge, T4.5); their
-- children (assignees, history, time entries) go with them by the ON DELETE CASCADE foreign keys, which run as the table owner, so
-- history needs no DELETE grant of its own.
REVOKE ALL ON "task_counters" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "task_counters" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("next_no") ON "task_counters" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "tasks" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "tasks" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("title", "description", "team_id", "creator_id", "priority", "start_at", "due_at", "status", "labels", "estimate_min", "client", "project_id", "milestone_id", "parent_id", "evidence_rule", "round", "repeat", "series_id", "occurrence_date", "repeat_cursor", "proposal", "overdue_plan", "voice_file_id", "voice_meta", "submitted_at", "completed_at", "archived_at", "archived_by", "archive_batch_id", "version", "updated_at") ON "tasks" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "task_assignees" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "task_assignees" TO app_user;
--> statement-breakpoint
-- History is append-only; erasure may only drop the actor and remove a person from `notified`.
REVOKE ALL ON "task_history" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "task_history" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("actor_id", "notified") ON "task_history" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "task_time_entries" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "task_time_entries" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("user_id") ON "task_time_entries" TO app_user;

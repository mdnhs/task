CREATE TABLE "task_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"team_id" uuid,
	"assignee_id" text,
	"priority" smallint DEFAULT 2 NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"evidence_rule" jsonb NOT NULL,
	"due_offset_days" integer DEFAULT 0 NOT NULL,
	"due_time" text DEFAULT '17:00' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_templates_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "task_templates_name_check" CHECK (char_length("task_templates"."name") BETWEEN 1 AND 80),
	CONSTRAINT "task_templates_title_check" CHECK (char_length("task_templates"."title") BETWEEN 1 AND 200),
	CONSTRAINT "task_templates_description_check" CHECK (char_length("task_templates"."description") <= 10000),
	CONSTRAINT "task_templates_priority_check" CHECK ("task_templates"."priority" BETWEEN 1 AND 3),
	CONSTRAINT "task_templates_offset_check" CHECK ("task_templates"."due_offset_days" BETWEEN 0 AND 365),
	CONSTRAINT "task_templates_time_check" CHECK ("task_templates"."due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "task_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_assignee_fk" FOREIGN KEY ("tenant_id","assignee_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_creator_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_templates_list_idx" ON "task_templates" USING btree ("tenant_id","name","id");--> statement-breakpoint
CREATE INDEX "tasks_series_live_idx" ON "tasks" USING btree ("tenant_id") WHERE "tasks"."repeat" is not null and "tasks"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_series_occ_uq" UNIQUE("tenant_id","series_id","occurrence_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_templates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "task_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Minimal app_user grants (ruling 9). created_by and assignee_id are updated only by erasure (set null); every other column by the manager PATCH.
REVOKE ALL ON "task_templates" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "task_templates" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("name", "title", "description", "team_id", "assignee_id", "priority", "labels", "evidence_rule", "due_offset_days", "due_time", "created_by", "version") ON "task_templates" TO app_user;

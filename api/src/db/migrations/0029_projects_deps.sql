CREATE TABLE "task_dependencies" (
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_id_pk" PRIMARY KEY("task_id","depends_on_id"),
	CONSTRAINT "task_dependencies_no_self" CHECK ("task_dependencies"."task_id" <> "task_dependencies"."depends_on_id")
);
--> statement-breakpoint
ALTER TABLE "task_dependencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_date" date NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "project_milestones_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "project_milestones_name_check" CHECK (char_length("project_milestones"."name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "project_milestones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"team_id" uuid,
	"lead_id" text,
	"description" text DEFAULT '' NOT NULL,
	"due_date" date,
	"default_evidence_rule" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "projects_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "projects_name_check" CHECK (char_length("projects"."name") BETWEEN 1 AND 120),
	CONSTRAINT "projects_description_check" CHECK (char_length("projects"."description") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_on_fk" FOREIGN KEY ("tenant_id","depends_on_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_fk" FOREIGN KEY ("tenant_id","lead_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_deps_on_idx" ON "task_dependencies" USING btree ("tenant_id","depends_on_id");--> statement-breakpoint
CREATE INDEX "project_milestones_project_idx" ON "project_milestones" USING btree ("tenant_id","project_id","due_date","id");--> statement-breakpoint
CREATE INDEX "projects_created_idx" ON "projects" USING btree ("tenant_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_fk" FOREIGN KEY ("tenant_id","milestone_id") REFERENCES "public"."project_milestones"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("tenant_id","project_id") WHERE "tasks"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_milestone_idx" ON "tasks" USING btree ("tenant_id","milestone_id") WHERE "tasks"."milestone_id" is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_dependencies" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "project_milestones" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "projects" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_milestones" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "task_dependencies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Minimal app_user grants (ruling 9), same pattern as 0027/0028. Edges are only inserted and deleted by the dependency PUT (rows also
-- leave with their task through the owner-run cascade foreign keys); milestones are edited in place; a project is edited and deleted.
REVOKE ALL ON "projects" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "projects" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("name", "team_id", "lead_id", "description", "due_date", "default_evidence_rule", "updated_at", "version") ON "projects" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "project_milestones" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "project_milestones" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("name", "due_date", "position") ON "project_milestones" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "task_dependencies" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "task_dependencies" TO app_user;

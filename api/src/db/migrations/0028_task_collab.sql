CREATE TABLE "task_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"done_by" text,
	"done_at" timestamp with time zone,
	CONSTRAINT "task_checklist_items_text_check" CHECK (char_length("task_checklist_items"."text") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "task_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"mentions" text[] DEFAULT '{}'::text[] NOT NULL,
	"attachment_file_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_comments_body_check" CHECK (char_length("task_comments"."body") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_files" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "task_files_purpose_check" CHECK ("task_files"."purpose" IN ('task_evidence','task_attachment','task_voice'))
);
--> statement-breakpoint
ALTER TABLE "task_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_documents" ADD COLUMN "audience" text[];--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_checklist_task_idx" ON "task_checklist_items" USING btree ("tenant_id","task_id","position","id");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("tenant_id","task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_files_task_idx" ON "task_files" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "search_documents_audience_gin" ON "search_documents" USING gin ("audience");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("tenant_id","parent_id") WHERE "tasks"."parent_id" is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_checklist_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_comments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_files" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "task_checklist_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "task_comments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "task_files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Minimal app_user grants (ruling 9), same pattern as 0027. Rows leave with their task through the ON DELETE CASCADE foreign keys
-- (they run as the table owner), so the purge needs no DELETE grant here; only checklist items are deleted by the app.
REVOKE ALL ON "task_checklist_items" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "task_checklist_items" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("text", "done", "position", "done_by", "done_at") ON "task_checklist_items" TO app_user;
--> statement-breakpoint
-- Comments are never edited: a soft delete, plus the erasure of the author and of a person in `mentions`.
REVOKE ALL ON "task_comments" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "task_comments" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("deleted_at", "author_id", "mentions") ON "task_comments" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "task_files" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "task_files" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("created_by") ON "task_files" TO app_user;
--> statement-breakpoint
-- Task files (ruling D9) carry their own purposes; the CHECK is hand-managed (see 0018), so it is widened here.
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_check";
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('dsr_export','task_evidence','task_attachment','task_voice'));

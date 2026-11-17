CREATE TABLE "shift_report_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by_user" text,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "shift_report_comments_kind_check" CHECK ("shift_report_comments"."kind" IN ('return','accept')),
	CONSTRAINT "shift_report_comments_text_check" CHECK (char_length("shift_report_comments"."text") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "shift_report_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_report_files" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_report_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_report_items" (
	"tenant_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"task_id" uuid,
	"task_ref" integer NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "shift_report_items_report_id_position_pk" PRIMARY KEY("report_id","position"),
	CONSTRAINT "shift_report_items_status_check" CHECK ("shift_report_items"."status" IN ('done','in_progress','blocked','not_started')),
	CONSTRAINT "shift_report_items_minutes_check" CHECK ("shift_report_items"."minutes" BETWEEN 0 AND 1440),
	CONSTRAINT "shift_report_items_note_check" CHECK (char_length("shift_report_items"."note") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "shift_report_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"v" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by_user" text,
	"request_id" uuid NOT NULL,
	"note" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "shift_report_versions_v" UNIQUE("report_id","v"),
	CONSTRAINT "shift_report_versions_request" UNIQUE("report_id","request_id"),
	CONSTRAINT "shift_report_versions_v_check" CHECK ("shift_report_versions"."v" >= 1)
);
--> statement-breakpoint
ALTER TABLE "shift_report_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text,
	"pattern_id" uuid NOT NULL,
	"shift_date" date NOT NULL,
	"team_id" uuid NOT NULL,
	"shift_name" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"blockers" text DEFAULT '' NOT NULL,
	"unplanned" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_submitted_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"submissions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shift_reports_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "shift_reports_key" UNIQUE("tenant_id","user_id","pattern_id","shift_date"),
	CONSTRAINT "shift_reports_status_check" CHECK ("shift_reports"."status" IN ('draft','submitted','accepted','returned')),
	CONSTRAINT "shift_reports_summary_check" CHECK (char_length("shift_reports"."summary") <= 4000),
	CONSTRAINT "shift_reports_blockers_check" CHECK (char_length("shift_reports"."blockers") <= 2000),
	CONSTRAINT "shift_reports_version_check" CHECK ("shift_reports"."version" >= 1 AND "shift_reports"."submissions" >= 0)
);
--> statement-breakpoint
ALTER TABLE "shift_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_report_comments" ADD CONSTRAINT "shift_report_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report_comments" ADD CONSTRAINT "shift_report_comments_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."shift_reports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report_files" ADD CONSTRAINT "shift_report_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report_files" ADD CONSTRAINT "shift_report_files_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."shift_reports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report_files" ADD CONSTRAINT "shift_report_files_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report_items" ADD CONSTRAINT "shift_report_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report_items" ADD CONSTRAINT "shift_report_items_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."shift_reports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report_items" ADD CONSTRAINT "shift_report_items_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE SET NULL ("task_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report_versions" ADD CONSTRAINT "shift_report_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report_versions" ADD CONSTRAINT "shift_report_versions_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."shift_reports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE SET NULL ("user_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_pattern_fk" FOREIGN KEY ("tenant_id","pattern_id") REFERENCES "public"."shift_patterns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_report_comments_report_idx" ON "shift_report_comments" USING btree ("tenant_id","report_id","at");--> statement-breakpoint
CREATE INDEX "shift_report_files_report_idx" ON "shift_report_files" USING btree ("tenant_id","report_id");--> statement-breakpoint
CREATE INDEX "shift_report_items_task_idx" ON "shift_report_items" USING btree ("tenant_id","task_id") WHERE "shift_report_items"."task_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_report_items_task_uq" ON "shift_report_items" USING btree ("report_id","task_id") WHERE "shift_report_items"."task_id" is not null;--> statement-breakpoint
CREATE INDEX "shift_reports_inbox_idx" ON "shift_reports" USING btree ("tenant_id","shift_date" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "shift_reports_user_idx" ON "shift_reports" USING btree ("tenant_id","user_id","shift_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "shift_reports_open_idx" ON "shift_reports" USING btree ("tenant_id","due_at") WHERE "shift_reports"."status" in ('draft','returned');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_report_comments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_report_files" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_report_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_report_versions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_reports" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "shift_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shift_report_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shift_report_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shift_report_comments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shift_report_files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Report attachments (F16) carry the purpose `report_attachment` (and T5.5's generated exports `report_export`, so 0037 needs no change here); the CHECK is hand-managed (see 0018, 0028), so it is widened here.
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_check";
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('dsr_export','task_evidence','task_attachment','task_voice','report_attachment','report_export'));
--> statement-breakpoint
-- Minimal app_user grants (ruling 9). A report is never deleted by the app (it leaves with its tenant, or has its person link removed by the membership
-- foreign key's ON DELETE SET NULL, which runs as the table owner). `user_id` and `pattern_id`, `shift_date`, the instants and `shift_name` are write-once.
REVOKE ALL ON "shift_reports" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "shift_reports" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("status", "summary", "blockers", "unplanned", "extra", "first_submitted_at", "submitted_at", "reviewed_at", "reviewed_by", "version", "submissions", "updated_at") ON "shift_reports" TO app_user;
--> statement-breakpoint
-- Items: the member edits status, time and note; `title` is refreshed on a draft save and replaced on erasure. Never reassigned to another task or report.
REVOKE ALL ON "shift_report_items" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "shift_report_items" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("status", "minutes", "note", "title") ON "shift_report_items" TO app_user;
--> statement-breakpoint
-- Versions and comments are immutable for the app: SELECT and INSERT only. The ONLY updates are the subject's erasure (F22): a version's `snapshot` (free text
-- replaced by "[erased]") and the `by_user` link of a version or comment. Nothing else (v, at, request_id, note, text, kind) can ever change, and nothing is deleted.
REVOKE ALL ON "shift_report_versions" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "shift_report_versions" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("snapshot", "by_user") ON "shift_report_versions" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "shift_report_comments" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "shift_report_comments" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("by_user") ON "shift_report_comments" TO app_user;
--> statement-breakpoint
-- Attachments: written with the upload intent; the member may remove one from a draft (the link row is deleted and the file soft-deleted in `files`); only the uploader
-- link may change (erasure).
REVOKE ALL ON "shift_report_files" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "shift_report_files" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("user_id") ON "shift_report_files" TO app_user;

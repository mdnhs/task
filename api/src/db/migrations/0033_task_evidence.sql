CREATE TABLE "task_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid,
	"text" text,
	"url" text,
	"source" text,
	"captured_at" timestamp with time zone,
	"device_id" uuid,
	"review" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	CONSTRAINT "task_evidence_kind_check" CHECK ("task_evidence"."kind" IN ('photo','image','pdf','office','video','checklist','signature','note','drive')),
	CONSTRAINT "task_evidence_review_check" CHECK ("task_evidence"."review" IN ('pending','accepted','rejected')),
	CONSTRAINT "task_evidence_source_check" CHECK ("task_evidence"."source" IS NULL OR "task_evidence"."source" IN ('camera','upload')),
	CONSTRAINT "task_evidence_round_check" CHECK ("task_evidence"."round" >= 1),
	CONSTRAINT "task_evidence_file_check" CHECK (("task_evidence"."kind" IN ('photo','image','pdf','office','video','signature')) = ("task_evidence"."file_id" IS NOT NULL)),
	CONSTRAINT "task_evidence_text_check" CHECK (("task_evidence"."kind" IN ('note','checklist')) = ("task_evidence"."text" IS NOT NULL)),
	CONSTRAINT "task_evidence_url_check" CHECK (("task_evidence"."kind" = 'drive') = ("task_evidence"."url" IS NOT NULL)),
	CONSTRAINT "task_evidence_len_check" CHECK (char_length("task_evidence"."text") <= 2000 AND char_length("task_evidence"."url") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "task_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_evidence_file_uidx" ON "task_evidence" USING btree ("tenant_id","file_id") WHERE "task_evidence"."file_id" is not null;--> statement-breakpoint
CREATE INDEX "task_evidence_task_idx" ON "task_evidence" USING btree ("tenant_id","task_id","round");--> statement-breakpoint
CREATE INDEX "task_evidence_gallery_idx" ON "task_evidence" USING btree ("tenant_id","review","created_at","id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_evidence" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "task_evidence" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Minimal app_user grants (ruling 9), same pattern as 0027/0028. Items leave with their task through the ON DELETE CASCADE foreign key (it runs as the
-- table owner, so the purge needs no grant); the app itself deletes only an uploader's UNLOCKED item. Identity, kind, file, text, url and the capture
-- columns (source, captured_at, device_id) can never be changed after the insert; a review decision touches only review/reason/reviewed_*/locked_at,
-- `round` moves untouched pending items into the next round after a reject, and created_by is nulled on erasure.
REVOKE ALL ON "task_evidence" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "task_evidence" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("review", "reason", "reviewed_by", "reviewed_at", "locked_at", "round", "created_by") ON "task_evidence" TO app_user;

CREATE TABLE "task_voice_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_voice_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_voice_access" ADD CONSTRAINT "task_voice_access_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_voice_access" ADD CONSTRAINT "task_voice_access_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_voice_access_task_idx" ON "task_voice_access" USING btree ("tenant_id","task_id","at","id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_voice_access" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "task_voice_access" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Minimal app_user grants (ruling 9), same pattern as 0027/0033. A play is append-only: the app inserts and reads it, and only the subject's erasure
-- (DSR) may null `user_id`. Rows leave with their task through the ON DELETE CASCADE foreign key (it runs as the table owner, so the purge needs no grant).
REVOKE ALL ON "task_voice_access" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "task_voice_access" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("user_id") ON "task_voice_access" TO app_user;

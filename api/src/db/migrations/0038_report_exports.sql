CREATE TABLE "report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"format" text NOT NULL,
	"filters" jsonb NOT NULL,
	"report_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"file_id" uuid,
	"row_count" integer,
	"error_code" text,
	"claimed_until" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "report_exports_format_check" CHECK ("report_exports"."format" IN ('pdf','xlsx','csv')),
	CONSTRAINT "report_exports_status_check" CHECK ("report_exports"."status" IN ('queued','running','done','failed'))
);
--> statement-breakpoint
ALTER TABLE "report_exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_requester_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."shift_reports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_exports_user_idx" ON "report_exports" USING btree ("tenant_id","requested_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "report_exports_sweep_idx" ON "report_exports" USING btree ("status","created_at") WHERE "report_exports"."status" in ('queued','running');--> statement-breakpoint
CREATE INDEX "report_exports_expiry_idx" ON "report_exports" USING btree ("tenant_id","expires_at") WHERE "report_exports"."status" = 'done';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_exports" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "report_exports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Minimal app_user grants (ruling 9): an export is created by the request, then only its job moves it (state, the file, the count, an error code, the lease and the times). It is never
-- deleted by the app: it leaves with its tenant or, with the requester's membership (erasure, F22), by the FK cascade run as the table owner. `expires_at` is written at completion (+ 7 days).
REVOKE ALL ON "report_exports" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "report_exports" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("status", "file_id", "row_count", "error_code", "claimed_until", "started_at", "completed_at", "expires_at") ON "report_exports" TO app_user;

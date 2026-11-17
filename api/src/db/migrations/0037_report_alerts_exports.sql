CREATE TABLE "shift_report_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"pattern_id" uuid NOT NULL,
	"shift_date" date NOT NULL,
	"kind" text NOT NULL,
	"alerted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shift_report_alerts_key" UNIQUE("tenant_id","user_id","pattern_id","shift_date","kind"),
	CONSTRAINT "shift_report_alerts_kind_check" CHECK ("shift_report_alerts"."kind" IN ('prompt','missing'))
);
--> statement-breakpoint
ALTER TABLE "shift_report_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_report_alerts" ADD CONSTRAINT "shift_report_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report_alerts" ADD CONSTRAINT "shift_report_alerts_pattern_fk" FOREIGN KEY ("tenant_id","pattern_id") REFERENCES "public"."shift_patterns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report_alerts" ADD CONSTRAINT "shift_report_alerts_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_report_alerts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "shift_report_alerts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The ledger is write-once for the app: SELECT and INSERT only (no UPDATE, no DELETE). Rows leave with the member (ON DELETE CASCADE of the member FK, run as the table owner: erasure, F22) or the tenant.
-- (The report_exports table is T5.5's and lands in its own migration.)
REVOKE ALL ON "shift_report_alerts" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "shift_report_alerts" TO app_user;

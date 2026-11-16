CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result_file_id" uuid,
	"error_code" text,
	"notes" text,
	CONSTRAINT "data_requests_tenant_id_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "data_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "owner_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_result_file_fk" FOREIGN KEY ("tenant_id","result_file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_requests_tenant_due_idx" ON "data_requests" USING btree ("tenant_id","due_at");--> statement-breakpoint
CREATE INDEX "data_requests_subject_idx" ON "data_requests" USING btree ("tenant_id","subject_user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "data_requests" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_kind_check" CHECK ("kind" IN ('export','correct','erase'));
--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_status_check" CHECK ("status" IN ('pending','running','completed','rejected','failed'));
--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_due_check" CHECK ("due_at" > "created_at");
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('dsr_export'));
--> statement-breakpoint
ALTER TABLE "data_requests" FORCE ROW LEVEL SECURITY;

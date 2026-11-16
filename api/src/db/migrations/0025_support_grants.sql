CREATE TABLE "support_grant_index" (
	"grant_id" uuid PRIMARY KEY NOT NULL,
	"target_tenant_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"granted_by" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "support_grants_window_check" CHECK ("support_grants"."expires_at" > "support_grants"."starts_at" AND "support_grants"."expires_at" <= "support_grants"."starts_at" + interval '24 hours'),
	CONSTRAINT "support_grants_reason_check" CHECK (length("support_grants"."reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "support_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_grant_index" ADD CONSTRAINT "support_grant_index_target_tenant_id_tenants_id_fk" FOREIGN KEY ("target_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_grants_tenant_staff_idx" ON "support_grants" USING btree ("tenant_id","staff_user_id","expires_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "support_grants" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "support_grants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Minimal app_user grants (ruling 10): grants are never deleted, and only the revocation columns can change.
REVOKE ALL ON "support_grants" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "support_grants" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("revoked_at", "revoked_by") ON "support_grants" TO app_user;
--> statement-breakpoint
-- Ids-only platform map (grant id -> tenant), append-only.
REVOKE ALL ON "support_grant_index" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "support_grant_index" TO app_user;

CREATE TABLE "device_policies" (
	"tenant_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"allow" text NOT NULL,
	CONSTRAINT "device_policies_tenant_id_feature_pk" PRIMARY KEY("tenant_id","feature")
);
--> statement-breakpoint
ALTER TABLE "device_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"owner" text NOT NULL,
	"label" text NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "device_policies" ADD CONSTRAINT "device_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "device_policies" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "devices" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_type_check" CHECK ("type" IN ('pc','android','browser'));
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_owner_check" CHECK ("owner" IN ('company','personal'));
--> statement-breakpoint
ALTER TABLE "device_policies" ADD CONSTRAINT "device_policies_feature_check" CHECK ("feature" IN ('drive','payroll'));
--> statement-breakpoint
ALTER TABLE "device_policies" ADD CONSTRAINT "device_policies_allow_check" CHECK ("allow" IN ('trusted-company-pc','any','none'));
--> statement-breakpoint
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "device_policies" FORCE ROW LEVEL SECURITY;

CREATE TABLE "api_key_index" (
	"prefix" text PRIMARY KEY NOT NULL,
	"target_tenant_id" uuid NOT NULL,
	"key_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_status_code" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"events" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"failing_since" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_key_index" ADD CONSTRAINT "api_key_index_target_tenant_id_tenants_id_fk" FOREIGN KEY ("target_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_uidx" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_idx" ON "api_keys" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_endpoint_event_uidx" ON "webhook_deliveries" USING btree ("endpoint_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("tenant_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_tenant_idx" ON "webhook_endpoints" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "api_keys" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_deliveries" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_endpoints" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Minimal app_user grants (ruling 9). API keys are never deleted (revocation sets revoked_at); the hash, prefix and scopes are immutable.
REVOKE ALL ON "api_keys" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "api_keys" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("last_used_at", "revoked_at") ON "api_keys" TO app_user;
--> statement-breakpoint
-- Ids-only platform map prefix -> tenant (ruling C9), append-only.
REVOKE ALL ON "api_key_index" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "api_key_index" TO app_user;
--> statement-breakpoint
-- Endpoints are soft-deleted (deleted_at, ciphertext blanked); id, tenant, created_by and created_at are immutable.
REVOKE ALL ON "webhook_endpoints" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "webhook_endpoints" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("url", "secret_ciphertext", "events", "active", "failing_since", "deleted_at") ON "webhook_endpoints" TO app_user;
--> statement-breakpoint
-- Deliveries are history: only their progress columns change; the signed payload and the (endpoint, event) pair are immutable.
REVOKE ALL ON "webhook_deliveries" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "webhook_deliveries" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("status", "attempts", "next_attempt_at", "last_status_code", "last_error", "delivered_at") ON "webhook_deliveries" TO app_user;

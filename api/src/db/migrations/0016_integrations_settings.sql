CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"scopes" text[] NOT NULL,
	"account_email" text,
	"token_ciphertext" text,
	"connected_by" text NOT NULL,
	"connected_at" timestamp with time zone NOT NULL,
	"last_refresh_at" timestamp with time zone,
	CONSTRAINT "integration_connections_tenant_provider" UNIQUE("tenant_id","provider")
);
--> statement-breakpoint
ALTER TABLE "integration_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"state_hash" text NOT NULL,
	"verifier_ciphertext" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "oauth_states_state_hash" UNIQUE("state_hash")
);
--> statement-breakpoint
ALTER TABLE "oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "public_holidays_tenant_id_date_pk" PRIMARY KEY("tenant_id","date")
);
--> statement-breakpoint
ALTER TABLE "public_holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_connected_by_fk" FOREIGN KEY ("tenant_id","connected_by") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_states_tenant_user_idx" ON "oauth_states" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "integration_connections" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "oauth_states" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "public_holidays" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_provider_check" CHECK ("provider" IN ('google'));
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_status_check" CHECK ("status" IN ('connected','revoked','error'));
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_token_check" CHECK (("status" = 'revoked') = ("token_ciphertext" IS NULL));
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_provider_check" CHECK ("provider" IN ('google'));
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_hash_check" CHECK ("state_hash" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE "integration_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_states" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public_holidays" FORCE ROW LEVEL SECURITY;

CREATE TABLE "billing_customers" (
	"provider" text NOT NULL,
	"customer_id" text NOT NULL,
	"target_tenant_id" uuid NOT NULL,
	CONSTRAINT "billing_customers_provider_customer_id_pk" PRIMARY KEY("provider","customer_id")
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"target_tenant_id" uuid,
	"processed_at" timestamp with time zone,
	CONSTRAINT "billing_events_provider_provider_event_id_pk" PRIMARY KEY("provider","provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "platform_billing_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"secret_key_ciphertext" text NOT NULL,
	"secret_key_last4" text NOT NULL,
	"webhook_secret_ciphertext" text NOT NULL,
	"webhook_secret_last4" text NOT NULL,
	"publishable_key" text,
	"price_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_billing_settings_singleton" CHECK (id = 1),
	CONSTRAINT "platform_billing_settings_provider" CHECK (provider = 'stripe')
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_invoice_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"hosted_url" text,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invoices_provider_invoice_id_unique" UNIQUE("provider_invoice_id"),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" IN ('paid','open','failed')),
	CONSTRAINT "invoices_amount_check" CHECK ("invoices"."amount_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_target_tenant_id_tenants_id_fk" FOREIGN KEY ("target_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_tenant_created_idx" ON "invoices" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoices" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Stripe statuses unpaid / paused are stored as-is (both blocked, like canceled).
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_status_check";
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_status_check" CHECK ("status" IN ('trialing','active','past_due','canceled','incomplete','unpaid','paused'));
--> statement-breakpoint
-- Platform-level tables (no RLS): the singleton is never deleted; the event ledger and customer map are append-only for the app role.
REVOKE DELETE ON "platform_billing_settings" FROM app_user;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "billing_events" FROM app_user;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "billing_customers" FROM app_user;
--> statement-breakpoint
-- T3.2 added NotificationKind "billing" in code but the CHECK never allowed it: dunning notices could not be stored.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN ('invite','member','file','security','dsr','billing','system'));

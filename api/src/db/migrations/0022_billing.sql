CREATE TABLE "module_overrides" (
	"tenant_id" uuid NOT NULL,
	"module" text NOT NULL,
	"mode" text NOT NULL,
	"reason" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "module_overrides_tenant_id_module_pk" PRIMARY KEY("tenant_id","module"),
	CONSTRAINT "module_overrides_mode_check" CHECK ("module_overrides"."mode" IN ('grant','revoke'))
);
--> statement-breakpoint
ALTER TABLE "module_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_monthly_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"trial_days" integer NOT NULL,
	"limits" jsonb NOT NULL,
	"provider_price_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"seats" integer NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"provider" text,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"updated_from_event_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "module_overrides" ADD CONSTRAINT "module_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "module_overrides" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscriptions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_status_check" CHECK ("status" IN ('trialing','active','past_due','canceled','incomplete'));
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_seats_check" CHECK ("seats" >= 0);
--> statement-breakpoint
-- Plan catalogue seeded from public/data/billing/plans.json (priceMonthly * 100 = minor units). Platform-level: no tenant_id, no RLS.
INSERT INTO "plans" ("id","name","price_monthly_minor","currency","trial_days","limits") VALUES
  ('starter','Starter',4900,'EUR',14,'{"activeUsers":10,"storageGb":10,"messages":1000,"transcriptionMinutes":120}'),
  ('business','Business',14900,'EUR',14,'{"activeUsers":40,"storageGb":50,"messages":5000,"transcriptionMinutes":600}'),
  ('enterprise','Enterprise',39900,'EUR',14,'{"activeUsers":150,"storageGb":250,"messages":25000,"transcriptionMinutes":3000}');
--> statement-breakpoint
-- Tenants that pre-date billing start a trial on the default plan (before FORCE: the migration runs as the table owner).
INSERT INTO "subscriptions" ("tenant_id","plan_id","status","seats","trial_ends_at")
  SELECT t."id", 'starter', 'trialing', 10, now() + interval '14 days' FROM "tenants" t;
--> statement-breakpoint
-- plans is read-only for the application role: catalogue changes are migrations or platform routes (later), never tenant traffic.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "plans" FROM app_user;
--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "module_overrides" FORCE ROW LEVEL SECURITY;

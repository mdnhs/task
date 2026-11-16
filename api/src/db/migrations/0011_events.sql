CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"relayed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "domain_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_deliveries" (
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"subscriber" text NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_deliveries_event_id_subscriber_pk" PRIMARY KEY("event_id","subscriber")
);
--> statement-breakpoint
ALTER TABLE "event_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_relay_hints" (
	"tenant" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."domain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_events_pending_idx" ON "domain_events" USING btree ("tenant_id","occurred_at") WHERE relayed_at is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "domain_events" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "event_deliveries" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "domain_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- event_relay_hints is the SINGLE documented RLS exception (ruling B1): it holds tenant ids only (no business data) so
-- the relay can find tenants with pending events without a tenant context. Its column is `tenant`, not `tenant_id`,
-- which is what the structural guard (api/test/rls-guard.test.ts) keys on. Never add data columns to it.
COMMENT ON TABLE "event_relay_hints" IS 'RLS exception (B1): tenant ids only, relay discovery.';

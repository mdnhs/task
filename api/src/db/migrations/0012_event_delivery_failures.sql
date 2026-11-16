CREATE TABLE "event_delivery_failures" (
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"subscriber" text NOT NULL,
	"attempts" integer NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error_code" text NOT NULL,
	"dead_at" timestamp with time zone,
	CONSTRAINT "event_delivery_failures_event_id_subscriber_pk" PRIMARY KEY("event_id","subscriber")
);
--> statement-breakpoint
ALTER TABLE "event_delivery_failures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_delivery_failures" ADD CONSTRAINT "event_delivery_failures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_delivery_failures" ADD CONSTRAINT "event_delivery_failures_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."domain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "event_delivery_failures" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "event_delivery_failures" FORCE ROW LEVEL SECURITY;

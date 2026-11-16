CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_tenant_seq" UNIQUE("tenant_id","seq")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("tenant_id","entity","at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_events" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Append-only (FR-M0-13, NFR-05): default privileges from 0000 grant DML, so strip everything and give back SELECT + INSERT only.
-- The table has no sequence/serial (seq is assigned under an advisory lock), so there is no sequence path to rewrite rows.
REVOKE ALL ON "audit_events" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_events" TO app_user;

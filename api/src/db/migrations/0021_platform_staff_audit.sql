CREATE TABLE "platform_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"target_tenant_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "platform_audit_events_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
CREATE TABLE "platform_staff" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	CONSTRAINT "platform_staff_role_check" CHECK (role IN ('owner','support','billing','viewer')),
	CONSTRAINT "platform_staff_status_check" CHECK (status IN ('active','suspended'))
);
--> statement-breakpoint
ALTER TABLE "platform_staff" ADD CONSTRAINT "platform_staff_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_events_entity_idx" ON "platform_audit_events" USING btree ("entity","at");
--> statement-breakpoint
-- platform_staff: no tenant_id, so no RLS. Default privileges from 0000 grant DML; a removed person is suspended, never deleted.
REVOKE DELETE, TRUNCATE ON "platform_staff" FROM app_user;--> statement-breakpoint
-- platform_audit_events: append-only (same rule as audit_events): SELECT + INSERT only. No sequence/serial exists
-- (seq is assigned under the platform advisory lock), so there is no sequence path to rewrite rows.
REVOKE ALL ON "platform_audit_events" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON "platform_audit_events" TO app_user;

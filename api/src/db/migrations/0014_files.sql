CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"signature" text,
	"etag" text,
	"created_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"scanned_at" timestamp with time zone,
	CONSTRAINT "files_tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "files_key" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_tenant_created_idx" ON "files" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "files" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_key_check" CHECK ("key" = 't/' || "tenant_id"::text || '/' || "id"::text);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_status_check" CHECK ("status" IN ('pending','clean','infected','deleted'));
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_size_check" CHECK ("size_bytes" > 0);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_sha256_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_signature_check" CHECK (("signature" IS NOT NULL) = ("status" = 'infected'));
--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;

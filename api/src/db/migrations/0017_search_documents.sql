-- pg_trgm is a trusted extension (PG13+): app_owner (CREATE on the database) can create it, no superuser step needed.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "search_documents" (
	"tenant_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"module" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', title), 'A') || to_tsvector('simple', body)) STORED,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "search_documents_tenant_id_entity_entity_id_pk" PRIMARY KEY("tenant_id","entity","entity_id")
);
--> statement-breakpoint
ALTER TABLE "search_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_documents_tsv_idx" ON "search_documents" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "search_documents_title_trgm_idx" ON "search_documents" USING gin (lower("title") gin_trgm_ops);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "search_documents" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "search_documents" FORCE ROW LEVEL SECURITY;

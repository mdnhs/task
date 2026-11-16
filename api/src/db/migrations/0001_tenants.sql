CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Dublin' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"locale" text DEFAULT 'en-IE' NOT NULL,
	"session_idle_hours" integer DEFAULT 12 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);

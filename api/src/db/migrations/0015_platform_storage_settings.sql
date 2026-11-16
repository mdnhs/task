CREATE TABLE "platform_storage_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"provider" text DEFAULT 'r2' NOT NULL,
	"account_id" text NOT NULL,
	"bucket" text NOT NULL,
	"access_key_id" text NOT NULL,
	"secret_access_key_ciphertext" text NOT NULL,
	"secret_last4" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_storage_settings_singleton" CHECK (id = 1),
	CONSTRAINT "platform_storage_settings_provider" CHECK (provider = 'r2')
);

--> statement-breakpoint
REVOKE DELETE ON "platform_storage_settings" FROM app_user;

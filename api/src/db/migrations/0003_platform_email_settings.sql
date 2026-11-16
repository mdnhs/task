CREATE TABLE "platform_email_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"provider" text DEFAULT 'resend' NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"api_key_last4" text NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_email_settings_singleton" CHECK (id = 1),
	CONSTRAINT "platform_email_settings_provider" CHECK (provider = 'resend')
);
--> statement-breakpoint
REVOKE DELETE ON "platform_email_settings" FROM app_user;

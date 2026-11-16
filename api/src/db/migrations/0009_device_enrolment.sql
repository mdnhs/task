ALTER TABLE "devices" ADD COLUMN "enrol_hash" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "enrol_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "enrol_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "binding_hash" text;
ALTER TABLE "locations" ADD COLUMN "auto_repeat_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "auto_repeat_failures" integer DEFAULT 0 NOT NULL;
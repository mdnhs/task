ALTER TABLE "notification_deliveries" ADD COLUMN "claimed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_status_check";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_status_check" CHECK ("status" IN ('queued','held','sending','sent','failed','skipped'));

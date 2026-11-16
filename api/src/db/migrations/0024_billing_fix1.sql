ALTER TABLE "subscriptions" ADD COLUMN "checkout_session_id" text;
--> statement-breakpoint
-- billing_customers is an append-only provider customer -> tenant map: no UPDATE either (DELETE/TRUNCATE were revoked in 0023).
REVOKE UPDATE ON "billing_customers" FROM app_user;
--> statement-breakpoint
REVOKE DELETE ON "billing_customers" FROM app_user;

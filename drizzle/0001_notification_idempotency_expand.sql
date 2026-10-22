ALTER TABLE "notifications" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "idempotency_payload_hash" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_idempotency_fields_ck" CHECK (("idempotency_key" IS NULL) = ("idempotency_payload_hash" IS NULL));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_recipient_idempotency_key_uq" ON "notifications" USING btree ("recipient_id","idempotency_key") WHERE "notifications"."idempotency_key" IS NOT NULL;
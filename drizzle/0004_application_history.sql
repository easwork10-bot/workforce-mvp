CREATE UNIQUE INDEX IF NOT EXISTS "unique_pending_shift_employee" ON "shift_applications" USING btree ("shift_id","employee_id") WHERE "shift_applications"."status" = 'pending';
--> statement-breakpoint
DROP INDEX IF EXISTS "unique_shift_employee";
CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_shift_assignment_employee" ON "shift_assignments" USING btree ("shift_id","employee_id") WHERE "shift_assignments"."status" IN ('assigned', 'confirmed');
--> statement-breakpoint
DROP INDEX IF EXISTS "unique_shift_assignment_employee";
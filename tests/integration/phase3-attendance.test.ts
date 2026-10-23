import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/backend/db';
import { profiles, shifts, shiftApplications, shiftAssignments, attendanceRecords, auditLogs } from '@/backend/db/schema';
import { employeeCheckIn, employeeCheckOut } from '@/backend/db/queries/attendance';
import { eq } from 'drizzle-orm';

const uniqueEmail = (base: string) => `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@workforce.test`;

describe('Phase 3 Employee API - Attendance Check-in/Out', () => {
  let testEmployeeId: string;
  let testShiftId: string;
  let testAssignmentId: string;

  beforeAll(async () => {
    await db.delete(auditLogs);
    await db.delete(attendanceRecords);
    await db.delete(shiftAssignments);
    await db.delete(shiftApplications);
    await db.delete(shifts);
    await db.delete(profiles);
  });

  beforeEach(async () => {
    const [emp] = await db.insert(profiles).values({
      fullName: 'Attendance Test',
      email: uniqueEmail('attendance'),
    }).returning();
    testEmployeeId = emp.id;

    const [shift] = await db.insert(shifts).values({
      title: 'Attendance Shift',
      workType: 'cleaning',
      location: 'Amsterdam',
      startAt: new Date('2099-01-01T09:00:00Z'),
      endAt: new Date('2099-01-01T17:00:00Z'),
      requiredWorkers: 1,
      createdBy: testEmployeeId,
      status: 'open',
    }).returning();
    testShiftId = shift.id;

    const [assignment] = await db.insert(shiftAssignments).values({
      shiftId: testShiftId,
      employeeId: testEmployeeId,
      status: 'assigned',
      assignedBy: testEmployeeId,
    }).returning();
    testAssignmentId = assignment.id;
  });

  afterAll(async () => {
    await db.delete(auditLogs);
    await db.delete(attendanceRecords);
    await db.delete(shiftAssignments);
    await db.delete(shiftApplications);
    await db.delete(shifts);
    await db.delete(profiles);
  });

  it('should check in successfully with valid assignment', async () => {
    const result = await employeeCheckIn(testEmployeeId, testAssignmentId, 52.3676, 4.9041);

    expect(result.success).toBe(true);
    expect(result.record).toBeDefined();
    expect(result.record!.attendanceStatus).toBe('checked_in');
    // Database stores decimal(10,8) - 8 decimal places
    expect(result.record!.checkInLatitude).toBe('52.36760000');
    expect(result.record!.checkInLongitude).toBe('4.90410000');
  });

  it('SHOULD ALLOW check-in WITHOUT GPS coordinates (optional)', async () => {
    // Create fresh assignment
    const [shift] = await db.insert(shifts).values({
      title: 'No GPS Shift',
      workType: 'cleaning',
      location: 'Amsterdam',
      startAt: new Date('2099-01-02T09:00:00Z'),
      endAt: new Date('2099-01-02T17:00:00Z'),
      requiredWorkers: 1,
      createdBy: testEmployeeId,
      status: 'open',
    }).returning();

    const [assignment] = await db.insert(shiftAssignments).values({
      shiftId: shift.id,
      employeeId: testEmployeeId,
      status: 'assigned',
      assignedBy: testEmployeeId,
    }).returning();

    const result = await employeeCheckIn(testEmployeeId, assignment.id, null, null);

    expect(result.success).toBe(true);
    expect(result.record!.checkInLatitude).toBeNull();
    expect(result.record!.checkInLongitude).toBeNull();
  });

  it('should reject duplicate check-in', async () => {
    await employeeCheckIn(testEmployeeId, testAssignmentId, 52.3676, 4.9041);
    const result = await employeeCheckIn(testEmployeeId, testAssignmentId, 52.3676, 4.9041);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Al ingecheckt');
  });

  it('should reject check-in for non-owned assignment', async () => {
    const [emp2] = await db.insert(profiles).values({
      fullName: 'Other Employee',
      email: uniqueEmail('other'),
    }).returning();

    const result = await employeeCheckIn(emp2.id, testAssignmentId, 52.3676, 4.9041);
    expect(result.success).toBe(false);
    expect(result.message).toContain('geen toegang');
  });

  it('should reject check-in for cancelled assignment', async () => {
    await db.update(shiftAssignments).set({ status: 'cancelled' }).where(eq(shiftAssignments.id, testAssignmentId));

    const result = await employeeCheckIn(testEmployeeId, testAssignmentId, 52.3676, 4.9041);
    expect(result.success).toBe(false);
    expect(result.message).toContain('niet inchecken');
  });

  it('should check out successfully after check-in', async () => {
    await employeeCheckIn(testEmployeeId, testAssignmentId, 52.3676, 4.9041);
    const result = await employeeCheckOut(testEmployeeId, testAssignmentId, 52.3676, 4.9041);

    expect(result.success).toBe(true);
    expect(result.record!.attendanceStatus).toBe('checked_out');
    // Database stores decimal(10,8) - 8 decimal places
    expect(result.record!.checkOutLatitude).toBe('52.36760000');
    expect(result.record!.checkOutLongitude).toBe('4.90410000');
  });

  it('SHOULD ALLOW check-out WITHOUT GPS coordinates', async () => {
    // Create fresh assignment
    const [shift] = await db.insert(shifts).values({
      title: 'No GPS Shift 2',
      workType: 'cleaning',
      location: 'Amsterdam',
      startAt: new Date('2099-01-03T09:00:00Z'),
      endAt: new Date('2099-01-03T17:00:00Z'),
      requiredWorkers: 1,
      createdBy: testEmployeeId,
      status: 'open',
    }).returning();

    const [assignment] = await db.insert(shiftAssignments).values({
      shiftId: shift.id,
      employeeId: testEmployeeId,
      status: 'assigned',
      assignedBy: testEmployeeId,
    }).returning();

    await employeeCheckIn(testEmployeeId, assignment.id, null, null);
    const result = await employeeCheckOut(testEmployeeId, assignment.id, null, null);

    expect(result.success).toBe(true);
    expect(result.record!.checkOutLatitude).toBeNull();
    expect(result.record!.checkOutLongitude).toBeNull();
  });

  it('should reject check-out without active check-in', async () => {
    const result = await employeeCheckOut(testEmployeeId, testAssignmentId, 52.3676, 4.9041);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Geen actieve inchecken');
  });

  it('should reject check-out for non-owned assignment', async () => {
    const [emp2] = await db.insert(profiles).values({
      fullName: 'Other Employee 2',
      email: uniqueEmail('other2'),
    }).returning();

    await employeeCheckIn(testEmployeeId, testAssignmentId, 52.3676, 4.9041);
    const result = await employeeCheckOut(emp2.id, testAssignmentId, 52.3676, 4.9041);

    expect(result.success).toBe(false);
    expect(result.message).toContain('geen toegang');
  });

  it('should update assignment status to confirmed on check-in', async () => {
    await employeeCheckIn(testEmployeeId, testAssignmentId, 52.3676, 4.9041);

    const [assignment] = await db.select().from(shiftAssignments).where(eq(shiftAssignments.id, testAssignmentId));
    expect(assignment.status).toBe('confirmed');
    expect(assignment.confirmedAt).toBeDefined();
  });
});

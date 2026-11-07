import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '@/backend/db';
import { getAuditLogs } from '@/backend/db/queries/audit';
import { applyForShiftWithLock } from '@/backend/db/queries/applications';
import {
  getAvailableShiftsForEmployee,
  getShifts,
  publishDraftShift,
} from '@/backend/db/queries/shifts';
import {
  auditLogs,
  profiles,
  shiftApplications,
  shiftAssignments,
  shifts,
} from '@/backend/db/schema';

describe('admin shift management lifecycle', () => {
  let adminId: string;
  let employeeId: string;
  let shiftId: string;
  let shiftIds: string[];
  let workType: string;

  beforeEach(async () => {
    const [admin] = await db.insert(profiles).values({
      fullName: 'Shift lifecycle administrator',
      email: `shift-admin-${crypto.randomUUID()}@workforce.test`,
    }).returning();
    const [employee] = await db.insert(profiles).values({
      fullName: 'Shift lifecycle employee',
      email: `shift-employee-${crypto.randomUUID()}@workforce.test`,
    }).returning();
    adminId = admin.id;
    employeeId = employee.id;
    workType = `lifecycle-${crypto.randomUUID()}`;
    const [shift] = await db.insert(shifts).values({
      title: 'Future traffic control',
      workType,
      location: 'Amsterdam',
      startAt: new Date('2099-01-15T08:00:00.000Z'),
      endAt: new Date('2099-01-15T16:00:00.000Z'),
      requiredWorkers: 2,
      createdBy: adminId,
      status: 'draft',
    }).returning();
    shiftId = shift.id;
    shiftIds = [shiftId];
  });

  afterEach(async () => {
    if (shiftIds.length) {
      await db.delete(auditLogs).where(or(
        inArray(auditLogs.actorId, [adminId, employeeId]),
        inArray(auditLogs.entityId, shiftIds)
      ));
      await db.delete(shifts).where(inArray(shifts.id, shiftIds));
    }
    await db.delete(profiles).where(inArray(profiles.id, [adminId, employeeId]));
  });

  it('keeps drafts private, atomically publishes once, audits, then permits a pending application', async () => {
    const unpublished = await getAvailableShiftsForEmployee({
      employeeId,
      page: 1,
      limit: 20,
    });
    expect(unpublished.data.some((shift) => shift.id === shiftId)).toBe(false);

    const publishResults = await Promise.all([
      publishDraftShift(shiftId, adminId),
      publishDraftShift(shiftId, adminId),
    ]);
    expect(publishResults.map((result) => result.status).sort()).toEqual(['conflict', 'published']);

    const [published] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    expect(published.status).toBe('open');

    const { data: publishAudits, total } = await getAuditLogs({
      entityType: 'shifts',
      entityId: shiftId,
    });
    expect(total).toBe(1);
    expect(publishAudits.filter((entry) => entry.action === 'UPDATE')).toHaveLength(1);
    expect(publishAudits.find((entry) => entry.action === 'UPDATE')).toMatchObject({
      actorId: adminId,
      oldValues: { status: 'draft' },
      newValues: { status: 'open' },
    });

    const visible = await getAvailableShiftsForEmployee({
      employeeId,
      page: 1,
      limit: 20,
    });
    expect(visible.data.map((shift) => shift.id)).toContain(shiftId);

    const application = await applyForShiftWithLock(shiftId, employeeId);
    expect(application.success).toBe(true);
    const [storedApplication] = await db.select().from(shiftApplications).where(and(
      eq(shiftApplications.shiftId, shiftId),
      eq(shiftApplications.employeeId, employeeId)
    ));
    expect(storedApplication.status).toBe('pending');
  });

  it('rejects publishing invalid or non-draft schedules without changing status', async () => {
    const invalidScheduleId = await createShift({
      title: 'Past shift',
      startAt: new Date('2000-01-01T08:00:00.000Z'),
      endAt: new Date('2000-01-01T16:00:00.000Z'),
      status: 'draft',
    });

    const invalid = await publishDraftShift(invalidScheduleId, adminId);
    const repeated = await publishDraftShift(invalidScheduleId, adminId);
    const [stored] = await db.select().from(shifts).where(eq(shifts.id, invalidScheduleId));

    expect(invalid.status).toBe('invalid');
    expect(repeated.status).toBe('invalid');
    expect(stored.status).toBe('draft');

    shiftIds.push(invalidScheduleId);
  });

  it('applies status filters, pagination, sorting and counts only active assignments', async () => {
    const secondShiftId = await createShift({
      title: 'Second future shift',
      startAt: new Date('2099-02-01T08:00:00.000Z'),
      endAt: new Date('2099-02-01T16:00:00.000Z'),
      status: 'draft',
    });
    shiftIds.push(secondShiftId);

    await db.insert(shiftAssignments).values({
      shiftId,
      employeeId,
      status: 'cancelled',
      assignedBy: adminId,
    });

    const result = await getShifts({
      status: 'draft',
      workType,
      page: 1,
      limit: 1,
      sortBy: 'startAt',
      sortOrder: 'asc',
    });
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(shiftId);
    expect(result.data[0].assignedCount).toBe(0);
  });

  async function createShift(values: {
    title: string;
    startAt: Date;
    endAt: Date;
    status: 'draft' | 'open';
  }): Promise<string> {
    const [created] = await db.insert(shifts).values({
      title: values.title,
      workType,
      location: 'Amsterdam',
      startAt: values.startAt,
      endAt: values.endAt,
      requiredWorkers: 1,
      createdBy: adminId,
      status: values.status,
    }).returning();
    return created.id;
  }
});

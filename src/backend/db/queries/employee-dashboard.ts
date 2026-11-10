import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/backend/db';
import { attendanceRecords, shiftApplications, shiftAssignments, shifts } from '@/backend/db/schema';
import { dateKeyInTimeZone, DEFAULT_WORKSITE_TIME_ZONE } from '@/shared/worksite-time';
import type { EmployeeDashboardSummary } from '@/shared/employee-dashboard';

export async function getEmployeeDashboard(employeeId: string, now = new Date()): Promise<EmployeeDashboardSummary> {
  const month = dateKeyInTimeZone(now, DEFAULT_WORKSITE_TIME_ZONE).slice(0, 7);
  const localStart = `${month}-01`;
  const start = sql`(${localStart}::date::timestamp AT TIME ZONE ${DEFAULT_WORKSITE_TIME_ZONE})`;
  const end = sql`((${localStart}::date + interval '1 month') AT TIME ZONE ${DEFAULT_WORKSITE_TIME_ZONE})`;

  // Keep counts and recent applications in one consistent read snapshot.
  return db.transaction(async tx => {
    const [applications] = await tx.select({
      pending: sql<number>`count(*) filter (where ${shiftApplications.status} = 'pending')`.mapWith(Number),
      accepted: sql<number>`count(*) filter (where ${shiftApplications.status} = 'accepted'
        and ${shiftApplications.reviewedAt} >= ${start} and ${shiftApplications.reviewedAt} < ${end})`.mapWith(Number),
    }).from(shiftApplications).where(eq(shiftApplications.employeeId, employeeId));

    // Open, invalid, or missed sessions are not worked-hour estimates. Actual UTC
    // durations account for DST; clipping attributes overnight time to each month.
    const [attendance] = await tx.select({
      hours: sql<number>`coalesce(sum(extract(epoch from (
        least(${attendanceRecords.checkOutAt}, ${end}) - greatest(${attendanceRecords.checkInAt}, ${start})
      )) / 3600), 0)`.mapWith(Number),
    }).from(attendanceRecords)
      .innerJoin(shiftAssignments, eq(attendanceRecords.shiftAssignmentId, shiftAssignments.id))
      .where(and(
        eq(shiftAssignments.employeeId, employeeId),
        eq(attendanceRecords.attendanceStatus, 'checked_out'),
        sql`${attendanceRecords.checkOutAt} > ${attendanceRecords.checkInAt}`,
        sql`${attendanceRecords.checkOutAt} > ${start}`,
        sql`${attendanceRecords.checkInAt} < ${end}`,
      ));

    const recent = await tx.select({
      id: shiftApplications.id, status: shiftApplications.status, appliedAt: shiftApplications.appliedAt,
      shift: { title: shifts.title, startAt: shifts.startAt, endAt: shifts.endAt, location: shifts.location },
    }).from(shiftApplications).innerJoin(shifts, eq(shiftApplications.shiftId, shifts.id))
      .where(eq(shiftApplications.employeeId, employeeId))
      .orderBy(desc(shiftApplications.appliedAt), desc(shiftApplications.id)).limit(3);

    return {
      month, timeZone: DEFAULT_WORKSITE_TIME_ZONE,
      pendingApplications: applications.pending, acceptedThisMonth: applications.accepted,
      workedHoursThisMonth: attendance.hours,
      recentApplications: recent.map(item => ({
        ...item, appliedAt: item.appliedAt.toISOString(),
        shift: { ...item.shift, startAt: item.shift.startAt.toISOString(), endAt: item.shift.endAt.toISOString() },
      })),
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

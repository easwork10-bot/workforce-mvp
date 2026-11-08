import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { inArray } from 'drizzle-orm';
import { db } from '@/backend/db';
import { attendanceRecords, profiles, shiftAssignments, shifts, userRoles } from '@/backend/db/schema';
import type { ShiftAssignment } from '@/backend/db/schema';
import { createTokenPair, decodeJwt, hashToken } from '@/backend/auth/tokens';
import { createSession, deleteSession } from '@/backend/auth/session';
import { getEmployeeSchedule } from '@/backend/db/queries/assignments';
import { GET } from '@/app/api/employee/schedule/route';

type Identity = { id: string; token: string; jti: string; refreshHash: string };
type ScheduleItem = {
  id: string;
  employeeId: string;
  shiftId: string;
  status: ShiftAssignment['status'];
  shift: { id: string; title: string; startAt: string; endAt: string; timeZone: string };
  attendance: { id: string; checkInAt: string | null; checkOutAt: string | null; attendanceStatus: string } | null;
};
type SchedulePage = {
  assignments: ScheduleItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

const shiftCases = [
  { key: 'spring-before', start: '2027-03-27T21:00:00.000Z', end: '2027-03-27T23:00:00.000Z', status: 'assigned' },
  { key: 'spring-overnight', start: '2027-03-27T22:30:00.000Z', end: '2027-03-27T23:30:00.000Z', status: 'confirmed' },
  { key: 'spring-first', start: '2027-03-27T23:00:00.000Z', end: '2027-03-28T00:00:00.000Z', status: 'assigned' },
  { key: 'spring-last', start: '2027-03-28T21:59:59.999Z', end: '2027-03-28T22:30:00.000Z', status: 'completed' },
  { key: 'spring-after', start: '2027-03-28T22:00:00.000Z', end: '2027-03-28T23:00:00.000Z', status: 'cancelled' },
  { key: 'next-last', start: '2027-03-29T21:59:59.999Z', end: '2027-03-29T22:30:00.000Z', status: 'assigned' },
  { key: 'next-after', start: '2027-03-29T22:00:00.000Z', end: '2027-03-29T23:00:00.000Z', status: 'assigned' },
  { key: 'autumn-before', start: '2027-10-30T21:00:00.000Z', end: '2027-10-30T22:00:00.000Z', status: 'assigned' },
  { key: 'autumn-first', start: '2027-10-30T22:00:00.000Z', end: '2027-10-30T23:00:00.000Z', status: 'assigned' },
  { key: 'autumn-last', start: '2027-10-31T22:59:59.999Z', end: '2027-10-31T23:30:00.000Z', status: 'confirmed' },
  { key: 'autumn-after', start: '2027-10-31T23:00:00.000Z', end: '2027-11-01T00:00:00.000Z', status: 'assigned' },
  { key: 'other-only', start: '2027-03-28T08:00:00.000Z', end: '2027-03-28T09:00:00.000Z', status: 'assigned' },
] as const;

describe('employee schedule with PostgreSQL and real JWT/Redis sessions', () => {
  let employee: Identity;
  let otherEmployee: Identity;
  let admin: Identity;
  let supervisor: Identity;
  const identities: Identity[] = [];
  const shiftIds: string[] = [];
  const assignments = new Map<string, ShiftAssignment>();
  let historyAssignment: ShiftAssignment;
  let latestAttendanceId: string;

  async function identity(role: 'administrator' | 'supervisor' | 'employee'): Promise<Identity> {
    const [profile] = await db.insert(profiles).values({
      fullName: `Schedule ${role}`,
      email: `schedule-${randomUUID()}@workforce.test`,
    }).returning();
    await db.insert(userRoles).values({ userId: profile.id, role });
    const pair = await createTokenPair(profile.id, role, '127.0.0.1');
    const jti = decodeJwt(pair.accessToken).jti;
    if (typeof jti !== 'string') throw new Error('Generated JWT is missing its session ID');
    const user = { id: profile.id, token: pair.accessToken, jti, refreshHash: hashToken(pair.refreshToken) };
    identities.push(user);
    await createSession(jti, profile.id, role, '127.0.0.1', 'employee-schedule-test', pair.refreshToken);
    return user;
  }

  function request(query = '', user?: Identity): NextRequest {
    return new NextRequest(`http://localhost/api/employee/schedule${query}`, {
      headers: user ? { cookie: `access_token=${user.token}` } : {},
    });
  }

  async function page(query = '', user = employee): Promise<SchedulePage> {
    const response = await GET(request(query, user));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return response.json();
  }

  function assignment(key: string): ShiftAssignment {
    const result = assignments.get(key);
    if (!result) throw new Error(`Missing schedule fixture: ${key}`);
    return result;
  }

  beforeAll(async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    vi.stubEnv('JWT_PRIVATE_KEY_FILE', '');
    vi.stubEnv('JWT_PUBLIC_KEY_FILE', '');
    vi.stubEnv('JWT_PRIVATE_KEY_B64', Buffer.from(keys.privateKey.export({ format: 'pem', type: 'pkcs8' })).toString('base64'));
    vi.stubEnv('JWT_PUBLIC_KEY_B64', Buffer.from(keys.publicKey.export({ format: 'pem', type: 'spki' })).toString('base64'));

    admin = await identity('administrator');
    supervisor = await identity('supervisor');
    employee = await identity('employee');
    otherEmployee = await identity('employee');

    const createdShifts = await db.insert(shifts).values(shiftCases.map(item => ({
      title: item.key,
      workType: 'schedule-test',
      location: 'Amsterdam',
      startAt: new Date(item.start),
      endAt: new Date(item.end),
      requiredWorkers: 2,
      createdBy: admin.id,
      status: 'open' as const,
    }))).returning();
    shiftIds.push(...createdShifts.map(item => item.id));
    const createdAssignments = await db.insert(shiftAssignments).values(shiftCases.map((item, index) => ({
      shiftId: createdShifts[index].id,
      employeeId: item.key === 'other-only' ? otherEmployee.id : employee.id,
      assignedBy: admin.id,
      status: item.status,
    }))).returning();
    for (const [index, item] of shiftCases.entries()) assignments.set(item.key, createdAssignments[index]);

    [historyAssignment] = await db.insert(shiftAssignments).values({
      shiftId: assignment('spring-first').shiftId,
      employeeId: employee.id,
      assignedBy: admin.id,
      status: 'completed',
    }).returning();
    await db.insert(shiftAssignments).values({
      shiftId: assignment('spring-first').shiftId,
      employeeId: otherEmployee.id,
      assignedBy: admin.id,
      status: 'assigned',
    });

    const attendanceIds = [randomUUID(), randomUUID(), randomUUID()];
    const latestIds = attendanceIds.slice(1).sort();
    latestAttendanceId = latestIds[1];
    await db.insert(attendanceRecords).values([
      {
        id: attendanceIds[0], shiftAssignmentId: assignment('spring-overnight').id,
        attendanceStatus: 'checked_in', createdAt: new Date('2027-03-27T21:00:00.000Z'),
      },
      {
        id: attendanceIds[1], shiftAssignmentId: assignment('spring-overnight').id,
        attendanceStatus: 'late', createdAt: new Date('2027-03-27T22:00:00.000Z'),
      },
      {
        id: attendanceIds[2], shiftAssignmentId: assignment('spring-overnight').id,
        attendanceStatus: 'checked_out', createdAt: new Date('2027-03-27T22:00:00.000Z'),
      },
    ]);
  });

  afterAll(async () => {
    if (shiftIds.length) await db.delete(shifts).where(inArray(shifts.id, shiftIds));
    for (const user of identities) await deleteSession(user.jti, user.id, user.refreshHash);
    if (identities.length) await db.delete(profiles).where(inArray(profiles.id, identities.map(user => user.id)));
    vi.unstubAllEnvs();
  });

  it('scopes every result to the signed-in employee even when another employeeId is supplied', async () => {
    const result = await page(`?employeeId=${otherEmployee.id}&limit=100`);
    expect(result.pagination.total).toBe(shiftCases.length);
    expect(result.assignments.every(item => item.employeeId === employee.id)).toBe(true);
    expect(result.assignments.map(item => item.id)).not.toContain(assignment('other-only').id);
    expect((await page(`?shiftId=${assignment('other-only').shiftId}`)).assignments).toEqual([]);
  });

  it.each(['assigned', 'confirmed', 'cancelled', 'completed'] as const)(
    'filters assignment status %s and reports the matching total', async status => {
      const expected = [...assignments.values(), historyAssignment]
        .filter(item => item.employeeId === employee.id && item.status === status);
      const result = await page(`?status=${status}&limit=100`);
      expect(result.pagination.total).toBe(expected.length);
      expect(result.assignments.map(item => item.id).sort()).toEqual(expected.map(item => item.id).sort());
    },
  );

  it('includes overnight overlaps and both ends of a spring DST calendar day', async () => {
    const result = await page('?dateFrom=2027-03-28&dateTo=2027-03-28&limit=100');
    expect(result.assignments.map(item => item.id).sort()).toEqual([
      assignment('spring-overnight').id,
      assignment('spring-first').id,
      historyAssignment.id,
      assignment('spring-last').id,
    ].sort());
    expect(result.pagination.total).toBe(4);
    expect(result.assignments.every(item => item.shift.timeZone === 'Europe/Amsterdam')).toBe(true);
    expect(result.assignments.find(item => item.id === assignment('spring-overnight').id)?.shift)
      .toMatchObject({ startAt: '2027-03-27T22:30:00.000Z', endAt: '2027-03-27T23:30:00.000Z' });
  });

  it('includes the full end date and excludes shifts touching the exclusive next midnight', async () => {
    const result = await page('?dateFrom=2027-03-28&dateTo=2027-03-29&limit=100');
    const ids = result.assignments.map(item => item.id);
    expect(ids).toContain(assignment('next-last').id);
    expect(ids).not.toContain(assignment('next-after').id);
    expect(ids).not.toContain(assignment('spring-before').id);
  });

  it('uses the 25-hour autumn DST day and excludes adjacent midnight boundaries', async () => {
    const result = await page('?dateFrom=2027-10-31&dateTo=2027-10-31&limit=100');
    expect(result.assignments.map(item => item.id).sort()).toEqual([
      assignment('autumn-first').id, assignment('autumn-last').id,
    ].sort());
    expect(result.pagination.total).toBe(2);
  });

  it('applies individual start and end bounds to overlapping shifts', async () => {
    const after = await page('?dateFrom=2027-03-28&limit=100');
    expect(after.assignments.map(item => item.id)).toContain(assignment('spring-overnight').id);
    expect(after.assignments.map(item => item.id)).not.toContain(assignment('spring-before').id);
    const before = await page('?dateTo=2027-03-28&limit=100');
    expect(before.assignments.map(item => item.id)).toContain(assignment('spring-last').id);
    expect(before.assignments.map(item => item.id)).not.toContain(assignment('spring-after').id);
  });

  it('filters by shift and orders equal start times deterministically across pages', async () => {
    const expected = [assignment('spring-first').id, historyAssignment.id].sort();
    const first = await page(`?shiftId=${assignment('spring-first').shiftId}&page=1&limit=1`);
    const second = await page(`?shiftId=${assignment('spring-first').shiftId}&page=2&limit=1`);
    expect(first.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect([first.assignments[0].id, second.assignments[0].id]).toEqual(expected);
  });

  it('returns only the latest attendance record with a deterministic tie-breaker', async () => {
    const result = await page(`?shiftId=${assignment('spring-overnight').shiftId}`);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].attendance).toMatchObject({ id: latestAttendanceId });
    const withoutAttendance = await page(`?shiftId=${assignment('spring-first').shiftId}`);
    expect(withoutAttendance.assignments.every(item => item.attendance === null)).toBe(true);
  });

  it('uses a bounded number of queries for attendance regardless of page size', async () => {
    const select = vi.spyOn(db, 'select');
    const selectDistinctOn = vi.spyOn(db, 'selectDistinctOn');
    try {
      const result = await getEmployeeSchedule({ employeeId: employee.id, limit: 100 });
      expect(result.data.length).toBeGreaterThan(10);
      expect(select).toHaveBeenCalledTimes(2);
      expect(selectDistinctOn).toHaveBeenCalledTimes(1);
    } finally {
      select.mockRestore();
      selectDistinctOn.mockRestore();
    }
  });

  it('rejects invalid and reversed dates before querying', async () => {
    for (const query of ['?dateFrom=2027-02-29', '?dateFrom=2027-03-29&dateTo=2027-03-28']) {
      const response = await GET(request(query, employee));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'Invalid query parameters' });
    }
  });

  it('requires an authenticated employee role', async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('', admin))).status).toBe(403);
    expect((await GET(request('', supervisor))).status).toBe(403);
  });
});

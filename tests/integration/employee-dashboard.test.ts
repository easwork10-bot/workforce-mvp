import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/backend/db';
import { attendanceRecords, profiles, shiftApplications, shiftAssignments, shifts, userRoles } from '@/backend/db/schema';
import { createTokenPair, decodeJwt, hashToken } from '@/backend/auth/tokens';
import { createSession, deleteSession } from '@/backend/auth/session';
import { getEmployeeDashboard } from '@/backend/db/queries/employee-dashboard';
import { GET } from '@/app/api/employee/dashboard/route';
import { employeeDashboardSchema } from '@/shared/employee-dashboard';
import { dateKeyInTimeZone, DEFAULT_WORKSITE_TIME_ZONE } from '@/shared/worksite-time';

type Identity = { id: string; token: string; jti: string; refreshHash: string };
describe('employee dashboard with PostgreSQL and real sessions', () => {
  const identities: Identity[] = [];
  const shiftIds: string[] = [];
  let employee: Identity;
  let other: Identity;
  let admin: Identity;
  let supervisor: Identity;
  let assignmentId: string;
  const appIds: string[] = [];
  const now = new Date('2027-03-15T12:00:00Z');
  async function identity(role: 'employee' | 'administrator' | 'supervisor') {
    const [profile] = await db.insert(profiles).values({ fullName: role, email: `dashboard-${randomUUID()}@workforce.test` }).returning();
    await db.insert(userRoles).values({ userId: profile.id, role });
    const pair = await createTokenPair(profile.id, role, '127.0.0.1');
    const jti = decodeJwt(pair.accessToken).jti!;
    const user = { id: profile.id, token: pair.accessToken, jti, refreshHash: hashToken(pair.refreshToken) };
    identities.push(user);
    await createSession(jti, profile.id, role, '127.0.0.1', 'dashboard-test', pair.refreshToken);
    return user;
  }
  function request(user?: Identity, query = '') {
    return new NextRequest(`http://localhost/api/employee/dashboard${query}`, { headers: user ? { cookie: `access_token=${user.token}` } : {} });
  }
  beforeAll(async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    vi.stubEnv('JWT_PRIVATE_KEY_FILE', ''); vi.stubEnv('JWT_PUBLIC_KEY_FILE', '');
    vi.stubEnv('JWT_PRIVATE_KEY_B64', Buffer.from(keys.privateKey.export({ format: 'pem', type: 'pkcs8' })).toString('base64'));
    vi.stubEnv('JWT_PUBLIC_KEY_B64', Buffer.from(keys.publicKey.export({ format: 'pem', type: 'spki' })).toString('base64'));
    employee = await identity('employee'); other = await identity('employee');
    admin = await identity('administrator'); supervisor = await identity('supervisor');
    const [shift] = await db.insert(shifts).values({ title: 'Owned dashboard shift', workType: 'cleaning', location: 'Amsterdam',
      startAt: now, endAt: new Date('2027-03-15T15:00:00Z'), requiredWorkers: 1, status: 'filled', createdBy: admin.id }).returning();
    shiftIds.push(shift.id);
    const [assignment] = await db.insert(shiftAssignments).values({ shiftId: shift.id, employeeId: employee.id, assignedBy: admin.id, status: 'completed' }).returning();
    assignmentId = assignment.id;
    for (const [status, reviewedAt] of [
      ['pending', null], ['accepted', '2027-02-28T23:00:00Z'], ['accepted', '2027-03-31T22:00:00Z'],
      ['accepted', '2027-02-28T22:59:59Z'], ['rejected', null], ['cancelled', null],
    ] as const) {
      const [application] = await db.insert(shiftApplications).values({ shiftId: shift.id, employeeId: employee.id, status,
        appliedAt: now, reviewedAt: reviewedAt ? new Date(reviewedAt) : null }).returning();
      appIds.push(application.id);
    }
    const [foreignShift] = await db.insert(shifts).values({ title: 'Other employee private shift', workType: 'cleaning', location: 'Elsewhere',
      startAt: now, endAt: new Date('2027-03-15T15:00:00Z'), requiredWorkers: 1, createdBy: admin.id }).returning();
    shiftIds.push(foreignShift.id);
    await db.insert(shiftApplications).values({ shiftId: foreignShift.id, employeeId: other.id, status: 'pending' });
    const [foreignAssignment] = await db.insert(shiftAssignments).values({ shiftId: foreignShift.id, employeeId: other.id, assignedBy: admin.id }).returning();
    await db.insert(attendanceRecords).values({ shiftAssignmentId: foreignAssignment.id, attendanceStatus: 'checked_out',
      checkInAt: new Date('2027-03-15T00:00:00Z'), checkOutAt: new Date('2027-03-15T20:00:00Z') });
    for (const [start, end, status] of [
      ['2027-02-28T22:00:00Z', '2027-03-01T00:00:00Z', 'checked_out'],
      ['2027-03-31T21:00:00Z', '2027-03-31T23:00:00Z', 'checked_out'],
      ['2027-03-28T00:00:00Z', '2027-03-28T02:00:00Z', 'checked_out'],
      ['2027-03-15T10:00:00Z', '2027-03-15T11:00:00Z', 'checked_out'],
      ['2027-03-15T11:30:00Z', '2027-03-15T12:00:00Z', 'checked_out'],
      ['2027-03-15T10:00:00Z', null, 'checked_in'],
      ['2027-03-15T10:00:00Z', '2027-03-15T09:00:00Z', 'checked_out'],
      ['2027-03-15T10:00:00Z', '2027-03-15T12:00:00Z', 'missed_checkout'],
    ] as const) await db.insert(attendanceRecords).values({ shiftAssignmentId: assignmentId, attendanceStatus: status,
      checkInAt: new Date(start), checkOutAt: end ? new Date(end) : null });
  });
  afterAll(async () => {
    if (shiftIds.length) await db.delete(shifts).where(inArray(shifts.id, shiftIds));
    for (const user of identities) await deleteSession(user.jti, user.id, user.refreshHash);
    if (identities.length) await db.delete(profiles).where(inArray(profiles.id, identities.map(user => user.id)));
    vi.unstubAllEnvs();
  });
  it('counts only owned applications and uses inclusive local month start and exclusive month end', async () => {
    const result = employeeDashboardSchema.parse(await getEmployeeDashboard(employee.id, now));
    expect(result).toMatchObject({ month: '2027-03', timeZone: 'Europe/Amsterdam', pendingApplications: 1, acceptedThisMonth: 1 });
    expect(result.recentApplications.map(app => app.id)).toEqual([...appIds].sort().reverse().slice(0, 3));
    expect(result.recentApplications.every(app => app.shift.title === 'Owned dashboard shift')).toBe(true);
  });
  it('clips completed sessions at month boundaries, handles DST and repeated sessions, excludes incomplete/invalid/foreign time', async () => {
    expect((await getEmployeeDashboard(employee.id, now)).workedHoursThisMonth).toBe(5.5);
    expect((await getEmployeeDashboard(employee.id, new Date('2027-04-15T00:00:00Z'))).workedHoursThisMonth).toBe(1);
  });
  it('uses Amsterdam month even when the UTC date is still in the previous month', async () => {
    expect((await getEmployeeDashboard(employee.id, new Date('2027-02-28T23:30:00Z'))).month).toBe('2027-03');
  });
  it('returns real zero values for an employee without records', async () => {
    const empty = await identity('employee');
    expect(await getEmployeeDashboard(empty.id, now)).toMatchObject({ pendingApplications: 0, acceptedThisMonth: 0, workedHoursThisMonth: 0, recentApplications: [] });
  });
  it('ignores spoofed ownership and month parameters and never caches data', async () => {
    const response = await GET(request(other, `?employeeId=${employee.id}&month=2027-03`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = employeeDashboardSchema.parse(await response.json());
    expect(body.recentApplications.map(app => app.shift.title)).toEqual(['Other employee private shift']);
    expect(body.month).toBe(dateKeyInTimeZone(new Date(), DEFAULT_WORKSITE_TIME_ZONE).slice(0, 7));
  });
  it('rejects anonymous, administrator and supervisor access', async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request(admin))).status).toBe(403);
    expect((await GET(request(supervisor))).status).toBe(403);
  });
  it('rejects revoked sessions', async () => {
    await deleteSession(employee.jti, employee.id, employee.refreshHash);
    expect((await GET(request(employee))).status).toBe(401);
  });
  it('rejects a session after its account is deactivated', async () => {
    const inactive = await identity('employee');
    await db.update(profiles).set({ accountStatus: 'inactive' }).where(eq(profiles.id, inactive.id));
    expect((await GET(request(inactive))).status).toBe(401);
  });
});

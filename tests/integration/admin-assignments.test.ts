import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { NextRequest } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/backend/db';
import { auditLogs, notifications, profiles, shiftApplications, shiftAssignments, shifts } from '@/backend/db/schema';
import type { ShiftAssignment } from '@/backend/db/schema';
import { createTokenPair, decodeJwt, hashToken } from '@/backend/auth/tokens';
import { createSession, deleteSession } from '@/backend/auth/session';
import { getAssignments } from '@/backend/db/queries/assignments';
import { GET } from '@/app/api/admin/assignments/route';

type Identity = { id: string; token: string; jti: string; refreshHash: string };

describe('admin assignments GET with PostgreSQL and real JWT/Redis sessions', () => {
  let admin: Identity;
  let otherAdmin: Identity;
  let employee: Identity;
  let supervisor: Identity;
  let assignments: ShiftAssignment[];
  const identities: Identity[] = [];
  const shiftIds: string[] = [];

  beforeAll(() => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    vi.stubEnv('JWT_PRIVATE_KEY_FILE', '');
    vi.stubEnv('JWT_PUBLIC_KEY_FILE', '');
    vi.stubEnv('JWT_PRIVATE_KEY_B64', Buffer.from(keys.privateKey.export({ format: 'pem', type: 'pkcs8' })).toString('base64'));
    vi.stubEnv('JWT_PUBLIC_KEY_B64', Buffer.from(keys.publicKey.export({ format: 'pem', type: 'spki' })).toString('base64'));
  });

  beforeEach(async () => {
    admin = await identity('administrator');
    otherAdmin = await identity('administrator');
    employee = await identity('employee');
    supervisor = await identity('supervisor');
    for (const [index, owner] of [admin, otherAdmin].entries()) {
      const [shift] = await db.insert(shifts).values({
        title: `Assignment overview shift ${index}`,
        workType: 'assignment-overview-test',
        location: index === 0 ? 'Amsterdam' : 'Rotterdam',
        startAt: new Date(`2099-01-${15 + index}T08:00:00.000Z`),
        endAt: new Date(`2099-01-${15 + index}T16:00:00.000Z`),
        requiredWorkers: 2,
        createdBy: owner.id,
        status: 'open',
      }).returning();
      shiftIds.push(shift.id);
    }
    assignments = await db.insert(shiftAssignments).values([
      {
        shiftId: shiftIds[0], employeeId: employee.id, assignedBy: admin.id,
        status: 'assigned', assignedAt: new Date('2098-01-02T08:00:00.000Z'),
      },
      {
        shiftId: shiftIds[0], employeeId: employee.id, assignedBy: admin.id,
        status: 'completed', assignedAt: new Date('2098-01-02T08:00:00.000Z'),
        confirmedAt: new Date('2098-01-02T09:00:00.000Z'),
      },
      {
        shiftId: shiftIds[0], employeeId: employee.id, assignedBy: admin.id,
        status: 'cancelled', assignedAt: new Date('2098-01-01T08:00:00.000Z'),
      },
      {
        shiftId: shiftIds[1], employeeId: employee.id, assignedBy: otherAdmin.id,
        status: 'confirmed', assignedAt: new Date('2098-01-03T08:00:00.000Z'),
        confirmedAt: new Date('2098-01-03T09:00:00.000Z'),
      },
    ]).returning();
  });

  afterEach(async () => {
    if (shiftIds.length) await db.delete(shifts).where(inArray(shifts.id, shiftIds));
    for (const user of identities) await deleteSession(user.jti, user.id, user.refreshHash);
    if (identities.length) await db.delete(profiles).where(inArray(profiles.id, identities.map(user => user.id)));
    identities.length = 0;
    shiftIds.length = 0;
  });

  afterAll(() => vi.unstubAllEnvs());

  async function identity(role: 'administrator' | 'employee' | 'supervisor'): Promise<Identity> {
    const [profile] = await db.insert(profiles).values({
      fullName: `Assignment overview ${role}`,
      email: `assignments-${crypto.randomUUID()}@workforce.test`,
      passwordHash: 'must-not-be-returned',
    }).returning();
    const pair = await createTokenPair(profile.id, role, '127.0.0.1');
    const jti = decodeJwt(pair.accessToken).jti;
    if (typeof jti !== 'string') throw new Error('Generated JWT is missing its session ID');
    const user = { id: profile.id, token: pair.accessToken, jti, refreshHash: hashToken(pair.refreshToken) };
    identities.push(user);
    await createSession(jti, profile.id, role, '127.0.0.1', 'assignment-overview-test', pair.refreshToken);
    return user;
  }

  function request(query = '', user?: Identity): NextRequest {
    return new NextRequest(`http://localhost/api/admin/assignments${query}`, {
      headers: user ? { cookie: `access_token=${user.token}` } : {},
    });
  }

  it('returns all four states for administrators, including historical attempts for the same employee/shift', async () => {
    const response = await GET(request('', admin));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pagination).toEqual({ page: 1, limit: 20, total: 4, totalPages: 1 });
    expect(body.assignments.map((item: { id: string }) => item.id).sort())
      .toEqual(assignments.map(item => item.id).sort());
    expect(body.assignments.filter((item: { shiftId: string }) => item.shiftId === shiftIds[0])).toHaveLength(3);
    expect(body.assignments.map((item: { status: string }) => item.status).sort())
      .toEqual(['assigned', 'cancelled', 'completed', 'confirmed']);
  });

  it('preserves single-company access across shifts created by different administrators', async () => {
    const first = await (await GET(request('', admin))).json();
    const secondResponse = await GET(request('', otherAdmin));
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual(first);
    expect(first.assignments.map((item: { shiftId: string }) => item.shiftId)).toContain(shiftIds[1]);
  });

  it.each(['assigned', 'confirmed', 'cancelled', 'completed'] as const)(
    'filters %s with a matching total', async status => {
      const response = await GET(request(`?status=${status}&limit=1`, admin));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.pagination).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
      expect(body.assignments).toHaveLength(1);
      expect(body.assignments[0]).toMatchObject({
        id: assignments.find(item => item.status === status)?.id, status,
      });
    },
  );

  it('returns accurate display fields, assignment timestamps and null application links without private employee fields', async () => {
    const response = await GET(request('?status=confirmed', admin));
    expect(response.status).toBe(200);
    const body = await response.json();
    const stored = assignments.find(item => item.status === 'confirmed')!;
    expect(body.assignments).toEqual([{
      ...stored,
      assignedAt: stored.assignedAt.toISOString(),
      confirmedAt: stored.confirmedAt?.toISOString(),
      employee: { id: employee.id, fullName: 'Assignment overview employee' },
      shift: {
        id: shiftIds[1], title: 'Assignment overview shift 1', location: 'Rotterdam',
        startAt: '2099-01-16T08:00:00.000Z', endAt: '2099-01-16T16:00:00.000Z',
      },
    }]);
    const assigned = await (await GET(request('?status=assigned', admin))).json();
    expect(assigned.assignments[0].confirmedAt).toBeNull();
    expect(assigned.assignments[0].applicationId).toBeNull();
  });

  it('paginates with exact totals and a deterministic timestamp/ID tie-breaker, including beyond the last page', async () => {
    const tiedIds = assignments.filter(item => ['assigned', 'completed'].includes(item.status))
      .map(item => item.id).sort().reverse();
    const expectedIds = [
      assignments.find(item => item.status === 'confirmed')!.id,
      ...tiedIds,
      assignments.find(item => item.status === 'cancelled')!.id,
    ];
    const seen: string[] = [];
    for (let page = 1; page <= 5; page++) {
      const response = await GET(request(`?page=${page}&limit=1`, admin));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.pagination).toEqual({ page, limit: 1, total: 4, totalPages: 4 });
      expect(body.assignments.map((item: { id: string }) => item.id))
        .toEqual(page <= 4 ? [expectedIds[page - 1]] : []);
      seen.push(...body.assignments.map((item: { id: string }) => item.id));
    }
    expect(seen).toEqual(expectedIds);
    const repeat = await (await GET(request('?limit=100', admin))).json();
    expect(repeat.assignments.map((item: { id: string }) => item.id)).toEqual(expectedIds);
  });

  it('denies missing/invalid tokens, employees, supervisors and revoked sessions', async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('', { ...admin, token: 'invalid' }))).status).toBe(401);
    expect((await GET(request('', employee))).status).toBe(403);
    expect((await GET(request('', supervisor))).status).toBe(403);
    await deleteSession(admin.jti, admin.id, admin.refreshHash);
    expect((await GET(request('', admin))).status).toBe(401);
  });

  it('rejects invalid status, pagination, unknown and duplicate query parameters with real authorization', async () => {
    for (const query of [
      '?status=pending', '?page=0', '?limit=101', '?page=1.5', '?unknown=1',
      '?page=9007199254740991&limit=100', '?status=assigned&status=cancelled',
    ]) {
      const response = await GET(request(query, admin));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    }
  });

  it('retains repository shift and employee filters', async () => {
    const result = await getAssignments({ shiftId: shiftIds[0], employeeId: employee.id });
    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(3);
    expect(result.data.every(item => item.shiftId === shiftIds[0] && item.employeeId === employee.id)).toBe(true);
    expect(await getAssignments({ employeeId: supervisor.id })).toEqual({ data: [], total: 0 });
  });

  it('returns an empty page when there are no assignments', async () => {
    await db.delete(shiftAssignments).where(inArray(shiftAssignments.shiftId, shiftIds));
    const response = await GET(request('', admin));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assignments: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('does not mutate assignments, shifts, applications, notifications or audits', async () => {
    const snapshot = async () => ({
      assignments: await db.select().from(shiftAssignments).orderBy(shiftAssignments.id),
      shifts: await db.select().from(shifts).orderBy(shifts.id),
      applications: await db.select().from(shiftApplications).orderBy(shiftApplications.id),
      notifications: await db.select().from(notifications).orderBy(notifications.id),
      audits: await db.select().from(auditLogs).orderBy(auditLogs.id),
    });
    const [application] = await db.insert(shiftApplications).values({
      shiftId: shiftIds[1], employeeId: employee.id, status: 'accepted',
    }).returning();
    await db.update(shiftAssignments).set({ applicationId: application.id })
      .where(eq(shiftAssignments.id, assignments[3].id));
    const before = await snapshot();
    const response = await GET(request('', admin));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assignments.find((item: { id: string }) => item.id === assignments[3].id).applicationId).toBe(application.id);
    expect(await snapshot()).toEqual(before);
  });
});

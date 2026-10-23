import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { db } from '@/backend/db';
import { auditLogs, profiles } from '@/backend/db/schema';
import { getAuditLogs, logAuditEvent } from '@/backend/db/queries/audit';
import { auditLog } from '@/backend/security/auditLogger';
import type { AuthenticatedRequest } from '@/backend/security/requireAuth';
import { GET } from '@/app/api/admin/audit/route';
import { inArray } from 'drizzle-orm';

const authState = vi.hoisted(() => ({
  authenticated: true,
  userId: '',
  role: 'administrator' as 'administrator' | 'supervisor' | 'employee',
}));

vi.mock('@/backend/auth/tokens', () => ({
  verifyTokenFromCookie: vi.fn(async (cookieHeader: string | null) => (
    authState.authenticated && cookieHeader?.includes('access_token=valid')
      ? { sub: authState.userId, role: authState.role, jti: 'audit-api-test-session', ipHash: 'test' }
      : null
  )),
}));

vi.mock('@/backend/auth/session', () => ({
  getSession: vi.fn(async () => authState.authenticated
    ? {
        userId: authState.userId,
        role: authState.role,
        ipHash: 'test',
        userAgent: 'test',
        refreshHash: 'test',
      }
    : null),
  RedisUnavailableError: class RedisUnavailableError extends Error {},
}));

describe('Audit log query, wrapper, and read API', () => {
  let actorId: string;
  let secondActorId: string;
  const fixtureProfileIds: string[] = [];

  beforeEach(async () => {
    const [actor] = await db.insert(profiles).values({
      fullName: 'Audit actor',
      email: `audit-actor-${crypto.randomUUID()}@workforce.test`,
    }).returning();
    const [secondActor] = await db.insert(profiles).values({
      fullName: 'Second audit actor',
      email: `audit-actor-two-${crypto.randomUUID()}@workforce.test`,
    }).returning();
    actorId = actor.id;
    secondActorId = secondActor.id;
    fixtureProfileIds.push(actorId, secondActorId);
    authState.authenticated = true;
    authState.userId = actorId;
    authState.role = 'administrator';
  });

  afterEach(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, fixtureProfileIds));
    await db.delete(profiles).where(inArray(profiles.id, fixtureProfileIds));
    fixtureProfileIds.length = 0;
  });

  function getRequest(path: string, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
      headers: authenticated ? { cookie: 'access_token=valid' } : undefined,
    });
  }

  it('persists audit events and redacts sensitive values recursively', async () => {
    await logAuditEvent({
      actorId,
      actorType: 'user',
      action: 'UPDATE',
      entityType: 'profiles',
      entityId: secondActorId,
      oldValues: { fullName: 'Before', passwordHash: 'not-for-storage' },
      newValues: { profile: { fullName: 'After', accessToken: 'not-for-storage' } },
      ipAddress: '192.168.1.10',
      userAgent: 'audit-test',
    });

    const { data, total } = await getAuditLogs({ actorId });
    expect(total).toBe(1);
    expect(data[0]).toMatchObject({
      actorId,
      actorType: 'user',
      action: 'UPDATE',
      entityType: 'profiles',
      entityId: secondActorId,
      oldValues: { fullName: 'Before', passwordHash: '[REDACTED]' },
      newValues: { profile: { fullName: 'After', accessToken: '[REDACTED]' } },
      ipAddress: '192.168.1.10',
      userAgent: 'audit-test',
    });
    expect(data[0].createdAt).toBeInstanceOf(Date);
  });

  it('supports writing an audit event inside the caller transaction', async () => {
    await expect(db.transaction(async (transaction) => {
      await logAuditEvent({
        actorId,
        action: 'UPDATE',
        entityType: 'profiles',
        entityId: secondActorId,
        oldValues: { fullName: 'Before' },
        newValues: { fullName: 'After' },
        ipAddress: null,
        userAgent: null,
      }, transaction);
      throw new Error('rollback audit transaction');
    })).rejects.toThrow('rollback audit transaction');

    expect((await getAuditLogs({ actorId })).total).toBe(0);
  });

  it('filters audit logs and paginates in newest-first order', async () => {
    await db.insert(auditLogs).values([
      {
        actorId,
        action: 'INSERT',
        entityType: 'shifts',
        entityId: secondActorId,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        actorId,
        action: 'UPDATE',
        entityType: 'profiles',
        entityId: secondActorId,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      {
        actorId: secondActorId,
        action: 'DELETE',
        entityType: 'shifts',
        entityId: actorId,
        createdAt: new Date('2026-01-03T00:00:00Z'),
      },
    ]);

    const filtered = await getAuditLogs({
      actorId,
      entityType: 'shifts',
      entityId: secondActorId,
      page: 1,
      limit: 1,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].action).toBe('INSERT');

    const page = await getAuditLogs({ actorId, page: 1, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.data).toHaveLength(1);
    expect(page.data[0].entityType).toBe('profiles');
  });

  it('allows administrators and supervisors to read paginated filtered audit logs', async () => {
    await logAuditEvent({
      actorId,
      action: 'UPDATE',
      entityType: 'applications',
      entityId: secondActorId,
      oldValues: { password: 'redacted' },
      newValues: { status: 'accepted' },
      ipAddress: null,
      userAgent: null,
    });

    const response = await GET(getRequest('/api/admin/audit?entityType=applications&page=1&limit=5'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pagination).toMatchObject({ page: 1, limit: 5, total: 1 });
    expect(body.logs[0]).toMatchObject({
      actorId,
      entityType: 'applications',
      oldValues: { password: '[REDACTED]' },
    });

    authState.role = 'supervisor';
    const supervisorResponse = await GET(getRequest('/api/admin/audit?actorId=' + actorId));
    expect(supervisorResponse.status).toBe(200);
  });

  it('denies unauthenticated and employee access to audit logs', async () => {
    const unauthenticated = await GET(getRequest('/api/admin/audit', false));
    expect(unauthenticated.status).toBe(401);

    authState.role = 'employee';
    const employeeResponse = await GET(getRequest('/api/admin/audit'));
    expect(employeeResponse.status).toBe(403);
  });

  it('rejects invalid audit filters and pagination', async () => {
    for (const query of ['?actorId=invalid', '?entityType=', '?page=0', '?limit=101', '?employeeId=' + actorId]) {
      const response = await GET(getRequest(`/api/admin/audit${query}`));
      expect(response.status).toBe(400);
    }
  });

  it('writes an audit event only after successful handler completion with actor and hashed IP', async () => {
    const req = new NextRequest('http://localhost/api/admin/shifts', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '192.0.2.30',
        'user-agent': 'audit-wrapper-test',
      },
    }) as AuthenticatedRequest;
    req.auth = { userId: actorId, role: 'administrator', jti: 'audit-wrapper-jti' };
    const entityId = secondActorId;

    const wrapped = auditLog(async () => NextResponse.json({ success: true }), {
      action: 'INSERT',
      entityType: 'shifts',
      entityId: () => entityId,
      newValues: () => ({ title: 'Created shift', refreshToken: 'secret-token' }),
    });

    const response = await wrapped(req);
    expect(response.status).toBe(200);

    const { data, total } = await getAuditLogs({ actorId, entityType: 'shifts', entityId });
    expect(total).toBe(1);
    expect(data[0]).toMatchObject({
      action: 'INSERT',
      entityType: 'shifts',
      entityId,
      ipAddress: createHash('sha256').update('192.0.2.30').digest('hex').slice(0, 16),
      userAgent: 'audit-wrapper-test',
      newValues: { title: 'Created shift', refreshToken: '[REDACTED]' },
    });
  });

  it('does not log failed handlers and surfaces audit persistence failures', async () => {
    const req = new NextRequest('http://localhost/api/admin/shifts', { method: 'POST' }) as AuthenticatedRequest;
    req.auth = { userId: actorId, role: 'administrator', jti: 'audit-wrapper-jti' };

    const failedHandler = auditLog(async () => NextResponse.json({ error: true }, { status: 400 }), {
      action: 'INSERT',
      entityType: 'shifts',
      entityId: () => null,
    });
    const failedResponse = await failedHandler(req);
    expect(failedResponse.status).toBe(400);
    expect((await getAuditLogs({ actorId })).total).toBe(0);

    req.auth.userId = crypto.randomUUID();
    const successfulHandler = auditLog(async () => NextResponse.json({ success: true }), {
      action: 'INSERT',
      entityType: 'shifts',
      entityId: () => null,
    });
    const auditFailureResponse = await successfulHandler(req);
    expect(auditFailureResponse.status).toBe(500);
    expect(await auditFailureResponse.json()).toMatchObject({
      error: 'Action completed but audit record could not be saved',
    });
  });
});

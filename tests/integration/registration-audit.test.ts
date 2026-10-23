import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/backend/db';
import { auditLogs, profiles, userRoles } from '@/backend/db/schema';
import { getAuditLogs } from '@/backend/db/queries/audit';
import { POST } from '@/app/api/auth/register/route';

const auditState = vi.hoisted(() => ({
  failWrites: false,
}));

vi.mock('@/backend/db/queries/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/backend/db/queries/audit')>();
  return {
    ...actual,
    logAuditEvent: vi.fn(async (...args: Parameters<typeof actual.logAuditEvent>) => {
      if (auditState.failWrites) throw new Error('Simulated audit persistence failure');
      return actual.logAuditEvent(...args);
    }),
  };
});

vi.mock('@/backend/auth/passwords', () => ({
  hashPassword: vi.fn(async () => 'password-hash-must-not-be-audited'),
}));

vi.mock('@/backend/auth/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/backend/auth/tokens')>();
  return {
    ...actual,
    createTokenPair: vi.fn(async () => ({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token' })),
    decodeJwt: vi.fn(() => ({ jti: 'registration-audit-session' })),
  };
});

vi.mock('@/backend/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/backend/auth/session')>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 })),
    createSession: vi.fn(async () => undefined),
  };
});

describe('Registration audit integration', () => {
  const emails: string[] = [];
  const profileIds: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    auditState.failWrites = false;
    if (profileIds.length) {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, profileIds[0]));
      await db.delete(userRoles).where(eq(userRoles.userId, profileIds[0]));
      await db.delete(profiles).where(eq(profiles.id, profileIds[0]));
      profileIds.length = 0;
    }
    for (const email of emails) {
      await db.delete(profiles).where(eq(profiles.email, email));
    }
    emails.length = 0;
  });

  function registrationRequest(email: string): NextRequest {
    return new NextRequest('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'registration-audit-test' },
      body: JSON.stringify({
        email,
        password: 'SecretPassword123!',
        fullName: 'Registered Employee',
        preferredLanguage: 'nl',
      }),
    });
  }

  it('records registration and employee-role creation without sensitive profile values', async () => {
    const email = `registration-audit-${crypto.randomUUID()}@workforce.test`;
    emails.push(email);
    const response = await POST(registrationRequest(email));
    const body = await response.json();
    const id = body.user.id as string;
    profileIds.push(id);
    const logs = await getAuditLogs({ actorId: id, page: 1, limit: 10 });

    expect(response.status).toBe(200);
    expect(logs.total).toBe(2);
    expect(logs.data.map((entry) => entry.entityType).sort()).toEqual(['profiles', 'user_roles']);
    expect(logs.data.find((entry) => entry.entityType === 'profiles')?.newValues).toEqual({
      accountStatus: 'active',
    });
    expect(JSON.stringify(logs.data)).not.toContain(email);
    expect(JSON.stringify(logs.data)).not.toContain('SecretPassword123!');
    expect(JSON.stringify(logs.data)).not.toContain('password-hash-must-not-be-audited');
    expect(logs.data.every((entry) => entry.ipAddress !== null)).toBe(true);
  });

  it('rolls back new profile and role if audit persistence fails', async () => {
    const email = `registration-audit-failure-${crypto.randomUUID()}@workforce.test`;
    emails.push(email);
    auditState.failWrites = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(registrationRequest(email));
    const [profile] = await db.select().from(profiles).where(eq(profiles.email, email));

    expect(response.status).toBe(500);
    expect(profile).toBeUndefined();
  });
});

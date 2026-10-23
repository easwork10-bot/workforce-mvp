import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/backend/db';
import { auditLogs, notifications, profiles } from '@/backend/db/schema';
import { signCsrfToken } from '@/backend/security/csrf';
import { DELETE, PATCH } from '@/app/api/notifications/[id]/route';
import { GET, POST } from '@/app/api/notifications/route';
import { eq, inArray } from 'drizzle-orm';

const authState = vi.hoisted(() => ({
  authenticated: true,
  userId: '',
  role: 'employee' as 'administrator' | 'supervisor' | 'employee',
}));

vi.mock('@/backend/auth/tokens', () => ({
  verifyTokenFromCookie: vi.fn(async (cookieHeader: string | null) => authState.authenticated && cookieHeader?.includes('access_token=valid')
    ? { sub: authState.userId, role: authState.role, jti: 'notification-api-test-session', ipHash: 'test' }
    : null),
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

describe('Notification API', () => {
  let recipientId: string;
  let otherRecipientId: string;
  const fixtureProfileIds: string[] = [];

  beforeEach(async () => {
    const [recipient] = await db.insert(profiles).values({
      fullName: 'Notification API recipient',
      email: `notification-api-${crypto.randomUUID()}@workforce.test`,
    }).returning();
    const [otherRecipient] = await db.insert(profiles).values({
      fullName: 'Other notification recipient',
      email: `notification-api-other-${crypto.randomUUID()}@workforce.test`,
    }).returning();

    recipientId = recipient.id;
    otherRecipientId = otherRecipient.id;
    fixtureProfileIds.push(recipient.id, otherRecipient.id);
    authState.authenticated = true;
    authState.userId = recipientId;
    authState.role = 'employee';
  });

  afterEach(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, fixtureProfileIds));
    await db.delete(profiles).where(inArray(profiles.id, fixtureProfileIds));
    fixtureProfileIds.length = 0;
  });

  function request(
    method: string,
    path: string,
    options: { csrf?: boolean; body?: string; authenticated?: boolean } = {}
  ): NextRequest {
    const headers = new Headers();
    if (options.authenticated !== false) headers.set('cookie', 'access_token=valid');

    if (options.csrf) {
      const signedToken = signCsrfToken('notification-api-csrf');
      headers.set('cookie', `${headers.get('cookie') ? `${headers.get('cookie')}; ` : ''}csrf_token=${signedToken}`);
      headers.set('x-csrf-token', signedToken);
    }

    if (options.body !== undefined) headers.set('content-type', 'application/json');

    return new NextRequest(`http://localhost${path}`, {
      method,
      headers,
      body: options.body,
    });
  }

  async function createNotification(
    userId: string,
    title: string,
    options: { type?: typeof notifications.$inferInsert.type; readAt?: Date; createdAt?: Date } = {}
  ) {
    const [notification] = await db.insert(notifications).values({
      recipientId: userId,
      type: options.type ?? 'shift_created',
      title,
      readAt: options.readAt,
      createdAt: options.createdAt,
    }).returning();
    return notification;
  }

  it('requires authentication to list notifications', async () => {
    const response = await GET(request('GET', '/api/notifications', { authenticated: false }));
    expect(response.status).toBe(401);
  });

  it('lists only the caller’s notifications with type/read filters, pagination, and newest-first ordering', async () => {
    const oldest = await createNotification(recipientId, 'Oldest', {
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newest = await createNotification(recipientId, 'Newest', {
      createdAt: new Date('2026-01-03T00:00:00Z'),
    });
    await createNotification(recipientId, 'Read item', {
      readAt: new Date(),
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    await createNotification(otherRecipientId, 'Private item', {
      createdAt: new Date('2026-01-04T00:00:00Z'),
    });

    const response = await GET(request(
      'GET',
      '/api/notifications?type=shift_created&isRead=false&page=1&limit=1'
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ total: 2, page: 1, limit: 1, totalPages: 2 });
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(newest.id);
    expect(body.data[0].id).not.toBe(oldest.id);
    expect(JSON.stringify(body)).not.toContain('Private item');
    expect(body.data[0]).not.toHaveProperty('idempotencyKey');
    expect(body.data[0]).not.toHaveProperty('idempotencyPayloadHash');
  });

  it('supports all read states without accepting recipient selection', async () => {
    await createNotification(recipientId, 'Unread');
    await createNotification(recipientId, 'Read', { readAt: new Date() });

    const allResponse = await GET(request('GET', '/api/notifications?isRead=all'));
    expect((await allResponse.json()).total).toBe(2);

    const recipientOverride = await GET(request(
      'GET',
      `/api/notifications?recipientId=${otherRecipientId}`
    ));
    expect(recipientOverride.status).toBe(400);
  });

  it('rejects invalid filters and pagination', async () => {
    for (const query of ['?type=not-a-notification', '?page=0', '?limit=101', '?isRead=yes']) {
      const response = await GET(request('GET', `/api/notifications${query}`));
      expect(response.status).toBe(400);
    }
  });

  it('requires a valid CSRF token before marking a notification read', async () => {
    const notification = await createNotification(recipientId, 'Unread');
    const response = await PATCH(
      request('PATCH', `/api/notifications/${notification.id}`, { body: '{"read":true}' }),
      { params: { id: notification.id } }
    );

    expect(response.status).toBe(403);
  });

  it('requires authentication for mutations even when CSRF is valid', async () => {
    const notification = await createNotification(recipientId, 'Unauthenticated change');
    authState.authenticated = false;

    const response = await PATCH(
      request('PATCH', `/api/notifications/${notification.id}`, {
        csrf: true,
        body: JSON.stringify({ read: true }),
      }),
      { params: { id: notification.id } }
    );

    expect(response.status).toBe(401);
    const [unchanged] = await db.select().from(notifications)
      .where(eq(notifications.id, notification.id));
    expect(unchanged.readAt).toBeNull();
  });

  it('marks an owned notification as read and rejects content changes', async () => {
    const notification = await createNotification(recipientId, 'Keep this title');
    const response = await PATCH(
      request('PATCH', `/api/notifications/${notification.id}`, {
        csrf: true,
        body: JSON.stringify({ read: true }),
      }),
      { params: { id: notification.id } }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const [updated] = await db.select().from(notifications)
      .where(eq(notifications.id, notification.id));
    expect(updated.readAt).not.toBeNull();
    expect(updated.title).toBe('Keep this title');
  });

  it('rejects malformed JSON, unsupported fields, and invalid IDs', async () => {
    const malformedJson = await PATCH(
      request('PATCH', '/api/notifications/invalid', { csrf: true, body: '{' }),
      { params: { id: 'invalid' } }
    );
    expect(malformedJson.status).toBe(400);

    const extraFields = await PATCH(
      request('PATCH', '/api/notifications/invalid', {
        csrf: true,
        body: JSON.stringify({ read: true, title: 'Forged title' }),
      }),
      { params: { id: 'invalid' } }
    );
    expect(extraFields.status).toBe(400);

    const invalidId = await DELETE(
      request('DELETE', '/api/notifications/not-a-uuid', { csrf: true }),
      { params: { id: 'not-a-uuid' } }
    );
    expect(invalidId.status).toBe(400);
  });

  it('does not reveal or modify another recipient’s notification', async () => {
    const notification = await createNotification(otherRecipientId, 'Other person’s item');

    const patched = await PATCH(
      request('PATCH', `/api/notifications/${notification.id}`, {
        csrf: true,
        body: JSON.stringify({ read: true }),
      }),
      { params: { id: notification.id } }
    );
    expect(patched.status).toBe(404);

    const deleted = await DELETE(
      request('DELETE', `/api/notifications/${notification.id}`, { csrf: true }),
      { params: { id: notification.id } }
    );
    expect(deleted.status).toBe(404);

    const [unchanged] = await db.select().from(notifications)
      .where(eq(notifications.id, notification.id));
    expect(unchanged).toBeDefined();
    expect(unchanged.readAt).toBeNull();
  });

  it('dismisses an owned notification and returns 404 for unknown IDs', async () => {
    const notification = await createNotification(recipientId, 'Dismiss me');
    const deleted = await DELETE(
      request('DELETE', `/api/notifications/${notification.id}`, { csrf: true }),
      { params: { id: notification.id } }
    );
    expect(deleted.status).toBe(200);

    const missing = await DELETE(
      request('DELETE', '/api/notifications/00000000-0000-0000-0000-000000000000', { csrf: true }),
      { params: { id: '00000000-0000-0000-0000-000000000000' } }
    );
    expect(missing.status).toBe(404);
  });

  it('does not allow clients to create business-event notifications', async () => {
    const missingCsrf = await POST(request('POST', '/api/notifications', {
      body: JSON.stringify({ title: 'No CSRF' }),
    }));
    expect(missingCsrf.status).toBe(403);

    const response = await POST(request('POST', '/api/notifications', {
      csrf: true,
      body: JSON.stringify({
        recipientId: otherRecipientId,
        type: 'application_accepted',
        title: 'Forged event',
        idempotencyKey: 'client-key',
      }),
    }));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    const [created] = await db.select().from(notifications)
      .where(eq(notifications.title, 'Forged event'));
    expect(created).toBeUndefined();
  });
});

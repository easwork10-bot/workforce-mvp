import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/backend/db';
import * as notificationQueries from '@/backend/db/queries/notifications';
import {
  auditLogs,
  notifications,
  profiles,
  shiftApplications,
  shiftAssignments,
  shifts,
} from '@/backend/db/schema';
import { getAuditLogs } from '@/backend/db/queries/audit';
import { reviewApplication } from '@/backend/db/queries/applications';
import { signCsrfToken } from '@/backend/security/csrf';
import { POST as postApplicationReview } from '@/app/api/admin/applications/[id]/review/route';

const auditState = vi.hoisted(() => ({
  failWrites: false,
}));

const authState = vi.hoisted(() => ({
  authenticated: true,
  userId: '',
  role: 'administrator' as 'administrator' | 'supervisor' | 'employee',
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

vi.mock('@/backend/auth/tokens', () => ({
  verifyTokenFromCookie: vi.fn(async () => authState.authenticated
    ? { sub: authState.userId, role: authState.role, jti: 'application-audit-session', ipHash: 'test' }
    : null),
}));

vi.mock('@/backend/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/backend/auth/session')>();
  return {
    ...actual,
    getSession: vi.fn(async () => authState.authenticated
      ? {
          userId: authState.userId,
          role: authState.role,
          ipHash: 'test',
          userAgent: 'test',
          refreshHash: 'test',
        }
      : null),
  };
});

describe('Application review audit integration', () => {
  let reviewerId: string;
  let employeeId: string;
  let shiftId: string;
  let applicationId: string;

  beforeEach(async () => {
    const [reviewer] = await db.insert(profiles).values({
      fullName: 'Application reviewer',
      email: `application-reviewer-${crypto.randomUUID()}@workforce.test`,
      role: 'administrator',
    }).returning();
    const [employee] = await db.insert(profiles).values({
      fullName: 'Application employee',
      email: `application-employee-${crypto.randomUUID()}@workforce.test`,
    }).returning();
    reviewerId = reviewer.id;
    employeeId = employee.id;

    const [shift] = await db.insert(shifts).values({
      title: 'Audited application shift',
      workType: 'cleaning',
      location: 'Amsterdam',
      startAt: new Date('2099-01-01T09:00:00Z'),
      endAt: new Date('2099-01-01T17:00:00Z'),
      requiredWorkers: 1,
      createdBy: reviewerId,
      status: 'open',
    }).returning();
    shiftId = shift.id;

    const [application] = await db.insert(shiftApplications).values({
      shiftId,
      employeeId,
      status: 'pending',
    }).returning();
    applicationId = application.id;

    auditState.failWrites = false;
    authState.authenticated = true;
    authState.userId = reviewerId;
    authState.role = 'administrator';
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    auditState.failWrites = false;
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, [reviewerId, employeeId]));
    await db.delete(notifications).where(eq(notifications.relatedApplicationId, applicationId));
    await db.delete(shiftAssignments).where(eq(shiftAssignments.applicationId, applicationId));
    await db.delete(shiftApplications).where(eq(shiftApplications.id, applicationId));
    await db.delete(shifts).where(eq(shifts.id, shiftId));
    await db.delete(profiles).where(inArray(profiles.id, [reviewerId, employeeId]));
  });

  function makeReviewRequest(
    status: 'accepted' | 'rejected',
    options: { clientIp?: string; csrf?: boolean; body?: string } = {}
  ): NextRequest {
    const csrfToken = signCsrfToken('application-audit-csrf');
    const headers = new Headers({
      cookie: `access_token=valid; csrf_token=${csrfToken}`,
      'content-type': 'application/json',
      'user-agent': 'application-audit-test',
    });
    if (options.csrf !== false) headers.set('x-csrf-token', csrfToken);
    if (options.clientIp) headers.set('x-forwarded-for', options.clientIp);

    return new NextRequest(`http://localhost/api/admin/applications/${applicationId}/review`, {
      method: 'POST',
      headers,
      body: options.body ?? JSON.stringify({ status }),
    });
  }

  function reviewRoute(request: NextRequest, id = applicationId) {
    return postApplicationReview(request, { params: { id } });
  }

  it('records the accepted status transition with authenticated actor and timestamp', async () => {
    const result = await reviewApplication(applicationId, reviewerId, 'accepted');
    const { data, total } = await getAuditLogs({
      actorId: reviewerId,
      entityType: 'shift_applications',
      entityId: applicationId,
    });

    expect(result.success).toBe(true);
    expect(total).toBe(1);
    expect(data[0]).toMatchObject({
      actorId: reviewerId,
      action: 'UPDATE',
      entityType: 'shift_applications',
      entityId: applicationId,
      oldValues: { status: 'pending' },
      newValues: { status: 'accepted' },
    });
    expect(data[0].createdAt).toBeInstanceOf(Date);
    expect(data[0].ipAddress).toBeNull();
    expect(data[0].userAgent).toBeNull();
  });

  it('records rejection without persisting the free-form rejection reason', async () => {
    await reviewApplication(applicationId, reviewerId, 'rejected', 'Contains private information');
    const { data, total } = await getAuditLogs({
      actorId: reviewerId,
      entityType: 'shift_applications',
      entityId: applicationId,
    });

    expect(total).toBe(1);
    expect(data[0].oldValues).toEqual({ status: 'pending' });
    expect(data[0].newValues).toEqual({ status: 'rejected' });
    expect(JSON.stringify(data[0])).not.toContain('Contains private information');
  });

  it('records only one audit event set for the successful decision and its side effects', async () => {
    await reviewApplication(applicationId, reviewerId, 'accepted');
    await reviewApplication(applicationId, employeeId, 'accepted');
    const logs = await getAuditLogs({ actorId: reviewerId, page: 1, limit: 10 });

    expect(logs.total).toBe(3);
    expect(logs.data.map((entry) => entry.entityType).sort()).toEqual([
      'notifications',
      'shift_applications',
      'shift_assignments',
    ]);
  });

  it('stores hashed client IP and user-agent for API decisions', async () => {
    const response = await reviewRoute(makeReviewRequest('rejected', {
      clientIp: '198.51.100.22',
    }));
    const { data, total } = await getAuditLogs({
      actorId: reviewerId,
      entityType: 'shift_applications',
      entityId: applicationId,
    });

    expect(response.status).toBe(200);
    expect(total).toBe(1);
    expect(data[0].ipAddress).toBe(createHash('sha256').update('198.51.100.22').digest('hex').slice(0, 16));
    expect(data[0].userAgent).toBe('application-audit-test');
  });

  it('rolls back the decision, assignment, and notification when audit persistence fails', async () => {
    auditState.failWrites = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await reviewRoute(makeReviewRequest('accepted'));
    const [application] = await db.select().from(shiftApplications).where(eq(shiftApplications.id, applicationId));
    const assignments = await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, applicationId));
    const eventNotifications = await db
      .select()
      .from(notifications)
      .where(eq(notifications.relatedApplicationId, applicationId));
    const { total } = await getAuditLogs({ entityId: applicationId, entityType: 'shift_applications' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Verwerken mislukt' });
    expect(application.status).toBe('pending');
    expect(assignments).toHaveLength(0);
    expect(eventNotifications).toHaveLength(0);
    expect(total).toBe(0);
  });

  it('does not create duplicate audit entries when a completed decision is replayed', async () => {
    const first = await reviewApplication(applicationId, reviewerId, 'accepted');
    const replay = await reviewApplication(applicationId, employeeId, 'accepted');
    const changedOutcome = await reviewApplication(applicationId, reviewerId, 'rejected');
    const { data, total } = await getAuditLogs({
      entityType: 'shift_applications',
      entityId: applicationId,
    });

    expect(first.success).toBe(true);
    expect(replay).toMatchObject({ success: true, replayed: true });
    expect(changedOutcome).toMatchObject({ success: false, conflict: true });
    expect(total).toBe(1);
    expect(data[0].actorId).toBe(reviewerId);
    expect((await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, applicationId))).length).toBe(1);
    expect((await db.select().from(notifications).where(eq(notifications.relatedApplicationId, applicationId))).length).toBe(1);
  });

  it('denies employee review requests without creating an audit entry', async () => {
    authState.userId = employeeId;
    authState.role = 'employee';

    const response = await reviewRoute(makeReviewRequest('accepted'));
    const [application] = await db.select().from(shiftApplications).where(eq(shiftApplications.id, applicationId));
    const { total } = await getAuditLogs({ entityId: applicationId, entityType: 'shift_applications' });

    expect(response.status).toBe(403);
    expect(application.status).toBe('pending');
    expect(total).toBe(0);
  });

  it('accepts applications through the dynamic route and creates one employee notification', async () => {
    const response = await reviewRoute(makeReviewRequest('accepted'));
    const body = await response.json();
    const [notification] = await db.select().from(notifications)
      .where(eq(notifications.relatedApplicationId, applicationId));

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, replayed: false });
    expect(notification).toMatchObject({
      recipientId: employeeId,
      type: 'application_accepted',
      relatedApplicationId: applicationId,
    });
  });

  it('rejects applications through the dynamic route and notifies the applicant', async () => {
    const response = await reviewRoute(makeReviewRequest('rejected'));
    const body = await response.json();
    const [notification] = await db.select().from(notifications)
      .where(eq(notifications.relatedApplicationId, applicationId));

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, replayed: false });
    expect(notification).toMatchObject({
      recipientId: employeeId,
      type: 'application_rejected',
      relatedApplicationId: applicationId,
    });
  });

  it('requires authentication and administrator role on the dynamic review route', async () => {
    authState.authenticated = false;
    const unauthenticated = await reviewRoute(makeReviewRequest('accepted'));
    expect(unauthenticated.status).toBe(401);

    authState.authenticated = true;
    authState.role = 'supervisor';
    const supervisorResponse = await reviewRoute(makeReviewRequest('accepted'));
    expect(supervisorResponse.status).toBe(403);

    authState.role = 'employee';
    const employeeResponse = await reviewRoute(makeReviewRequest('accepted'));
    expect(employeeResponse.status).toBe(403);
  });

  it('requires CSRF before processing an application decision', async () => {
    const response = await reviewRoute(makeReviewRequest('accepted', { csrf: false }));
    expect(response.status).toBe(403);
    expect((await db.select().from(shiftApplications)
      .where(eq(shiftApplications.id, applicationId)))[0].status).toBe('pending');
  });

  it('rejects invalid route IDs, malformed JSON, and invalid review payloads', async () => {
    const invalidIdResponse = await reviewRoute(makeReviewRequest('accepted'), 'not-a-uuid');
    expect(invalidIdResponse.status).toBe(400);

    const malformedJsonResponse = await reviewRoute(makeReviewRequest('accepted', { body: '{' }));
    expect(malformedJsonResponse.status).toBe(400);

    const invalidPayloadResponse = await reviewRoute(makeReviewRequest('accepted', {
      body: JSON.stringify({ status: 'pending' }),
    }));
    expect(invalidPayloadResponse.status).toBe(400);
  });

  it('returns 404 for a well-formed but missing application ID', async () => {
    const missingId = crypto.randomUUID();
    const response = await reviewRoute(makeReviewRequest('accepted'), missingId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Sollicitatie niet gevonden' });
  });

  it('returns replay for a same-outcome retry and conflict for the opposite outcome', async () => {
    const firstResponse = await reviewRoute(makeReviewRequest('accepted'));
    const replayResponse = await reviewRoute(makeReviewRequest('accepted'));
    const conflictResponse = await reviewRoute(makeReviewRequest('rejected'));
    const notificationRows = await db.select().from(notifications)
      .where(eq(notifications.relatedApplicationId, applicationId));
    const assignments = await db.select().from(shiftAssignments)
      .where(eq(shiftAssignments.applicationId, applicationId));
    const audit = await getAuditLogs({ actorId: reviewerId });

    expect(firstResponse.status).toBe(200);
    expect(await replayResponse.json()).toMatchObject({ success: true, replayed: true });
    expect(conflictResponse.status).toBe(409);
    expect(notificationRows).toHaveLength(1);
    expect(assignments).toHaveLength(1);
    expect(audit.total).toBe(3);
  });

  it('rolls back the decision when notification creation fails', async () => {
    vi.spyOn(notificationQueries, 'createNotificationIdempotent')
      .mockRejectedValue(new Error('notification persistence unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await reviewRoute(makeReviewRequest('accepted'));
    const [application] = await db.select().from(shiftApplications)
      .where(eq(shiftApplications.id, applicationId));
    const assignments = await db.select().from(shiftAssignments)
      .where(eq(shiftAssignments.applicationId, applicationId));
    const notificationRows = await db.select().from(notifications)
      .where(eq(notifications.relatedApplicationId, applicationId));
    const audit = await getAuditLogs({ entityId: applicationId });

    expect(response.status).toBe(500);
    expect(application.status).toBe('pending');
    expect(assignments).toHaveLength(0);
    expect(notificationRows).toHaveLength(0);
    expect(audit.total).toBe(0);
  });

  it('preserves shift capacity protection through the HTTP route', async () => {
    const [otherEmployee] = await db.insert(profiles).values({
      fullName: 'Already assigned employee',
      email: `application-capacity-${crypto.randomUUID()}@workforce.test`,
    }).returning();

    await db.insert(shiftAssignments).values({
      shiftId,
      employeeId: otherEmployee.id,
      assignedBy: reviewerId,
      status: 'assigned',
    });

    const response = await reviewRoute(makeReviewRequest('accepted'));
    const [application] = await db.select().from(shiftApplications)
      .where(eq(shiftApplications.id, applicationId));
    const [createdNotification] = await db.select().from(notifications)
      .where(eq(notifications.relatedApplicationId, applicationId));

    expect(response.status).toBe(400);
    expect(application.status).toBe('pending');
    expect(createdNotification).toBeUndefined();

    await db.delete(profiles).where(eq(profiles.id, otherEmployee.id));
  });
});

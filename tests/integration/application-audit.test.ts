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
import { POST as postApplicationCancel } from '@/app/api/employee/applications/[id]/cancel/route';

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
  let otherEmployeeId: string;
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
    const [otherEmployee] = await db.insert(profiles).values({
      fullName: 'Other application employee',
      email: `application-other-employee-${crypto.randomUUID()}@workforce.test`,
    }).returning();
    reviewerId = reviewer.id;
    employeeId = employee.id;
    otherEmployeeId = otherEmployee.id;

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
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, [reviewerId, employeeId, otherEmployeeId]));
    await db.delete(notifications).where(eq(notifications.relatedApplicationId, applicationId));
    await db.delete(shiftAssignments).where(eq(shiftAssignments.applicationId, applicationId));
    await db.delete(shiftApplications).where(eq(shiftApplications.id, applicationId));
    await db.delete(shifts).where(eq(shifts.id, shiftId));
    await db.delete(profiles).where(inArray(profiles.id, [reviewerId, employeeId, otherEmployeeId]));
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

  function makeCancelRequest(options: { csrf?: boolean } = {}, id = applicationId): NextRequest {
    const csrfToken = signCsrfToken('application-cancel-csrf');
    const headers = new Headers({
      cookie: `access_token=valid; csrf_token=${csrfToken}`,
      'user-agent': 'application-cancel-test',
    });
    if (options.csrf !== false) headers.set('x-csrf-token', csrfToken);
    return new NextRequest(`http://localhost/api/employee/applications/${id}/cancel`, {
      method: 'POST',
      headers,
    });
  }

  function cancelRoute(request: NextRequest, id = applicationId) {
    return postApplicationCancel(request, { params: Promise.resolve({ id }) });
  }

  it('lets an employee cancel only their own pending attempt and records the transition', async () => {
    authState.userId = employeeId;
    authState.role = 'employee';

    const response = await cancelRoute(makeCancelRequest());
    const [application] = await db.select().from(shiftApplications)
      .where(eq(shiftApplications.id, applicationId));
    const audit = await getAuditLogs({
      actorId: employeeId,
      entityType: 'shift_applications',
      entityId: applicationId,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      code: 'APPLICATION_CANCELLED',
    });
    expect(application.status).toBe('cancelled');
    expect(audit.total).toBe(1);
    expect(audit.data[0]).toMatchObject({
      oldValues: { status: 'pending' },
      newValues: { status: 'cancelled' },
    });

    const repeated = await cancelRoute(makeCancelRequest());
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toMatchObject({ code: 'APPLICATION_DECISION_CONFLICT' });
    expect((await getAuditLogs({
      actorId: employeeId,
      entityType: 'shift_applications',
      entityId: applicationId,
    })).total).toBe(1);
  });

  it('does not disclose another employee application and rejects terminal cancellation', async () => {
    authState.userId = otherEmployeeId;
    authState.role = 'employee';

    const notOwned = await cancelRoute(makeCancelRequest(), applicationId);
    expect(notOwned.status).toBe(404);
    expect(await notOwned.json()).toMatchObject({ code: 'APPLICATION_NOT_FOUND' });

    authState.userId = employeeId;
    await reviewApplication(applicationId, reviewerId, 'accepted');
    const accepted = await cancelRoute(makeCancelRequest());
    expect(accepted.status).toBe(409);
    expect(await accepted.json()).toMatchObject({ code: 'APPLICATION_DECISION_CONFLICT' });
  });

  it('requires employee authorization and CSRF before cancelling', async () => {
    authState.userId = reviewerId;
    authState.role = 'administrator';
    const forbidden = await cancelRoute(makeCancelRequest());
    expect(forbidden.status).toBe(403);

    authState.userId = employeeId;
    authState.role = 'employee';
    const csrfRejected = await cancelRoute(makeCancelRequest({ csrf: false }));
    expect(csrfRejected.status).toBe(403);
    expect((await db.select().from(shiftApplications)
      .where(eq(shiftApplications.id, applicationId)))[0].status).toBe('pending');
  });

  it('rolls back cancellation when audit persistence fails', async () => {
    authState.userId = employeeId;
    authState.role = 'employee';
    auditState.failWrites = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await cancelRoute(makeCancelRequest());
    const [application] = await db.select().from(shiftApplications)
      .where(eq(shiftApplications.id, applicationId));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(application.status).toBe('pending');
  });

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

    expect(logs.total).toBe(4);
    expect(logs.data.map((entry) => entry.entityType).sort()).toEqual([
      'notifications',
      'shift_applications',
      'shift_assignments',
      'shifts',
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
    expect(await response.json()).toEqual({ error: 'Verwerken mislukt', code: 'INTERNAL_ERROR' });
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('open');
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
    expect(await invalidIdResponse.json()).toMatchObject({ code: 'INVALID_REQUEST' });

    const malformedJsonResponse = await reviewRoute(makeReviewRequest('accepted', { body: '{' }));
    expect(malformedJsonResponse.status).toBe(400);
    expect(await malformedJsonResponse.json()).toMatchObject({ code: 'INVALID_REQUEST' });

    const invalidPayloadResponse = await reviewRoute(makeReviewRequest('accepted', {
      body: JSON.stringify({ status: 'pending' }),
    }));
    expect(invalidPayloadResponse.status).toBe(400);
    expect(await invalidPayloadResponse.json()).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('returns 404 for a well-formed but missing application ID', async () => {
    const missingId = crypto.randomUUID();
    const response = await reviewRoute(makeReviewRequest('accepted'), missingId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Sollicitatie niet gevonden', code: 'APPLICATION_NOT_FOUND' });
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
    expect(audit.total).toBe(4);
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

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CAPACITY_REACHED' });
    expect(application.status).toBe('pending');
    expect(createdNotification).toBeUndefined();

    await db.delete(profiles).where(eq(profiles.id, otherEmployee.id));
  });

  it.each(['draft', 'filled', 'cancelled', 'completed'] as const)(
    'returns SHIFT_UNAVAILABLE for approval on a %s shift, but still allows rejection',
    async (status) => {
      await db.update(shifts).set({ status }).where(eq(shifts.id, shiftId));
      const blocked = await reviewRoute(makeReviewRequest('accepted'));
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toMatchObject({ code: 'SHIFT_UNAVAILABLE' });
      expect(await db.select().from(shiftAssignments)
        .where(eq(shiftAssignments.applicationId, applicationId))).toHaveLength(0);
      const rejected = await reviewRoute(makeReviewRequest('rejected'));
      expect(rejected.status).toBe(200);
      expect(await rejected.json()).toMatchObject({ code: 'APPLICATION_REVIEWED' });
      expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe(status);
    }
  );

  it('returns a controlled conflict for cancelled applications', async () => {
    await db.update(shiftApplications).set({ status: 'cancelled' })
      .where(eq(shiftApplications.id, applicationId));
    const response = await reviewRoute(makeReviewRequest('accepted'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'APPLICATION_DECISION_CONFLICT' });
    expect(await db.select().from(shiftAssignments)
      .where(eq(shiftAssignments.applicationId, applicationId))).toHaveLength(0);
  });

  it('returns ACTIVE_ASSIGNMENT_EXISTS without changing a pending application', async () => {
    await db.update(shifts).set({ requiredWorkers: 2 }).where(eq(shifts.id, shiftId));
    await db.insert(shiftAssignments).values({
      shiftId, employeeId, assignedBy: reviewerId, status: 'assigned',
    });
    const response = await reviewRoute(makeReviewRequest('accepted'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'ACTIVE_ASSIGNMENT_EXISTS' });
    expect((await db.select().from(shiftApplications)
      .where(eq(shiftApplications.id, applicationId)))[0].status).toBe('pending');
    await db.delete(shiftAssignments).where(eq(shiftAssignments.shiftId, shiftId));
  });

  it('rolls back all approval changes if notification persistence fails after filling the shift', async () => {
    vi.spyOn(notificationQueries, 'createNotificationIdempotent')
      .mockRejectedValueOnce(new Error('Synthetic notification failure'));
    const response = await reviewRoute(makeReviewRequest('accepted'));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('open');
    expect((await db.select().from(shiftApplications)
      .where(eq(shiftApplications.id, applicationId)))[0].status).toBe('pending');
    expect(await db.select().from(shiftAssignments)
      .where(eq(shiftAssignments.applicationId, applicationId))).toHaveLength(0);
    expect(await db.select().from(notifications)
      .where(eq(notifications.relatedApplicationId, applicationId))).toHaveLength(0);
    expect((await getAuditLogs({ actorId: reviewerId })).total).toBe(0);
  });

  it('rolls back previously written effects if the final application audit fails', async () => {
    vi.spyOn(await import('@/backend/db/queries/audit'), 'logAuditEvent').mockImplementation(
      async (...args) => {
        if (args[0].entityType === 'shift_applications') throw new Error('Final audit failure');
        const actual = await vi.importActual<typeof import('@/backend/db/queries/audit')>(
          '@/backend/db/queries/audit'
        );
        return actual.logAuditEvent(...args);
      }
    );
    const response = await reviewRoute(makeReviewRequest('accepted'));
    expect(response.status).toBe(500);
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('open');
    expect((await db.select().from(shiftApplications)
      .where(eq(shiftApplications.id, applicationId)))[0].status).toBe('pending');
    expect(await db.select().from(shiftAssignments)
      .where(eq(shiftAssignments.applicationId, applicationId))).toHaveLength(0);
    expect(await db.select().from(notifications)
      .where(eq(notifications.relatedApplicationId, applicationId))).toHaveLength(0);
    expect((await getAuditLogs({ actorId: reviewerId })).total).toBe(0);
  });
});

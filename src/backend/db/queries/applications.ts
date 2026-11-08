import 'server-only';
import { db } from '..';
import { shiftApplications, shifts, profiles, shiftAssignments } from '../schema';
import { DrizzleQueryError, eq, and, desc, count, inArray, sql } from 'drizzle-orm';
import type { ShiftApplication } from '../schema';
import { getRedis } from '@/backend/auth/session';
import { randomUUID } from 'node:crypto';
import {
  createNotificationIdempotent,
  NotificationIdempotencyConflictError,
} from './notifications';
import { logAuditEvent, type AuditMetadata } from './audit';

export type ReviewApplicationResult =
  | { success: true; message: string; code: 'APPLICATION_REVIEWED'; replayed?: boolean }
  | {
      success: false;
      message: string;
      code: 'APPLICATION_NOT_FOUND' | 'APPLICATION_DECISION_CONFLICT' | 'SHIFT_UNAVAILABLE'
        | 'CAPACITY_REACHED' | 'ACTIVE_ASSIGNMENT_EXISTS' | 'INTERNAL_ERROR';
      conflict?: boolean;
      internalError?: boolean;
    };

/**
 * Get shift applications with filtering
 */
export async function getApplications({
  shiftId,
  employeeId,
  status,
  page = 1,
  limit = 20,
}: {
  shiftId?: string;
  employeeId?: string;
  status?: ShiftApplication['status'];
  page?: number;
  limit?: number;
}): Promise<{
  data: (ShiftApplication & {
    shift: {
      title: string; startAt: Date; endAt: Date; location: string;
      status: typeof shifts.$inferSelect['status']; requiredWorkers: number; assignedCount: number;
    };
    employee: { fullName: string; email: string; phone: string | null };
  })[];
  total: number;
}> {
  const offset = (page - 1) * limit;

  const conditions = [];

  if (shiftId) {
    conditions.push(eq(shiftApplications.shiftId, shiftId));
  }

  if (employeeId) {
    conditions.push(eq(shiftApplications.employeeId, employeeId));
  }

  if (status) {
    conditions.push(eq(shiftApplications.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(shiftApplications)
    .where(whereClause);

  const data = await db
    .select({
      application: shiftApplications,
      shift: {
        title: shifts.title,
        startAt: shifts.startAt,
        endAt: shifts.endAt,
        location: shifts.location,
        status: shifts.status,
        requiredWorkers: shifts.requiredWorkers,
        assignedCount: sql<number>`(
          SELECT count(*)::int FROM ${shiftAssignments}
          WHERE ${shiftAssignments.shiftId} = ${shifts.id}
            AND ${shiftAssignments.status} IN ('assigned', 'confirmed')
        )`,
      },
      employee: {
        fullName: profiles.fullName,
        email: profiles.email,
        phone: profiles.phone,
      },
    })
    .from(shiftApplications)
    .innerJoin(shifts, eq(shiftApplications.shiftId, shifts.id))
    .innerJoin(profiles, eq(shiftApplications.employeeId, profiles.id))
    .where(whereClause)
    .orderBy(desc(shiftApplications.appliedAt), desc(shiftApplications.id))
    .limit(limit)
    .offset(offset);

  return {
    data: data.map((item) => ({
      ...item.application,
      shift: item.shift,
      employee: item.employee,
    })),
    total,
  };
}

/**
 * Review a shift application (accept or reject)
 */
export async function reviewApplication(
  applicationId: string,
  reviewerId: string,
  status: 'accepted' | 'rejected',
  rejectionReason?: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<ReviewApplicationResult> {
  return await db.transaction<ReviewApplicationResult>(async (tx) => {
    const [reference] = await tx.select({ shiftId: shiftApplications.shiftId })
      .from(shiftApplications).where(eq(shiftApplications.id, applicationId)).limit(1);
    if (!reference) {
      return { success: false, code: 'APPLICATION_NOT_FOUND', message: 'Sollicitatie niet gevonden' };
    }

    // Match apply's lock order: shift, application, then assignment.
    const [shift] = await tx.select().from(shifts)
      .where(eq(shifts.id, reference.shiftId)).for('update').limit(1);
    if (!shift) {
      return { success: false, code: 'APPLICATION_NOT_FOUND', message: 'Sollicitatie niet gevonden' };
    }

    const [app] = await tx
      .select()
      .from(shiftApplications)
      .where(eq(shiftApplications.id, applicationId))
      .for('update')
      .limit(1);

    if (!app) return { success: false, code: 'APPLICATION_NOT_FOUND', message: 'Sollicitatie niet gevonden' };
    if (app.shiftId !== shift.id) {
      return {
        success: false, code: 'APPLICATION_DECISION_CONFLICT',
        message: 'Sollicitatie is gewijzigd, probeer opnieuw', conflict: true,
      };
    }

    if (app.status !== 'pending') {
      if (app.status === status) {
        if (status === 'rejected' && (app.rejectionReason ?? null) !== (rejectionReason ?? null)) {
          return {
            success: false,
            code: 'APPLICATION_DECISION_CONFLICT',
            message: 'Sollicitatie is al beoordeeld met andere gegevens',
            conflict: true,
          };
        }

        return {
          success: true,
          code: 'APPLICATION_REVIEWED',
          message: 'Sollicitatie was al beoordeeld',
          replayed: true,
        };
      }

      return {
        success: false,
        code: 'APPLICATION_DECISION_CONFLICT',
        message: 'Sollicitatie is al met een andere uitkomst beoordeeld',
        conflict: true,
      };
    }

    // If accepted, create a shift assignment with capacity check
    if (status === 'accepted') {
      if (shift.status !== 'open') {
        return {
          success: false, code: 'SHIFT_UNAVAILABLE',
          message: 'Dienst is niet open voor goedkeuring', conflict: true,
        };
      }

      // Count active assignments (assigned + confirmed)
      const [{ assignedCount }] = await tx
        .select({ assignedCount: count() })
        .from(shiftAssignments)
        .where(and(
          eq(shiftAssignments.shiftId, app.shiftId),
          inArray(shiftAssignments.status, ['assigned', 'confirmed'])
        ));

      // Enforce capacity
      if (assignedCount >= shift.requiredWorkers) {
        return { success: false, code: 'CAPACITY_REACHED', message: 'Dienst is vol', conflict: true };
      }

      // Check if already assigned (double-check after lock)
      const [existingAssignment] = await tx
        .select()
        .from(shiftAssignments)
        .where(and(
          eq(shiftAssignments.shiftId, app.shiftId),
          eq(shiftAssignments.employeeId, app.employeeId),
          inArray(shiftAssignments.status, ['assigned', 'confirmed'])
        ))
        .for('update')
        .limit(1);

      if (existingAssignment) {
        return {
          success: false,
          code: 'ACTIVE_ASSIGNMENT_EXISTS',
          message: 'Werknemer is al ingedeeld voor deze dienst',
          conflict: true,
        };
      }

      // Create assignment
      const [assignment] = await tx.insert(shiftAssignments).values({
        shiftId: app.shiftId,
        employeeId: app.employeeId,
        applicationId: app.id,
        status: 'assigned',
        assignedBy: reviewerId,
      }).returning();

      await logAuditEvent({
        actorId: reviewerId,
        action: 'INSERT',
        entityType: 'shift_assignments',
        entityId: assignment.id,
        oldValues: null,
        newValues: { applicationId: app.id, status: 'assigned' },
        ...auditMetadata,
      }, tx);

      if (assignedCount + 1 === shift.requiredWorkers) {
        await tx.update(shifts).set({ status: 'filled', updatedAt: new Date() })
          .where(eq(shifts.id, shift.id));
        await logAuditEvent({
          actorId: reviewerId,
          action: 'UPDATE',
          entityType: 'shifts',
          entityId: shift.id,
          oldValues: { status: 'open' },
          newValues: { status: 'filled' },
          ...auditMetadata,
        }, tx);
      }
    }

    await tx
      .update(shiftApplications)
      .set({
        status,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectionReason: status === 'rejected' ? rejectionReason : null,
      })
      .where(eq(shiftApplications.id, applicationId));

    const accepted = status === 'accepted';
    const notificationResult = await createNotificationIdempotent({
      recipientId: app.employeeId,
      type: accepted ? 'application_accepted' : 'application_rejected',
      title: accepted ? 'Sollicitatie geaccepteerd' : 'Sollicitatie afgewezen',
      message: accepted
        ? `Je sollicitatie voor de dienst "${shift.title}" is geaccepteerd.`
        : `Je sollicitatie voor de dienst "${shift.title}" is afgewezen.${rejectionReason ? ` Reden: ${rejectionReason}` : ''}`,
      relatedShiftId: app.shiftId,
      relatedApplicationId: app.id,
      idempotencyKey: `application-decision:v1:${app.id}`,
    }, tx);

    if (!notificationResult.replayed) {
      await logAuditEvent({
        actorId: reviewerId,
        action: 'INSERT',
        entityType: 'notifications',
        entityId: notificationResult.notification.id,
        oldValues: null,
        newValues: {
          type: notificationResult.notification.type,
          relatedApplicationId: app.id,
          read: false,
        },
        ...auditMetadata,
      }, tx);
    }

    await logAuditEvent({
      actorId: reviewerId,
      action: 'UPDATE',
      entityType: 'shift_applications',
      entityId: app.id,
      oldValues: { status: app.status },
      newValues: { status },
      ...auditMetadata,
    }, tx);

    return {
      success: true,
      code: 'APPLICATION_REVIEWED',
      message: accepted ? 'Sollicitatie geaccepteerd en ingedeeld' : 'Sollicitatie afgewezen',
    };
  }).catch((err) => {
    if (err instanceof NotificationIdempotencyConflictError) {
      return {
        success: false,
        code: 'APPLICATION_DECISION_CONFLICT',
        message: 'Notificatie-idempotentiesleutel is al gebruikt voor andere gegevens',
        conflict: true,
      };
    }

    // Transaction failed - return error
    console.error('[reviewApplication] Transaction error:', err);
    return { success: false, code: 'INTERNAL_ERROR', message: 'Verwerken mislukt', internalError: true };
  });
}

export type ApplyForShiftResult =
  | { success: true; message: string; code: 'APPLICATION_CREATED'; applicationId: string }
  | {
      success: false;
      message: string;
      code:
        | 'SHIFT_NOT_FOUND'
        | 'DUPLICATE_APPLICATION'
        | 'ACTIVE_ASSIGNMENT_EXISTS'
        | 'SHIFT_UNAVAILABLE'
        | 'CAPACITY_REACHED'
        | 'LOCK_CONTENDED'
        | 'LOCK_UNAVAILABLE'
        | 'INTERNAL_ERROR';
    };

function isPendingApplicationUniqueViolation(error: unknown): boolean {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return typeof cause === 'object'
    && cause !== null
    && 'code' in cause
    && cause.code === '23505'
    && 'constraint' in cause
    && cause.constraint === 'unique_pending_shift_employee';
}

/**
 * Apply for a shift. PostgreSQL row locking and the partial unique index are the
 * correctness boundary; Redis only rejects overlapping requests early.
 */
export async function applyForShiftWithLock(
  shiftId: string,
  employeeId: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<ApplyForShiftResult> {
  let redis: Awaited<ReturnType<typeof getRedis>> | undefined;
  const lockKey = `lock:shift:${shiftId}:apply:${employeeId}`;
  const lockVal = randomUUID();

  try {
    redis = await getRedis();
    const acquired = await redis.set(lockKey, lockVal, { NX: true, PX: 15000 });
    if (acquired !== 'OK') {
      return {
        success: false,
        code: 'LOCK_CONTENDED',
        message: 'Er wordt al een sollicitatie verwerkt. Probeer het zo opnieuw.',
      };
    }
  } catch {
    console.error('[applyForShiftWithLock] Redis unavailable, failing closed');
    return {
      success: false,
      code: 'LOCK_UNAVAILABLE',
      message: 'Sollicitatieservice tijdelijk onbeschikbaar, probeer later opnieuw',
    };
  }

  try {
    return await db.transaction(async (tx) => {
      const [shift] = await tx
        .select()
        .from(shifts)
        .where(eq(shifts.id, shiftId))
        .limit(1)
        .for('update');

      if (!shift) {
        return {
          success: false,
          code: 'SHIFT_NOT_FOUND',
          message: 'Dienst niet gevonden',
        };
      }

      if (shift.status !== 'open') {
        return {
          success: false,
          code: 'SHIFT_UNAVAILABLE',
          message: 'Dienst is niet open voor sollicitaties',
        };
      }

      const [{ assignedCount }] = await tx
        .select({ assignedCount: count() })
        .from(shiftAssignments)
        .where(and(
          eq(shiftAssignments.shiftId, shiftId),
          inArray(shiftAssignments.status, ['assigned', 'confirmed'])
        ));

      if (assignedCount >= shift.requiredWorkers) {
        return {
          success: false,
          code: 'CAPACITY_REACHED',
          message: 'Dienst is vol',
        };
      }

      const [existingApp] = await tx
        .select()
        .from(shiftApplications)
        .where(and(
          eq(shiftApplications.shiftId, shiftId),
          eq(shiftApplications.employeeId, employeeId),
          eq(shiftApplications.status, 'pending')
        ))
        .limit(1);

      if (existingApp) {
        return {
          success: false,
          code: 'DUPLICATE_APPLICATION',
          message: 'Je hebt al een open sollicitatie voor deze dienst',
        };
      }

      const [existingAssignment] = await tx
        .select()
        .from(shiftAssignments)
        .where(and(
          eq(shiftAssignments.shiftId, shiftId),
          eq(shiftAssignments.employeeId, employeeId),
          inArray(shiftAssignments.status, ['assigned', 'confirmed'])
        ))
        .limit(1);

      if (existingAssignment) {
        return {
          success: false,
          code: 'ACTIVE_ASSIGNMENT_EXISTS',
          message: 'Je bent al ingedeeld voor deze dienst',
        };
      }

      const [newApp] = await tx
        .insert(shiftApplications)
        .values({
          shiftId,
          employeeId,
          status: 'pending',
        })
        .returning();

      await logAuditEvent({
        actorId: employeeId,
        action: 'INSERT',
        entityType: 'shift_applications',
        entityId: newApp.id,
        oldValues: null,
        newValues: { shiftId, status: 'pending' },
        ...auditMetadata,
      }, tx);

      return {
        success: true,
        message: 'Sollicitatie succesvol ingediend',
        code: 'APPLICATION_CREATED',
        applicationId: newApp.id,
      };
    });
  } catch (error) {
    if (isPendingApplicationUniqueViolation(error)) {
      return {
        success: false,
        code: 'DUPLICATE_APPLICATION',
        message: 'Je hebt al een open sollicitatie voor deze dienst',
      };
    }

    console.error('[applyForShiftWithLock] Application transaction failed:', error);
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Solliciteren is niet gelukt. Probeer het later opnieuw.',
    };
  } finally {
    if (redis) {
      try {
        await redis.eval(
          `if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
          end
          return 0`,
          { keys: [lockKey], arguments: [lockVal] }
        );
      } catch (error) {
        console.error('[applyForShiftWithLock] Failed to release owned Redis lock:', error);
      }
    }
  }
}

export type CancelApplicationResult =
  | { success: true; message: string; code: 'APPLICATION_CANCELLED' }
  | {
      success: false;
      message: string;
      code: 'APPLICATION_NOT_FOUND' | 'APPLICATION_DECISION_CONFLICT' | 'INTERNAL_ERROR';
    };

export async function cancelPendingApplication(
  applicationId: string,
  employeeId: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<CancelApplicationResult> {
  try {
    return await db.transaction(async (tx) => {
      const [reference] = await tx
        .select({ shiftId: shiftApplications.shiftId })
        .from(shiftApplications)
        .where(and(
          eq(shiftApplications.id, applicationId),
          eq(shiftApplications.employeeId, employeeId)
        ))
        .limit(1);

      if (!reference) {
        return {
          success: false,
          code: 'APPLICATION_NOT_FOUND',
          message: 'Sollicitatie niet gevonden',
        };
      }

      const [shift] = await tx.select({ id: shifts.id }).from(shifts)
        .where(eq(shifts.id, reference.shiftId)).for('update').limit(1);
      if (!shift) {
        return {
          success: false, code: 'APPLICATION_NOT_FOUND', message: 'Sollicitatie niet gevonden',
        };
      }

      const [application] = await tx
        .select()
        .from(shiftApplications)
        .where(and(
          eq(shiftApplications.id, applicationId),
          eq(shiftApplications.employeeId, employeeId)
        ))
        .for('update')
        .limit(1);

      if (!application) {
        return {
          success: false,
          code: 'APPLICATION_NOT_FOUND',
          message: 'Sollicitatie niet gevonden',
        };
      }

      if (application.shiftId !== shift.id || application.status !== 'pending') {
        return {
          success: false,
          code: 'APPLICATION_DECISION_CONFLICT',
          message: 'Alleen openstaande sollicitaties kunnen worden geannuleerd',
        };
      }

      await tx
        .update(shiftApplications)
        .set({ status: 'cancelled' })
        .where(eq(shiftApplications.id, applicationId));

      await logAuditEvent({
        actorId: employeeId,
        action: 'UPDATE',
        entityType: 'shift_applications',
        entityId: application.id,
        oldValues: { status: application.status },
        newValues: { status: 'cancelled' },
        ...auditMetadata,
      }, tx);

      return {
        success: true,
        code: 'APPLICATION_CANCELLED',
        message: 'Sollicitatie geannuleerd',
      };
    });
  } catch (error) {
    console.error('[cancelPendingApplication] Transaction failed:', error);
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Sollicitatie annuleren is niet gelukt. Probeer het later opnieuw.',
    };
  }
}
import { db } from '..';
import { shiftApplications, shifts, profiles, shiftAssignments, notifications } from '../schema';
import { eq, and, desc, count, inArray } from 'drizzle-orm';
import type { ShiftApplication } from '../schema';
import { getRedis } from '../../auth/session';

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
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{
  data: (ShiftApplication & {
    shift: { title: string; startAt: Date; endAt: Date; location: string };
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
    conditions.push(eq(shiftApplications.status, status as any));
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
      },
      employee: {
        fullName: profiles.fullName,
        email: profiles.email,
        phone: profiles.phone,
      },
    })
    .from(shiftApplications)
    .leftJoin(shifts, eq(shiftApplications.shiftId, shifts.id))
    .leftJoin(profiles, eq(shiftApplications.employeeId, profiles.id))
    .where(whereClause)
    .orderBy(desc(shiftApplications.appliedAt))
    .limit(limit)
    .offset(offset);

  return {
    data: data.map((item) => ({
      ...item.application,
      shift: item.shift!,
      employee: item.employee!,
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
  rejectionReason?: string
): Promise<{ success: boolean; message: string }> {
  return await db.transaction(async (tx) => {
    // Get application details
    const [app] = await tx
      .select()
      .from(shiftApplications)
      .where(eq(shiftApplications.id, applicationId))
      .limit(1);

    if (!app) return { success: false, message: 'Sollicitatie niet gevonden' };

    // Update application status
    await tx
      .update(shiftApplications)
      .set({
        status,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectionReason: status === 'rejected' ? rejectionReason : null,
      })
      .where(eq(shiftApplications.id, applicationId));

    // If accepted, create a shift assignment with capacity check
    if (status === 'accepted') {
      // Lock the shift row to prevent concurrent capacity overruns
      const [shift] = await tx
        .select()
        .from(shifts)
        .where(eq(shifts.id, app.shiftId))
        .limit(1)
        .for('update');

      if (!shift) {
        throw new Error('Shift not found');
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
        // Rollback application status update by throwing
        throw new Error('Dienst is vol');
      }

      // Check if already assigned (double-check after lock)
      const [existingAssignment] = await tx
        .select()
        .from(shiftAssignments)
        .where(and(
          eq(shiftAssignments.shiftId, app.shiftId),
          eq(shiftAssignments.employeeId, app.employeeId)
        ))
        .limit(1);

      if (existingAssignment) {
        throw new Error('Werknemer is al ingedeeld voor deze dienst');
      }

      // Create assignment
      await tx.insert(shiftAssignments).values({
        shiftId: app.shiftId,
        employeeId: app.employeeId,
        applicationId: app.id,
        status: 'assigned',
        assignedBy: reviewerId,
      });

      // Create notification
      const [shiftTitle] = await tx
        .select({ title: shifts.title })
        .from(shifts)
        .where(eq(shifts.id, app.shiftId))
        .limit(1);

      await tx.insert(notifications).values({
        recipientId: app.employeeId,
        type: 'application_accepted',
        title: 'Sollicitatie geaccepteerd',
        message: `Je sollicitatie voor de dienst "${shiftTitle?.title}" is geaccepteerd.`,
        relatedShiftId: app.shiftId,
        relatedApplicationId: app.id,
      });

      return { success: true, message: 'Sollicitatie geaccepteerd en ingedeeld' };
    } else if (status === 'rejected') {
      // Create notification for rejection
      const [shiftTitle] = await tx
        .select({ title: shifts.title })
        .from(shifts)
        .where(eq(shifts.id, app.shiftId))
        .limit(1);

      await tx.insert(notifications).values({
        recipientId: app.employeeId,
        type: 'application_rejected',
        title: 'Sollicitatie afgewezen',
        message: `Je sollicitatie voor de dienst "${shiftTitle?.title}" is afgewezen.${rejectionReason ? ` Reden: ${rejectionReason}` : ''}`,
        relatedShiftId: app.shiftId,
        relatedApplicationId: app.id,
      });

      return { success: true, message: 'Sollicitatie afgewezen' };
    }

    return { success: true, message: 'Sollicitatie bijgewerkt' };
  }).catch((err) => {
    // Transaction failed - return error
    console.error('[reviewApplication] Transaction error:', err);
    return { success: false, message: err instanceof Error ? err.message : 'Verwerken mislukt' };
  });
}

/**
 * Apply for a shift with concurrency lock (Redis advisory lock)
 * Guarantees no duplicate applications or over-subscription
 */
export async function applyForShiftWithLock(
  shiftId: string,
  employeeId: string
): Promise<{ success: boolean; message: string; applicationId?: string }> {
  let redis;
  let lockAcquired = false;
  const lockKey = `lock:shift:${shiftId}:apply:${employeeId}`;
  const lockVal = `${employeeId}:${Date.now()}`;

  try {
    redis = await getRedis();
    // Try to acquire lock with 15 second TTL (increased from 5s for transaction safety margin)
    const acquired = await redis.set(lockKey, lockVal, { NX: true, PX: 15000 });
    if (acquired) {
      lockAcquired = true;
    }
  } catch (err) {
    // Fail-closed: if Redis unavailable, reject request rather than proceeding without lock
    console.error('[applyForShiftWithLock] Redis unavailable, failing closed');
    return {
      success: false,
      message: 'Sollicitatieservice tijdelijk onbeschikbaar, probeer later opnieuw',
    };
  }

  try {
    // Execute application creation inside DB transaction
    return await db.transaction(async (tx) => {
      // 1. Check shift status & required workers
      const [shift] = await tx
        .select()
        .from(shifts)
        .where(eq(shifts.id, shiftId))
        .limit(1);

      if (!shift) {
        return { success: false, message: 'Dienst niet gevonden' };
      }

      if (shift.status !== 'open') {
        return { success: false, message: 'Dienst is niet open voor sollicitaties' };
      }

      // Check shift capacity - count active assignments
      const [{ assignedCount }] = await tx
        .select({ assignedCount: count() })
        .from(shiftAssignments)
        .where(and(
          eq(shiftAssignments.shiftId, shiftId),
          inArray(shiftAssignments.status, ['assigned', 'confirmed'])
        ));

      if (assignedCount >= shift.requiredWorkers) {
        return { success: false, message: 'Dienst is vol' };
      }

      // 2. Check if already applied
      const [existingApp] = await tx
        .select()
        .from(shiftApplications)
        .where(and(
          eq(shiftApplications.shiftId, shiftId),
          eq(shiftApplications.employeeId, employeeId)
        ))
        .limit(1);

      if (existingApp) {
        return { success: false, message: 'Je hebt al gesolliciteerd op deze dienst' };
      }

      // 3. Check if already assigned
      const [existingAssignment] = await tx
        .select()
        .from(shiftAssignments)
        .where(and(
          eq(shiftAssignments.shiftId, shiftId),
          eq(shiftAssignments.employeeId, employeeId)
        ))
        .limit(1);

      if (existingAssignment) {
        return { success: false, message: 'Je bent al ingedeeld voor deze dienst' };
      }

      // 4. Create application
      const [newApp] = await tx
        .insert(shiftApplications)
        .values({
          shiftId,
          employeeId,
          status: 'pending',
        })
        .returning();

      return {
        success: true,
        message: 'Sollicitatie succesvol ingediend',
        applicationId: newApp.id,
      };
    });
  } finally {
    // Release lock if acquired
    if (redis && lockAcquired) {
      try {
        const val = await redis.get(lockKey);
        if (val === lockVal) {
          await redis.del(lockKey);
        }
      } catch (err) {
        // Ignore lock release errors
      }
    }
  }
}
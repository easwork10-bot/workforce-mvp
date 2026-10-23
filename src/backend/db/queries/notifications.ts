import 'server-only';
import { createHash } from 'node:crypto';
import { db } from '..';
import { notifications } from '../schema';
import { eq, and, desc, count, isNull, isNotNull, sql } from 'drizzle-orm';
import type { Notification, NewNotification } from '../schema';
import { logAuditEvent, type AuditMetadata } from './audit';

type NotificationExecutor = Pick<typeof db, 'insert' | 'select'>;

export type IdempotentNotificationResult = {
  notification: Notification;
  replayed: boolean;
};

export class NotificationIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used with a different notification payload');
    this.name = 'NotificationIdempotencyConflictError';
  }
}

export async function deleteNotificationForRecipient(
  id: string,
  recipientId: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [notification] = await tx
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.id, id),
        eq(notifications.recipientId, recipientId)
      ))
      .for('update')
      .limit(1);
    if (!notification) return false;

    await tx.delete(notifications).where(eq(notifications.id, id));
    await logAuditEvent({
      actorId: recipientId,
      action: 'DELETE',
      entityType: 'notifications',
      entityId: notification.id,
      oldValues: { type: notification.type, read: notification.readAt !== null },
      newValues: null,
      ...auditMetadata,
    }, tx);
    return true;
  });
}

type IdempotentNotificationInput = Omit<NewNotification, 'idempotencyKey' | 'idempotencyPayloadHash'> & {
  idempotencyKey: string;
};
type LegacyNotificationInput = Omit<NewNotification, 'idempotencyKey' | 'idempotencyPayloadHash'>;

function hashNotificationPayload(input: IdempotentNotificationInput): string {
  const payload = {
    recipientId: input.recipientId,
    type: input.type,
    title: input.title,
    message: input.message ?? null,
    relatedShiftId: input.relatedShiftId ?? null,
    relatedApplicationId: input.relatedApplicationId ?? null,
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Get notifications with filtering
 */
export async function getNotifications({
  recipientId,
  type,
  isRead = false,
  page = 1,
  limit = 20,
}: {
  recipientId?: string;
  type?: Notification['type'];
  isRead?: boolean | null;
  page?: number;
  limit?: number;
}): Promise<{ data: Notification[]; total: number }> {
  const offset = (page - 1) * limit;

  const conditions = [];

  if (recipientId) {
    conditions.push(eq(notifications.recipientId, recipientId));
  }

  if (type) {
    conditions.push(eq(notifications.type, type));
  }

  if (isRead !== null) {
    conditions.push(isRead
      ? isNotNull(notifications.readAt)
      : isNull(notifications.readAt));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(notifications)
    .where(whereClause);

  const data = await db
    .select()
    .from(notifications)
    .where(whereClause)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit)
    .offset(offset);

  return { data, total };
}

/**
 * Mark notification as read
 */
export async function markNotificationRead(
  id: string,
  actorId: string,
  auditMetadata?: AuditMetadata
): Promise<boolean> {
  return markNotificationReadForRecipient(id, actorId, auditMetadata);
}

export async function markNotificationReadForRecipient(
  id: string,
  recipientId: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [notification] = await tx
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.id, id),
        eq(notifications.recipientId, recipientId)
      ))
      .for('update')
      .limit(1);
    if (!notification) return false;
    if (notification.readAt) return true;

    const readAt = new Date();
    await tx
      .update(notifications)
      .set({ readAt })
      .where(eq(notifications.id, id));
    await logAuditEvent({
      actorId: recipientId,
      action: 'UPDATE',
      entityType: 'notifications',
      entityId: notification.id,
      oldValues: { read: false },
      newValues: { read: true },
      ...auditMetadata,
    }, tx);
    return true;
  });
}

/**
 * Delete notification
 */
export async function deleteNotification(
  id: string,
  actorId: string,
  auditMetadata?: AuditMetadata
): Promise<boolean> {
  return deleteNotificationForRecipient(id, actorId, auditMetadata);
}

/**
 * Create a new notification
 * Only intended for trusted server-side workflows (application review, shift reminders, admin actions)
 */
export async function createNotification(
  input: LegacyNotificationInput,
  actorId: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<Notification> {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(notifications)
      .values(input)
      .returning();
    await logAuditEvent({
      actorId,
      action: 'INSERT',
      entityType: 'notifications',
      entityId: created.id,
      oldValues: null,
      newValues: {
        type: created.type,
        relatedShiftId: created.relatedShiftId,
        relatedApplicationId: created.relatedApplicationId,
      },
      ...auditMetadata,
    }, tx);
    return created;
  });
}

/** Create or replay a notification by a stable, recipient-scoped event key. */
export async function createNotificationIdempotent(
  input: IdempotentNotificationInput,
  executor: NotificationExecutor = db
): Promise<IdempotentNotificationResult> {
  if (!input.idempotencyKey.trim()) {
    throw new Error('Idempotency key must not be empty');
  }

  const payloadHash = hashNotificationPayload(input);
  const [created] = await executor
    .insert(notifications)
    .values({
      ...input,
      idempotencyPayloadHash: payloadHash,
    })
    .onConflictDoNothing({
      target: [notifications.recipientId, notifications.idempotencyKey],
      where: sql`${notifications.idempotencyKey} IS NOT NULL`,
    })
    .returning();

  if (created) {
    return { notification: created, replayed: false };
  }

  const [existing] = await executor
    .select()
    .from(notifications)
    .where(and(
      eq(notifications.recipientId, input.recipientId),
      eq(notifications.idempotencyKey, input.idempotencyKey)
    ))
    .limit(1);

  if (!existing) {
    throw new Error('Notification insert conflicted but no matching event was found');
  }

  if (existing.idempotencyPayloadHash !== payloadHash) {
    throw new NotificationIdempotencyConflictError();
  }

  return { notification: existing, replayed: true };
}

/**
 * Get unread notification count for a recipient
 */
export async function getUnreadCount(recipientId: string): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(notifications)
    .where(and(
      eq(notifications.recipientId, recipientId),
      isNull(notifications.readAt)
    ));
  return total;
}

/**
 * Mark all notifications as read for a recipient
 */
export async function markAllNotificationsRead(
  recipientId: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<number> {
  return db.transaction(async (tx) => {
    const unread = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt)
      ))
      .for('update');
    if (unread.length === 0) return 0;

    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt)
      ));
    for (const notification of unread) {
      await logAuditEvent({
        actorId: recipientId,
        action: 'UPDATE',
        entityType: 'notifications',
        entityId: notification.id,
        oldValues: { read: false },
        newValues: { read: true },
        ...auditMetadata,
      }, tx);
    }
    return unread.length;
  });
}
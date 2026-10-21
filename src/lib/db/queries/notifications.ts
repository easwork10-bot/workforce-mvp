import { db, pool } from '..';
import { notifications } from '../schema';
import { eq, and, desc, count, isNull, isNotNull } from 'drizzle-orm';
import type { Notification, NewNotification } from '../schema';

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
  type?: string;
  isRead?: boolean;
  page?: number;
  limit?: number;
}): Promise<{ data: Notification[]; total: number }> {
  const offset = (page - 1) * limit;

  const conditions = [];

  if (recipientId) {
    conditions.push(eq(notifications.recipientId, recipientId));
  }

  if (type) {
    conditions.push(eq(notifications.type, type as any));
  }

  if (isRead) {
    conditions.push(isNotNull(notifications.readAt));
  } else {
    conditions.push(isNull(notifications.readAt));
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
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  return { data, total };
}

/**
 * Mark notification as read
 */
export async function markNotificationRead(id: string): Promise<boolean> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(eq(notifications.id, id));

  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete notification
 */
export async function deleteNotification(id: string): Promise<boolean> {
  const result = await db.delete(notifications).where(eq(notifications.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Create a new notification
 * Only intended for trusted server-side workflows (application review, shift reminders, admin actions)
 */
export async function createNotification(input: NewNotification): Promise<Notification> {
  const [created] = await db
    .insert(notifications)
    .values(input)
    .returning();
  return created;
}

/**
 * Create a notification with database-enforced idempotency
 * Uses PostgreSQL ON CONFLICT DO NOTHING with partial unique indexes
 * to atomically insert or return existing row
 * Guarantees exactly-one per (recipientId, type, relatedShiftId) or (recipientId, type, relatedApplicationId)
 */
export async function createNotificationIdempotent(input: NewNotification): Promise<Notification> {
  // Use raw SQL with ON CONFLICT for partial unique indexes
  if (input.relatedShiftId) {
    const query = `
      INSERT INTO notifications (id, recipient_id, type, title, message, related_shift_id, related_application_id, read_at, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (recipient_id, type, related_shift_id) WHERE related_shift_id IS NOT NULL
      DO NOTHING
      RETURNING *
    `;
    const values = [
      input.recipientId,
      input.type,
      input.title,
      input.message,
      input.relatedShiftId,
      input.relatedApplicationId,
      input.readAt,
    ];
    const result = await pool.query(query, values);
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        id: row.id,
        recipientId: row.recipient_id,
        type: row.type,
        title: row.title,
        message: row.message,
        relatedShiftId: row.related_shift_id,
        relatedApplicationId: row.related_application_id,
        readAt: row.read_at,
        createdAt: row.created_at,
      } as Notification;
    }

    // Conflict occurred - fetch the existing row
    const [existing] = await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.recipientId, input.recipientId),
        eq(notifications.type, input.type),
        eq(notifications.relatedShiftId, input.relatedShiftId)
      ))
      .limit(1);

    if (existing) return existing;
  }

  if (input.relatedApplicationId) {
    const query = `
      INSERT INTO notifications (id, recipient_id, type, title, message, related_shift_id, related_application_id, read_at, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (recipient_id, type, related_application_id) WHERE related_application_id IS NOT NULL
      DO NOTHING
      RETURNING *
    `;
    const values = [
      input.recipientId,
      input.type,
      input.title,
      input.message,
      input.relatedShiftId,
      input.relatedApplicationId,
      input.readAt,
    ];
    const result = await pool.query(query, values);
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        id: row.id,
        recipientId: row.recipient_id,
        type: row.type,
        title: row.title,
        message: row.message,
        relatedShiftId: row.related_shift_id,
        relatedApplicationId: row.related_application_id,
        readAt: row.read_at,
        createdAt: row.created_at,
      } as Notification;
    }

    // Conflict occurred - fetch the existing row
    const [existing] = await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.recipientId, input.recipientId),
        eq(notifications.type, input.type),
        eq(notifications.relatedApplicationId, input.relatedApplicationId)
      ))
      .limit(1);

    if (existing) return existing;
  }

  // No related shift or application - fall back to simple insert (no idempotency constraint for this case)
  return createNotification(input);
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
export async function markAllNotificationsRead(recipientId: string): Promise<number> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(notifications.recipientId, recipientId),
      isNull(notifications.readAt)
    ));
  return result.rowCount ?? 0;
}
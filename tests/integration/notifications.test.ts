import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  profiles,
  shifts,
  shiftApplications,
  shiftAssignments,
  notifications,
  attendanceRecords,
} from '@/lib/db/schema';
import {
  createNotification,
  createNotificationIdempotent,
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from '@/lib/db/queries/notifications';
import { eq, and, count } from 'drizzle-orm';

// Generate unique test IDs to avoid conflicts between parallel test suites
const uniqueEmail = (base: string) => `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@workforce.test`;

describe('Task 5.1 - Notification Query Layer', () => {
  let testEmployeeId: string;
  let testAdminId: string;
  let testShiftId: string;
  let testApplicationId: string;

  beforeAll(async () => {
    // Clean up any existing test data
    await db.delete(notifications);
    await db.delete(attendanceRecords);
    await db.delete(shiftAssignments);
    await db.delete(shiftApplications);
    await db.delete(shifts);
    await db.delete(profiles);
  });

  beforeEach(async () => {
    // Create test employee
    const [emp1] = await db.insert(profiles).values({
      fullName: 'Test Employee 1',
      email: uniqueEmail('test1'),
      preferredLanguage: 'nl',
    }).returning();
    testEmployeeId = emp1.id;

    // Create test admin
    const [admin] = await db.insert(profiles).values({
      fullName: 'Test Admin',
      email: uniqueEmail('admin'),
      preferredLanguage: 'nl',
    }).returning();
    testAdminId = admin.id;

    // Create test shift
    const [shift] = await db.insert(shifts).values({
      title: 'Test Shift',
      workType: 'cleaning',
      location: 'Amsterdam',
      startAt: new Date('2099-01-01T09:00:00Z'),
      endAt: new Date('2099-01-01T17:00:00Z'),
      requiredWorkers: 2,
      createdBy: testAdminId,
      status: 'open',
    }).returning();
    testShiftId = shift.id;

    // Create test application
    const [app] = await db.insert(shiftApplications).values({
      shiftId: testShiftId,
      employeeId: testEmployeeId,
      status: 'pending',
    }).returning();
    testApplicationId = app.id;
  });

  afterAll(async () => {
    // Clean up
    await db.delete(notifications);
    await db.delete(shiftAssignments);
    await db.delete(shiftApplications);
    await db.delete(shifts);
    await db.delete(profiles);
  });

  describe('createNotification', () => {
    it('should create a notification with all fields', async () => {
      const created = await createNotification({
        recipientId: testEmployeeId,
        type: 'shift_created',
        title: 'New shift available',
        message: 'A new shift has been posted',
        relatedShiftId: testShiftId,
      });

      expect(created.id).toBeDefined();
      expect(created.recipientId).toBe(testEmployeeId);
      expect(created.type).toBe('shift_created');
      expect(created.title).toBe('New shift available');
      expect(created.message).toBe('A new shift has been posted');
      expect(created.relatedShiftId).toBe(testShiftId);
      expect(created.relatedApplicationId).toBeNull();
      expect(created.readAt).toBeNull();
      expect(created.createdAt).toBeDefined();
    });

    it('should create a notification without optional fields', async () => {
      const created = await createNotification({
        recipientId: testEmployeeId,
        type: 'application_received',
        title: 'Application received',
      });

      expect(created.recipientId).toBe(testEmployeeId);
      expect(created.type).toBe('application_received');
      expect(created.title).toBe('Application received');
      expect(created.message).toBeNull();
      expect(created.relatedShiftId).toBeNull();
      expect(created.relatedApplicationId).toBeNull();
    });

    it('should create notification with relatedApplicationId', async () => {
      const created = await createNotification({
        recipientId: testEmployeeId,
        type: 'application_accepted',
        title: 'Application accepted',
        message: 'Your application was accepted',
        relatedApplicationId: testApplicationId,
      });

      expect(created.relatedApplicationId).toBe(testApplicationId);
    });
  });

  describe('createNotificationIdempotent', () => {
    it('should create a new notification when none exists', async () => {
      const created = await createNotificationIdempotent({
        recipientId: testEmployeeId,
        type: 'shift_created',
        title: 'New shift available',
        relatedShiftId: testShiftId,
      });

      expect(created).not.toBeNull();
      expect(created!.title).toBe('New shift available');
      expect(created!.relatedShiftId).toBe(testShiftId);
    });

    it('should return existing notification on duplicate call (same recipient, type, shift)', async () => {
      // First call
      const first = await createNotificationIdempotent({
        recipientId: testEmployeeId,
        type: 'shift_created',
        title: 'New shift available',
        relatedShiftId: testShiftId,
      });

      // Second call with same params
      const second = await createNotificationIdempotent({
        recipientId: testEmployeeId,
        type: 'shift_created',
        title: 'New shift available',
        relatedShiftId: testShiftId,
      });

      expect(second).not.toBeNull();
      expect(second!.id).toBe(first!.id); // Same ID returned
    });

    it('should return existing notification on duplicate call (same recipient, type, application)', async () => {
      const first = await createNotificationIdempotent({
        recipientId: testEmployeeId,
        type: 'application_accepted',
        title: 'Application accepted',
        relatedApplicationId: testApplicationId,
      });

      const second = await createNotificationIdempotent({
        recipientId: testEmployeeId,
        type: 'application_accepted',
        title: 'Application accepted',
        relatedApplicationId: testApplicationId,
      });

      expect(second).not.toBeNull();
      expect(second!.id).toBe(first!.id);
    });

    it('should create separate notifications for different recipients', async () => {
      const first = await createNotificationIdempotent({
        recipientId: testEmployeeId,
        type: 'shift_created',
        title: 'New shift available',
        relatedShiftId: testShiftId,
      });

      const second = await createNotificationIdempotent({
        recipientId: testAdminId,
        type: 'shift_created',
        title: 'New shift available',
        relatedShiftId: testShiftId,
      });

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second!.id).not.toBe(first!.id);
    });

    it('should create separate notifications for different types', async () => {
      const first = await createNotificationIdempotent({
        recipientId: testEmployeeId,
        type: 'shift_created',
        title: 'New shift available',
        relatedShiftId: testShiftId,
      });

      const second = await createNotificationIdempotent({
        recipientId: testEmployeeId,
        type: 'application_received',
        title: 'Application received',
        relatedShiftId: testShiftId,
      });

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second!.id).not.toBe(first!.id);
    });
  });

  describe('getNotifications', () => {
    beforeEach(async () => {
      // Create test notifications
      await db.insert(notifications).values([
        {
          recipientId: testEmployeeId,
          type: 'shift_created',
          title: 'Shift 1 created',
          message: 'Message 1',
          relatedShiftId: testShiftId,
        },
        {
          recipientId: testEmployeeId,
          type: 'application_received',
          title: 'Application 1 received',
          message: 'Message 2',
          relatedApplicationId: testApplicationId,
        },
        {
          recipientId: testEmployeeId,
          type: 'shift_updated',
          title: 'Shift 1 updated',
          message: 'Message 3',
          relatedShiftId: testShiftId,
        },
      ]);
    });

    it('should return all unread notifications for recipient', async () => {
      const result = await getNotifications({
        recipientId: testEmployeeId,
        isRead: false,
      });

      expect(result.total).toBe(3);
      expect(result.data.length).toBe(3);
    });

    it('should filter by type', async () => {
      const result = await getNotifications({
        recipientId: testEmployeeId,
        type: 'shift_created',
        isRead: false,
      });

      expect(result.total).toBe(1);
      expect(result.data[0].type).toBe('shift_created');
    });

    it('should filter by read status', async () => {
      // Mark one as read
      const [notif] = await db
        .select()
        .from(notifications)
        .where(and(
          eq(notifications.recipientId, testEmployeeId),
          eq(notifications.type, 'shift_created')
        ))
        .limit(1);

      await db.update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, notif.id));

      const unread = await getNotifications({ recipientId: testEmployeeId, isRead: false });
      const read = await getNotifications({ recipientId: testEmployeeId, isRead: true });

      expect(unread.total).toBe(2);
      expect(read.total).toBe(1);
    });

    it('should paginate correctly', async () => {
      const page1 = await getNotifications({ recipientId: testEmployeeId, page: 1, limit: 2 });
      const page2 = await getNotifications({ recipientId: testEmployeeId, page: 2, limit: 2 });

      expect(page1.data.length).toBe(2);
      expect(page2.data.length).toBe(1);
      expect(page1.total).toBe(3);
      expect(page2.total).toBe(3);
    });

    it('should return empty for different recipient', async () => {
      const result = await getNotifications({ recipientId: testAdminId });

      expect(result.total).toBe(0);
      expect(result.data.length).toBe(0);
    });

    it('should order by createdAt descending', async () => {
      const result = await getNotifications({ recipientId: testEmployeeId });

      // Most recent first
      for (let i = 0; i < result.data.length - 1; i++) {
        expect(result.data[i].createdAt.getTime()).toBeGreaterThanOrEqual(result.data[i + 1].createdAt.getTime());
      }
    });
  });

  describe('getUnreadCount', () => {
    beforeEach(async () => {
      await db.insert(notifications).values([
        {
          recipientId: testEmployeeId,
          type: 'shift_created',
          title: 'Shift 1',
        },
        {
          recipientId: testEmployeeId,
          type: 'application_received',
          title: 'App 1',
        },
        {
          recipientId: testEmployeeId,
          type: 'shift_updated',
          title: 'Shift 2',
          readAt: new Date(), // Already read
        },
      ]);
    });

    it('should count only unread notifications', async () => {
      const count = await getUnreadCount(testEmployeeId);
      expect(count).toBe(2);
    });

    it('should return 0 for user with no notifications', async () => {
      const count = await getUnreadCount(testAdminId);
      expect(count).toBe(0);
    });
  });

  describe('markNotificationRead', () => {
    it('should mark notification as read', async () => {
      const [notif] = await db.insert(notifications).values({
        recipientId: testEmployeeId,
        type: 'shift_created',
        title: 'Test',
      }).returning();

      const result = await markNotificationRead(notif.id);
      expect(result).toBe(true);

      const [updated] = await db.select().from(notifications).where(eq(notifications.id, notif.id)).limit(1);
      expect(updated.readAt).not.toBeNull();
    });

    it('should return false for non-existent notification', async () => {
      const result = await markNotificationRead('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });

    it('should not fail if already read', async () => {
      const [notif] = await db.insert(notifications).values({
        recipientId: testEmployeeId,
        type: 'shift_created',
        title: 'Test',
        readAt: new Date(),
      }).returning();

      const result = await markNotificationRead(notif.id);
      expect(result).toBe(true); // Still returns true (rowCount > 0)
    });
  });

  describe('markAllNotificationsRead', () => {
    it('should mark all unread as read', async () => {
      await db.insert(notifications).values([
        { recipientId: testEmployeeId, type: 'shift_created', title: '1' },
        { recipientId: testEmployeeId, type: 'application_received', title: '2' },
        { recipientId: testEmployeeId, type: 'shift_updated', title: '3', readAt: new Date() },
      ]);

      const count = await markAllNotificationsRead(testEmployeeId);
      expect(count).toBe(2); // Only 2 were unread

      const unread = await getUnreadCount(testEmployeeId);
      expect(unread).toBe(0);
    });

    it('should return 0 if all already read', async () => {
      await db.insert(notifications).values([
        { recipientId: testEmployeeId, type: 'shift_created', title: '1', readAt: new Date() },
      ]);

      const count = await markAllNotificationsRead(testEmployeeId);
      expect(count).toBe(0);
    });
  });

  describe('deleteNotification', () => {
    it('should delete notification by id', async () => {
      const [notif] = await db.insert(notifications).values({
        recipientId: testEmployeeId,
        type: 'shift_created',
        title: 'To delete',
      }).returning();

      const result = await deleteNotification(notif.id);
      expect(result).toBe(true);

      const [deleted] = await db.select().from(notifications).where(eq(notifications.id, notif.id)).limit(1);
      expect(deleted).toBeUndefined();
    });

    it('should return false for non-existent notification', async () => {
      const result = await deleteNotification('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  describe('Security & Authorization', () => {
    it('should not enforce ownership at query layer (caller responsibility)', async () => {
      // This test verifies that the query layer does NOT enforce authorization
      // Authorization is enforced at the API route layer
      const [adminNotif] = await db.insert(notifications).values({
        recipientId: testAdminId,
        type: 'shift_created',
        title: 'Admin notification',
      }).returning();

      // Employee CAN query admin's notifications at the query layer
      // (API layer must filter by recipientId)
      const result = await getNotifications({
        recipientId: testAdminId,
      });

      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe(adminNotif.id);
    });
  });
});
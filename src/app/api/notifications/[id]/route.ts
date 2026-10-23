import { NextRequest, NextResponse } from 'next/server';
import {
  deleteNotificationForRecipient,
  markNotificationReadForRecipient,
} from '@/backend/db/queries/notifications';
import { requireRole } from '@/backend/security/requireRole';
import { withCsrfAndAuth } from '@/backend/security/csrf';
import { markNotificationReadSchema, notificationIdSchema } from '@/lib/validators/notifications';
import { getAuditMetadata } from '@/backend/security/auditLogger';

const allowedRoles = ['administrator', 'supervisor', 'employee'] as const;
type RouteContext = { params: { id: string } };

async function patchNotification(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const authResult = await requireRole(req, [...allowedRoles]);
    if (authResult instanceof NextResponse) return authResult;

    const idValidation = notificationIdSchema.safeParse(params.id);
    if (!idValidation.success) {
      return NextResponse.json({ error: 'Invalid notification ID' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const bodyValidation = markNotificationReadSchema.safeParse(body);
    if (!bodyValidation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: bodyValidation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const updated = await markNotificationReadForRecipient(
      idValidation.data,
      authResult.userId,
      getAuditMetadata(req)
    );
    if (!updated) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Notifications PATCH] Error:', error);
    return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 });
  }
}

async function dismissNotification(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const authResult = await requireRole(req, [...allowedRoles]);
    if (authResult instanceof NextResponse) return authResult;

    const idValidation = notificationIdSchema.safeParse(params.id);
    if (!idValidation.success) {
      return NextResponse.json({ error: 'Invalid notification ID' }, { status: 400 });
    }

    const deleted = await deleteNotificationForRecipient(
      idValidation.data,
      authResult.userId,
      getAuditMetadata(req)
    );
    if (!deleted) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Notifications DELETE] Error:', error);
    return NextResponse.json({ error: 'Failed to dismiss notification' }, { status: 500 });
  }
}

export const PATCH = withCsrfAndAuth(patchNotification, [...allowedRoles]);
export const DELETE = withCsrfAndAuth(dismissNotification, [...allowedRoles]);

import { NextRequest, NextResponse } from 'next/server';
import { getNotifications } from '@/backend/db/queries/notifications';
import { requireRole } from '@/backend/security/requireRole';
import { withCsrfAndAuth } from '@/backend/security/csrf';
import { notificationQuerySchema } from '@/backend/validation/notifications';

const allowedRoles = ['administrator', 'supervisor', 'employee'] as const;

async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const authResult = await requireRole(req, [...allowedRoles]);
    if (authResult instanceof NextResponse) return authResult;

    const query = Object.fromEntries(new URL(req.url).searchParams.entries());
    const validation = notificationQuerySchema.safeParse(query);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { type, isRead, page, limit } = validation.data;
    const { data, total } = await getNotifications({
      recipientId: authResult.userId,
      type,
      isRead: isRead === 'all' ? null : isRead === 'true',
      page,
      limit,
    });

    return NextResponse.json({
      data: data.map((notification) => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        relatedShiftId: notification.relatedShiftId,
        relatedApplicationId: notification.relatedApplicationId,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('[Notifications GET] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}

async function postHandler(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Notification creation is restricted to trusted server-side workflows' },
    { status: 405, headers: { Allow: 'GET' } }
  );
}

export { GET };
export const POST = withCsrfAndAuth(postHandler, [...allowedRoles]);

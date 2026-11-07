import { NextRequest, NextResponse } from 'next/server';
import { publishDraftShift } from '@/backend/db/queries/shifts';
import { getAuditMetadata } from '@/backend/security/auditLogger';
import { requireCsrf } from '@/backend/security/csrf';
import { requireRole } from '@/backend/security/requireRole';
import { shiftIdParamSchema } from '@/backend/validation/shifts';

type RouteContext = { params: { id: string } };

async function POST(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const auth = await requireRole(req, ['administrator']);
    if (auth instanceof NextResponse) return auth;

    const parsedParams = shiftIdParamSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid shift ID' }, { status: 400 });
    }

    const result = await publishDraftShift(
      parsedParams.data.id,
      auth.userId,
      getAuditMetadata(req)
    );
    switch (result.status) {
      case 'published':
        return NextResponse.json({
          shift: result.shift,
          message: 'Shift published successfully',
        });
      case 'not-found':
        return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
      case 'conflict':
        return NextResponse.json(
          { error: 'Only draft shifts can be published' },
          { status: 409 }
        );
      case 'invalid':
        return NextResponse.json(
          { error: 'Shift is not ready to publish', details: { shift: [result.reason] } },
          { status: 422 }
        );
    }
  } catch (error) {
    console.error('[Admin Shift Publish] Error:', error);
    return NextResponse.json({ error: 'Failed to publish shift' }, { status: 500 });
  }
}

const protectedPOST = requireCsrf(POST);
export { protectedPOST as POST };

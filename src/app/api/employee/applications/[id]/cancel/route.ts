import { NextRequest, NextResponse } from 'next/server';
import { cancelPendingApplication } from '@/backend/db/queries/applications';
import { requireRole } from '@/backend/security/requireRole';
import { withCsrfAndAuth } from '@/backend/security/csrf';
import { getAuditMetadata } from '@/backend/security/auditLogger';
import { applicationIdParamSchema } from '@/backend/validation/applications';

async function cancelApplicationHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const authResult = await requireRole(req, ['employee']);
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const validation = applicationIdParamSchema.safeParse({ id });
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid application ID', code: 'INVALID_REQUEST' },
        { status: 400 }
      );
    }

    const result = await cancelPendingApplication(
      validation.data.id,
      authResult.userId,
      getAuditMetadata(req)
    );

    if (!result.success) {
      const status = result.code === 'APPLICATION_NOT_FOUND' ? 404
        : result.code === 'INTERNAL_ERROR' ? 500
        : 409;
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status }
      );
    }

    return NextResponse.json({
      success: true,
      code: result.code,
      message: result.message,
    });
  } catch (error) {
    console.error('[Employee Application Cancel POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to cancel application', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

export const POST = withCsrfAndAuth(cancelApplicationHandler, ['employee']);

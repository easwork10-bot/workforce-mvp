import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/backend/auth/session';
import { verifyTokenFromCookie } from '@/backend/auth/tokens';
import { reviewApplication } from '@/backend/db/queries/applications';
import { getAuditMetadata } from '@/backend/security/auditLogger';
import { requireCsrf } from '@/backend/security/csrf';
import { applicationIdParamSchema, reviewApplicationSchema } from '@/backend/validation/applications';

async function postReview(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const paramsValidation = applicationIdParamSchema.safeParse(await params);
  if (!paramsValidation.success) {
    return NextResponse.json({ error: 'Invalid application ID', code: 'INVALID_REQUEST' }, { status: 400 });
  }

  try {
    const payload = await verifyTokenFromCookie(req.headers.get('cookie'));
    if (!payload) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const session = await getSession(payload.jti);
    if (!session || session.role !== 'administrator') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body', code: 'INVALID_REQUEST' }, { status: 400 });
    }

    const validation = reviewApplicationSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid review request', code: 'INVALID_REQUEST', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { id } = paramsValidation.data;
    const { status, rejectionReason } = validation.data;
    const result = await reviewApplication(
      id,
      payload.sub,
      status,
      rejectionReason,
      getAuditMetadata(req)
    );

    if (!result.success) {
      const statusCode = result.code === 'APPLICATION_NOT_FOUND' ? 404
        : result.code === 'INTERNAL_ERROR' ? 500 : 409;
      return NextResponse.json({ error: result.message, code: result.code }, { status: statusCode });
    }

    return NextResponse.json({
      success: true,
      code: result.code,
      message: result.message,
      replayed: result.replayed ?? false,
    });
  } catch (error) {
    console.error('[Admin Application Review POST] Error:', error);
    return NextResponse.json({ error: 'Failed to review application', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export const POST = requireCsrf(postReview);

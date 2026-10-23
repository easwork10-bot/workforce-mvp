import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/backend/auth/session';
import { verifyTokenFromCookie } from '@/backend/auth/tokens';
import { reviewApplication } from '@/backend/db/queries/applications';
import { getAuditMetadata } from '@/backend/security/auditLogger';
import { requireCsrf } from '@/backend/security/csrf';
import { applicationIdParamSchema, reviewApplicationSchema } from '@/backend/validation/applications';

async function postReview(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const paramsValidation = applicationIdParamSchema.safeParse(params);
  if (!paramsValidation.success) {
    return NextResponse.json({ error: 'Invalid application ID' }, { status: 400 });
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
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const validation = reviewApplicationSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid review request', details: validation.error.flatten().fieldErrors },
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
      const statusCode = result.conflict ? 409
        : result.internalError ? 500
        : result.message === 'Sollicitatie niet gevonden' ? 404
        : 400;
      return NextResponse.json({ error: result.message }, { status: statusCode });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      replayed: result.replayed ?? false,
    });
  } catch (error) {
    console.error('[Admin Application Review POST] Error:', error);
    return NextResponse.json({ error: 'Failed to review application' }, { status: 500 });
  }
}

export const POST = requireCsrf(postReview);

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cancelAssignment } from '@/backend/db/queries/assignments';
import { requireRole } from '@/backend/security/requireRole';
import { requireCsrf } from '@/backend/security/csrf';
import { getAuditMetadata } from '@/backend/security/auditLogger';

const paramsSchema = z.object({ id: z.string().uuid() });

async function cancel(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const auth = await requireRole(req, ['administrator']);
    if (auth instanceof NextResponse) return auth;
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid assignment ID', code: 'INVALID_REQUEST' }, { status: 400 });
    }
    const result = await cancelAssignment(parsed.data.id, auth.userId, getAuditMetadata(req));
    if (result.success) return NextResponse.json(result);
    const status = result.code === 'ASSIGNMENT_NOT_FOUND' ? 404
      : result.code === 'INTERNAL_ERROR' ? 500 : 409;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  } catch (error) {
    console.error('[Admin Assignment Cancel] Error:', error);
    return NextResponse.json({ error: 'Failed to cancel assignment', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export const POST = requireCsrf(cancel);

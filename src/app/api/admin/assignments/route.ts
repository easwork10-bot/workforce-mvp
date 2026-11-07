import { NextRequest, NextResponse } from 'next/server';
import { getAssignments } from '@/backend/db/queries/assignments';
import { adminAssignmentQuerySchema } from '@/backend/validation/assignments';
import { requireRole } from '@/backend/security/requireRole';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireRole(req, ['administrator']);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const keys = [...searchParams.keys()];
    const validation = adminAssignmentQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (new Set(keys).size !== keys.length || !validation.success) {
      return NextResponse.json(
        { error: 'Invalid assignment query', code: 'INVALID_REQUEST' },
        { status: 400 }
      );
    }

    const { page, limit } = validation.data;
    const { data, total } = await getAssignments(validation.data);
    return NextResponse.json({
      assignments: data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[Admin Assignments GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch assignments', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

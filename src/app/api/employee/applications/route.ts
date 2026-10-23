import { NextRequest, NextResponse } from 'next/server';
import { getApplications } from '@/backend/db/queries/applications';
import { applicationQuerySchema } from '@/backend/validation/applications';
import { requireRole } from '@/backend/security/requireRole';

/**
 * GET /api/employee/applications - Get employee's shift applications
 */
async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify authentication and employee role
    const authResult = await requireRole(req, ['employee']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;

    // Parse and validate query parameters
    const { searchParams } = new URL(req.url);
    const validation = applicationQuerySchema.safeParse({
      status: searchParams.get('status') || undefined,
      page: searchParams.get('page') || undefined,
      limit: searchParams.get('limit') || undefined,
    });

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Employee can only see their own applications
    const { data, total } = await getApplications({
      employeeId: userId,
      status: validation.data.status,
      page: validation.data.page,
      limit: validation.data.limit,
    });

    return NextResponse.json({
      applications: data,
      pagination: {
        page: validation.data.page,
        limit: validation.data.limit,
        total,
        totalPages: Math.ceil(total / validation.data.limit),
      },
    });
  } catch (error) {
    console.error('[Employee Applications GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch applications' },
      { status: 500 }
    );
  }
}

export { GET };
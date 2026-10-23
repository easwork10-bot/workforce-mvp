import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/backend/auth/session';
import { employeeQuerySchema } from '@/backend/validation/employees';
import { getEmployees } from '@/backend/db/queries/employees';
import { verifyTokenFromCookie } from '@/backend/auth/tokens';
import { requireCsrf } from '@/backend/security/csrf';

/**
 * GET /api/admin/employees - List employees with pagination and filtering
 */
async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify authentication
    const payload = await verifyTokenFromCookie(req.headers.get('cookie'));
    if (!payload) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Verify admin role
    const session = await getSession(payload.jti);
    if (!session || session.role !== 'administrator') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    const validation = employeeQuerySchema.safeParse(queryParams);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Get employees
    const { data, total } = await getEmployees(validation.data);

    return NextResponse.json({
      employees: data,
      pagination: {
        page: validation.data.page,
        limit: validation.data.limit,
        total,
        totalPages: Math.ceil(total / validation.data.limit),
      },
    });
  } catch (error) {
    console.error('[Admin Employees] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch employees' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/employees - Create a new employee (admin only)
 */
async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify authentication
    const payload = await verifyTokenFromCookie(req.headers.get('cookie'));
    if (!payload) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Verify admin role
    const session = await getSession(payload.jti);
    if (!session || session.role !== 'administrator') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Note: The migration plan shows employee creation via register endpoint
    // This endpoint is for admin to view/update existing employees
    return NextResponse.json(
      { error: 'Employee creation is handled through the register endpoint' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Admin Employees POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

// Wrap POST with CSRF protection (GET doesn't need it)
const protectedPOST = requireCsrf(POST);

export { GET, protectedPOST as POST };
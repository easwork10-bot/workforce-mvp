import { NextRequest, NextResponse } from 'next/server';
import { getSession, revokeAllUserSessions } from '@/backend/auth/session';
import { verifyTokenFromCookie } from '@/backend/auth/tokens';
import { employeeIdParamSchema, updateEmployeeSchema } from '@/backend/validation/employees';
import { getEmployeeById, updateEmployee } from '@/backend/db/queries/employees';
import { getAuditMetadata } from '@/backend/security/auditLogger';
import { requireCsrf } from '@/backend/security/csrf';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/employees/[id] - Get employee by ID (admin only)
 */
async function GET(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
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

    // Validate employee ID
    const { id } = await params;
    const validation = employeeIdParamSchema.safeParse({ id });
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid employee ID' },
        { status: 400 }
      );
    }

    // Get employee
    const employee = await getEmployeeById(id);

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ employee });
  } catch (error) {
    console.error('[Admin Employee GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch employee' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/employees/[id] - Update employee (admin only)
 */
async function PATCH(req: NextRequest, context: RouteContext): Promise<NextResponse> {
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

    return await protectedPATCH(req, context, payload.sub);
  } catch (error) {
    console.error('[Admin Employee PATCH] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update employee' },
      { status: 500 }
    );
  }
}

const protectedPATCH = requireCsrf(async (
  req: NextRequest,
  { params }: RouteContext,
  actorId: string
): Promise<NextResponse> => {
  try {
    // Validate employee ID
    const { id } = await params;
    const idValidation = employeeIdParamSchema.safeParse({ id });
    if (!idValidation.success) {
      return NextResponse.json(
        { error: 'Invalid employee ID' },
        { status: 400 }
      );
    }

    // Parse and validate request body
    const body = await req.json();
    const validation = updateEmployeeSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    let sessionsRevokedBeforeUpdate = false;
    if (validation.data.accountStatus === 'active') {
      const currentEmployee = await getEmployeeById(id);
      if (currentEmployee && currentEmployee.accountStatus !== 'active') {
        const revoked = await revokeAllUserSessions(id);
        if (!revoked) {
          return NextResponse.json(
            { error: 'Unable to revoke existing sessions; account remains inactive' },
            { status: 503 }
          );
        }
        sessionsRevokedBeforeUpdate = true;
      }
    }

    // Update employee
    const success = await updateEmployee(
      id,
      actorId,
      {
        fullName: validation.data.fullName,
        phone: validation.data.phone,
        city: validation.data.city,
        preferredLanguage: validation.data.preferredLanguage,
        accountStatus: validation.data.accountStatus,
      },
      validation.data.role,
      {
        workCategories: validation.data.workCategories,
        employmentType: validation.data.employmentType,
        hourlyRate: validation.data.hourlyRate ? validation.data.hourlyRate.toString() : undefined,
        bankAccountIban: validation.data.bankAccountIban,
        bankAccountName: validation.data.bankAccountName,
        emergencyContactName: validation.data.emergencyContactName,
        emergencyContactPhone: validation.data.emergencyContactPhone,
        address: validation.data.address,
        postalCode: validation.data.postalCode,
        dateOfBirth: validation.data.dateOfBirth ? new Date(validation.data.dateOfBirth) : undefined,
        bsNumber: validation.data.bsNumber,
      },
      getAuditMetadata(req)
    );

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to update employee or employee not found' },
        { status: 404 }
      );
    }

    if (
      (
        validation.data.role
        || (validation.data.accountStatus && validation.data.accountStatus !== 'active')
      )
      && !sessionsRevokedBeforeUpdate
    ) {
      const revoked = await revokeAllUserSessions(id);
      if (!revoked) {
        console.error(
          '[Admin Employee PATCH] Session cleanup was incomplete; shared session validation will reject removed roles and inactive accounts.'
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Employee updated successfully',
    });
  } catch (error) {
    console.error('[Admin Employee PATCH] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update employee' },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/admin/employees/[id] - Delete employee (admin only)
 */
async function DELETE(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
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

    // Validate employee ID
    const validation = employeeIdParamSchema.safeParse(await params);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid employee ID' },
        { status: 400 }
      );
    }

    // Note: The migration plan doesn't include delete functionality for employees
    // This would require adding cascade delete logic in the queries
    return NextResponse.json(
      { error: 'Employee deletion not implemented' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Admin Employee DELETE] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete employee' },
      { status: 500 }
    );
  }
}

export { GET, PATCH, DELETE };
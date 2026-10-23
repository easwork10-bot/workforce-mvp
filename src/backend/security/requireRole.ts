import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from './requireAuth';

/**
 * Require specific role(s) - wraps requireAuth
 */
export async function requireRole(
  req: NextRequest,
  allowedRoles: ('administrator' | 'supervisor' | 'employee')[]
): Promise<{ userId: string; role: 'administrator' | 'supervisor' | 'employee'; jti: string } | NextResponse> {
  const authResult = await requireAuth(req);

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  if (!allowedRoles.includes(authResult.role)) {
    return NextResponse.json(
      { error: 'Insufficient permissions' },
      { status: 403 }
    );
  }

  return authResult;
}

/**
 * Require administrator role
 */
export function requireAdmin(
  handler: (req: AuthenticatedRequest, ...args: any[]) => Promise<NextResponse>
) {
  return async (req: NextRequest, ...args: any[]): Promise<NextResponse> => {
    const authResult = await requireRole(req, ['administrator']);

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const authReq = req as AuthenticatedRequest;
    authReq.auth = authResult;

    return handler(authReq, ...args);
  };
}

/**
 * Require supervisor or administrator role
 */
export function requireSupervisor(
  handler: (req: AuthenticatedRequest, ...args: any[]) => Promise<NextResponse>
) {
  return async (req: NextRequest, ...args: any[]): Promise<NextResponse> => {
    const authResult = await requireRole(req, ['administrator', 'supervisor']);

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const authReq = req as AuthenticatedRequest;
    authReq.auth = authResult;

    return handler(authReq, ...args);
  };
}

/**
 * Require employee role (or any authenticated user)
 */
export function requireEmployee(
  handler: (req: AuthenticatedRequest, ...args: any[]) => Promise<NextResponse>
) {
  return async (req: NextRequest, ...args: any[]): Promise<NextResponse> => {
    const authResult = await requireRole(req, ['administrator', 'supervisor', 'employee']);

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const authReq = req as AuthenticatedRequest;
    authReq.auth = authResult;

    return handler(authReq, ...args);
  };
}

/**
 * Check if user has specific role
 */
export function hasRole(
  role: 'administrator' | 'supervisor' | 'employee',
  userRole: 'administrator' | 'supervisor' | 'employee'
): boolean {
  const hierarchy: Record<'administrator' | 'supervisor' | 'employee', number> = {
    administrator: 3,
    supervisor: 2,
    employee: 1,
  };
  return hierarchy[userRole] >= hierarchy[role];
}
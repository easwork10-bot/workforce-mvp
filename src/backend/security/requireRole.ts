import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from './requireAuth';

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
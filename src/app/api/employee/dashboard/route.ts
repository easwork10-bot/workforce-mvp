import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/backend/security/requireRole';
import { getEmployeeDashboard } from '@/backend/db/queries/employee-dashboard';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireRole(req, ['employee']);
    if (auth instanceof NextResponse) {
      auth.headers.set('Cache-Control', headers['Cache-Control']);
      return auth;
    }
    // Never accept a client-supplied employee ID or reporting clock.
    return NextResponse.json(await getEmployeeDashboard(auth.userId), { headers });
  } catch (error) {
    console.error('[Employee Dashboard GET] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard' }, { status: 500, headers });
  }
}

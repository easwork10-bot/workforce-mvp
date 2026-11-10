import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock('@/backend/security/requireRole', () => ({ requireRole: mocks.auth }));
vi.mock('@/backend/db/queries/employee-dashboard', () => ({ getEmployeeDashboard: mocks.query }));
import { GET } from '@/app/api/employee/dashboard/route';

describe('employee dashboard endpoint', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('uses only the authenticated employee and disables caching', async () => {
    mocks.auth.mockResolvedValue({ userId: 'owner' });
    mocks.query.mockResolvedValue({ pendingApplications: 3 });
    const request = new NextRequest('http://localhost/api/employee/dashboard?employeeId=someone-else&month=2099-01');
    const response = await GET(request);
    expect(mocks.auth).toHaveBeenCalledWith(request, ['employee']);
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith('owner');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ pendingApplications: 3 });
  });
  it.each([401, 403, 503])('preserves authentication failure %s without querying data', async status => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'Denied' }, { status }));
    const response = await GET(new NextRequest('http://localhost/api/employee/dashboard'));
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('does not expose database failures', async () => {
    mocks.auth.mockResolvedValue({ userId: 'owner' });
    mocks.query.mockRejectedValue(new Error('private database detail'));
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(new NextRequest('http://localhost/api/employee/dashboard'));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Failed to fetch dashboard' });
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    } finally { logger.mockRestore(); }
  });
});

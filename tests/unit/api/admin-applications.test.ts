import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), session: vi.fn(), getApplications: vi.fn(),
}));
vi.mock('@/backend/auth/tokens', () => ({ verifyTokenFromCookie: mocks.verify }));
vi.mock('@/backend/auth/session', () => ({ getSession: mocks.session }));
vi.mock('@/backend/db/queries/applications', () => ({ getApplications: mocks.getApplications }));
import { GET } from '@/app/api/admin/applications/route';

const request = (query = '') => new NextRequest(`http://localhost/api/admin/applications${query}`);

describe('admin application list API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ sub: 'admin', jti: 'session' });
    mocks.session.mockResolvedValue({ role: 'administrator' });
    mocks.getApplications.mockResolvedValue({ data: [], total: 0 });
  });

  it('uses bounded default pagination', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.getApplications).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(await response.json()).toMatchObject({ pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });

  it.each(['pending', 'accepted', 'rejected', 'cancelled'])('validates %s filtering and calculates page counts', async status => {
    mocks.getApplications.mockResolvedValue({ data: [{ id: 'attempt' }], total: 21 });
    const response = await GET(request(`?status=${status}&page=2&limit=20`));
    expect(mocks.getApplications).toHaveBeenCalledWith({ status, page: 2, limit: 20 });
    expect(await response.json()).toEqual({
      applications: [{ id: 'attempt' }], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
    });
  });

  it.each(['?status=invalid', '?page=0', '?page=1.5', '?limit=101', '?shiftId=invalid', '?employeeId=invalid', '?unknown=1'])(
    'rejects invalid query %s before querying', async query => {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
      expect(mocks.getApplications).not.toHaveBeenCalled();
    },
  );

  it('keeps validated shift and employee filters', async () => {
    const id = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
    await GET(request(`?shiftId=${id}&employeeId=${id}`));
    expect(mocks.getApplications).toHaveBeenCalledWith({ shiftId: id, employeeId: id, page: 1, limit: 20 });
  });

  it('requires authentication', async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.getApplications).not.toHaveBeenCalled();
  });

  it.each([null, { role: 'employee' }, { role: 'supervisor' }])('requires an administrator session (%j)', async session => {
    mocks.session.mockResolvedValue(session);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.getApplications).not.toHaveBeenCalled();
  });

  it('does not expose internal database exceptions', async () => {
    mocks.getApplications.mockRejectedValue(new Error('private SQL failure'));
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(request());
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain('private SQL');
      expect(logger).toHaveBeenCalled();
    } finally { logger.mockRestore(); }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { RedisUnavailableError } from '@/backend/auth/session';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  session: vi.fn(),
  getEmployeeSchedule: vi.fn(),
}));

vi.mock('@/backend/auth/tokens', () => ({ verifyTokenFromCookie: mocks.verify }));
vi.mock('@/backend/auth/session', async importOriginal => ({
  ...await importOriginal<typeof import('@/backend/auth/session')>(),
  getSession: mocks.session,
}));
vi.mock('@/backend/db/queries/assignments', () => ({ getEmployeeSchedule: mocks.getEmployeeSchedule }));

import { GET } from '@/app/api/employee/schedule/route';

const shiftId = '123e4567-e89b-12d3-a456-426614174000';
const otherEmployeeId = '123e4567-e89b-12d3-a456-426614174001';
const request = (query = '') => new NextRequest(`http://localhost/api/employee/schedule${query}`);

describe('employee schedule read API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ sub: 'employee', jti: 'session' });
    mocks.session.mockResolvedValue({ userId: 'employee', role: 'employee' });
    mocks.getEmployeeSchedule.mockResolvedValue({ data: [], total: 0 });
  });

  it('returns a private empty page for the authenticated employee', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      assignments: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    expect(mocks.getEmployeeSchedule).toHaveBeenCalledExactlyOnceWith({
      employeeId: 'employee', shiftId: undefined, startFrom: undefined, startTo: undefined,
      status: undefined, page: 1, limit: 20,
    });
  });

  it.each(['assigned', 'confirmed', 'cancelled', 'completed'] as const)(
    'passes the %s assignment status and all supported filters', async status => {
      mocks.getEmployeeSchedule.mockResolvedValue({ data: [{ id: 'assignment', status }], total: 21 });
      const response = await GET(request(
        `?status=${status}&shiftId=${shiftId}&dateFrom=2027-03-28&dateTo=2027-03-29&page=2&limit=20`,
      ));
      expect(response.status).toBe(200);
      expect(mocks.getEmployeeSchedule).toHaveBeenCalledExactlyOnceWith({
        employeeId: 'employee', shiftId, startFrom: '2027-03-28', startTo: '2027-03-29',
        status, page: 2, limit: 20,
      });
      expect(await response.json()).toEqual({
        assignments: [{ id: 'assignment', status }],
        pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
      });
    },
  );

  it('never uses the supplied employeeId to select another employee', async () => {
    const response = await GET(request(`?employeeId=${otherEmployeeId}&shiftId=${shiftId}`));
    expect(response.status).toBe(200);
    expect(mocks.getEmployeeSchedule).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'employee', shiftId,
    }));
  });

  it.each([
    '?status=checked_in', '?status=pending', '?status=', '?shiftId=invalid', '?shiftId=',
    '?employeeId=invalid', '?dateFrom=', '?dateTo=2027-02-29', '?dateFrom=0000-01-01',
    '?dateFrom=2027-03-29&dateTo=2027-03-28', '?page=0', '?page=',
    '?page=9007199254740992', '?page=9007199254740991&limit=2', '?limit=0', '?limit=101',
  ])('rejects invalid query %s before accessing the repository', async query => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ error: 'Invalid query parameters', details: expect.any(Object) });
    expect(mocks.getEmployeeSchedule).not.toHaveBeenCalled();
  });

  it('accepts a leap day and the maximum page size', async () => {
    expect((await GET(request('?dateFrom=2028-02-29&dateTo=2028-02-29&limit=100'))).status).toBe(200);
    expect(mocks.getEmployeeSchedule).toHaveBeenCalledWith(expect.objectContaining({
      startFrom: '2028-02-29', startTo: '2028-02-29', limit: 100,
    }));
  });

  it('rejects missing and revoked sessions before querying', async () => {
    mocks.verify.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);
    mocks.session.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.getEmployeeSchedule).not.toHaveBeenCalled();
  });

  it.each(['administrator', 'supervisor'])('rejects the %s role', async role => {
    mocks.session.mockResolvedValue({ userId: 'other', role });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.getEmployeeSchedule).not.toHaveBeenCalled();
  });

  it('fails closed when session storage is unavailable', async () => {
    mocks.session.mockRejectedValue(new RedisUnavailableError());
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await GET(request())).status).toBe(503);
      expect(mocks.getEmployeeSchedule).not.toHaveBeenCalled();
      expect(logger).toHaveBeenCalled();
    } finally { logger.mockRestore(); }
  });

  it('logs repository errors without exposing internal details', async () => {
    mocks.getEmployeeSchedule.mockRejectedValue(new Error('private database failure'));
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(request());
      expect(response.status).toBe(500);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toEqual({ error: 'Failed to fetch schedule' });
      expect(logger).toHaveBeenCalledWith('[Employee Schedule GET] Error:', expect.any(Error));
    } finally { logger.mockRestore(); }
  });
});

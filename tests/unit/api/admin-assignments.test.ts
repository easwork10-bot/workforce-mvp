import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { RedisUnavailableError } from '@/backend/auth/session';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), session: vi.fn(), getAssignments: vi.fn(),
}));
vi.mock('@/backend/auth/tokens', () => ({ verifyTokenFromCookie: mocks.verify }));
vi.mock('@/backend/auth/session', async importOriginal => ({
  ...await importOriginal<typeof import('@/backend/auth/session')>(),
  getSession: mocks.session,
}));
vi.mock('@/backend/db/queries/assignments', () => ({ getAssignments: mocks.getAssignments }));
import { GET } from '@/app/api/admin/assignments/route';

const request = (query = '') => new NextRequest(`http://localhost/api/admin/assignments${query}`);

describe('admin assignments read API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ sub: 'admin', jti: 'session' });
    mocks.session.mockResolvedValue({ userId: 'admin', role: 'administrator' });
    mocks.getAssignments.mockResolvedValue({ data: [], total: 0 });
  });

  it('returns the default empty page without requiring a CSRF token', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.getAssignments).toHaveBeenCalledExactlyOnceWith({ page: 1, limit: 20 });
    expect(await response.json()).toEqual({
      assignments: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it.each(['assigned', 'confirmed', 'cancelled', 'completed'])(
    'passes validated %s filtering and pagination to the query', async status => {
      mocks.getAssignments.mockResolvedValue({ data: [{ id: 'assignment', status }], total: 21 });
      const response = await GET(request(`?status=${status}&page=2&limit=20`));
      expect(response.status).toBe(200);
      expect(mocks.getAssignments).toHaveBeenCalledExactlyOnceWith({ status, page: 2, limit: 20 });
      expect(await response.json()).toEqual({
        assignments: [{ id: 'assignment', status }],
        pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
      });
    },
  );

  it('accepts the upper limit boundary', async () => {
    expect((await GET(request('?limit=100'))).status).toBe(200);
    expect(mocks.getAssignments).toHaveBeenCalledExactlyOnceWith({ page: 1, limit: 100 });
  });

  it.each([
    '?status=pending', '?status=all', '?status=', '?page=0', '?page=-1', '?page=1.5',
    '?page=', '?page=abc', '?page=Infinity', '?page=9007199254740992',
    '?page=9007199254740991&limit=100', '?limit=0', '?limit=-1', '?limit=1.5',
    '?limit=101', '?limit=', '?limit=abc', '?unknown=1', '?employeeId=ignored',
    '?page=1&page=2', '?limit=1&limit=2', '?status=assigned&status=completed',
  ])('rejects invalid query %s without accessing the repository', async query => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid assignment query', code: 'INVALID_REQUEST' });
    expect(mocks.getAssignments).not.toHaveBeenCalled();
  });

  it('denies unauthenticated access before querying', async () => {
    mocks.verify.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.getAssignments).not.toHaveBeenCalled();
  });

  it('denies expired or revoked sessions', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.getAssignments).not.toHaveBeenCalled();
  });

  it.each(['employee', 'supervisor'])('denies the %s role', async role => {
    mocks.session.mockResolvedValue({ userId: 'user', role });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.getAssignments).not.toHaveBeenCalled();
  });

  it('fails closed with the established 503 when session storage is unavailable', async () => {
    mocks.session.mockRejectedValue(new RedisUnavailableError());
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await GET(request())).status).toBe(503);
      expect(mocks.getAssignments).not.toHaveBeenCalled();
      expect(logger).toHaveBeenCalled();
    } finally { logger.mockRestore(); }
  });

  it('logs repository errors without exposing internal details', async () => {
    mocks.getAssignments.mockRejectedValue(new Error('private SQL failure'));
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: 'Failed to fetch assignments', code: 'INTERNAL_ERROR',
      });
      expect(logger).toHaveBeenCalledWith('[Admin Assignments GET] Error:', expect.any(Error));
    } finally { logger.mockRestore(); }
  });
});

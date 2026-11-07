import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { generateCsrfToken, signCsrfToken } from '@/backend/security/csrf';

const mocks = vi.hoisted(() => ({
  verifyTokenFromCookie: vi.fn(),
  getSession: vi.fn(),
  createShift: vi.fn(),
  getShifts: vi.fn(),
  getShiftStats: vi.fn(),
  publishDraftShift: vi.fn(),
  getAuditMetadata: vi.fn(),
  profileLimit: vi.fn(),
  dbSelect: vi.fn(),
}));

vi.mock('@/backend/auth/tokens', () => ({
  verifyTokenFromCookie: mocks.verifyTokenFromCookie,
}));

vi.mock('@/backend/auth/session', () => ({
  getSession: mocks.getSession,
}));

vi.mock('@/backend/db/queries/shifts', () => ({
  createShift: mocks.createShift,
  getShifts: mocks.getShifts,
  getShiftStats: mocks.getShiftStats,
  publishDraftShift: mocks.publishDraftShift,
}));

vi.mock('@/backend/db', () => ({
  db: { select: mocks.dbSelect },
}));

vi.mock('@/backend/security/auditLogger', () => ({
  getAuditMetadata: mocks.getAuditMetadata,
}));

import { GET, POST as createShiftPost } from '@/app/api/admin/shifts/route';
import { POST as publishShiftPost } from '@/app/api/admin/shifts/[id]/publish/route';

const shiftId = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
const validShiftBody = {
  title: 'Traffic Controller',
  workType: 'Traffic Control',
  clientOrProject: null,
  location: 'Amsterdam',
  latitude: 0,
  longitude: 0,
  startAt: '2099-01-15T08:00:00.000Z',
  endAt: '2099-01-15T16:00:00.000Z',
  requiredWorkers: 2,
  compensationType: 'hourly',
  compensationAmount: null,
  description: null,
  instructions: null,
  status: 'open',
};

function csrfHeaders(withCsrf = true): Headers {
  const headers = new Headers({ cookie: 'access_token=valid' });
  if (withCsrf) {
    const token = signCsrfToken(generateCsrfToken());
    headers.set('cookie', `access_token=valid; csrf_token=${token}`);
    headers.set('x-csrf-token', token);
  }
  return headers;
}

function makeRequest(
  path: string,
  method: 'GET' | 'POST',
  options: { csrf?: boolean; body?: unknown } = {}
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: csrfHeaders(options.csrf),
    ...(method === 'POST' ? { body: JSON.stringify(options.body ?? validShiftBody) } : {}),
  });
}

const publishParams = { params: { id: shiftId } };

describe('admin shift API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyTokenFromCookie.mockResolvedValue({
      sub: 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1',
      jti: 'admin-session',
    });
    mocks.getSession.mockResolvedValue({ role: 'administrator' });
    mocks.getShifts.mockResolvedValue({ data: [], total: 0 });
    mocks.getShiftStats.mockResolvedValue({
      total: 0, draft: 0, open: 0, filled: 0, cancelled: 0, completed: 0,
    });
    mocks.profileLimit.mockResolvedValue([{
      id: 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1',
    }]);
    mocks.dbSelect.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: mocks.profileLimit }) }),
    }));
    mocks.createShift.mockResolvedValue({ id: shiftId, ...validShiftBody, status: 'draft' });
    mocks.publishDraftShift.mockResolvedValue({
      status: 'published',
      shift: { id: shiftId, status: 'open', ...validShiftBody },
    });
    mocks.getAuditMetadata.mockReturnValue({ ipAddress: 'hashed-ip', userAgent: 'test-agent' });
  });

  it('requires an authenticated administrator to read the shift list', async () => {
    mocks.verifyTokenFromCookie.mockResolvedValue(null);
    expect((await GET(makeRequest('/api/admin/shifts', 'GET'))).status).toBe(401);

    mocks.verifyTokenFromCookie.mockResolvedValue({ sub: 'user', jti: 'session' });
    mocks.getSession.mockResolvedValue({ role: 'employee' });
    expect((await GET(makeRequest('/api/admin/shifts', 'GET'))).status).toBe(403);
    expect(mocks.getShifts).not.toHaveBeenCalled();
  });

  it('validates and applies list pagination and status filters', async () => {
    const response = await GET(makeRequest(
      '/api/admin/shifts?page=2&limit=10&status=draft&sortBy=title&sortOrder=desc',
      'GET'
    ));

    expect(response.status).toBe(200);
    expect(mocks.getShifts).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      status: 'draft',
      sortBy: 'title',
      sortOrder: 'desc',
    });
    expect((await response.json()).pagination).toEqual({
      page: 2, limit: 10, total: 0, totalPages: 0,
    });
  });

  it('rejects invalid pagination and status values', async () => {
    for (const query of ['page=0', 'limit=101', 'status=active']) {
      const response = await GET(makeRequest(`/api/admin/shifts?${query}`, 'GET'));
      expect(response.status).toBe(400);
    }
    expect(mocks.getShifts).not.toHaveBeenCalled();
  });

  it('rejects creation without CSRF, invalid fields or invalid time ranges', async () => {
    expect((await createShiftPost(makeRequest('/api/admin/shifts', 'POST', { csrf: false }))).status)
      .toBe(403);
    expect((await createShiftPost(makeRequest('/api/admin/shifts', 'POST', {
      body: { ...validShiftBody, title: 'x' },
    }))).status).toBe(400);
    expect((await createShiftPost(makeRequest('/api/admin/shifts', 'POST', {
      body: { ...validShiftBody, endAt: validShiftBody.startAt },
    }))).status).toBe(400);
    expect(mocks.createShift).not.toHaveBeenCalled();
  });

  it('creates every submitted shift as a draft and preserves zero coordinates', async () => {
    const response = await createShiftPost(makeRequest('/api/admin/shifts', 'POST'));

    expect(response.status).toBe(201);
    expect(mocks.createShift).toHaveBeenCalledOnce();
    const [data] = mocks.createShift.mock.calls[0];
    expect(data).toMatchObject({
      status: 'draft',
      latitude: '0',
      longitude: '0',
      createdBy: 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1',
    });
    expect(data).not.toHaveProperty('clientStatus');
  });

  it('protects publish with authentication, administrator role, CSRF and a UUID', async () => {
    expect((await publishShiftPost(
      makeRequest('/api/admin/shifts/x/publish', 'POST', { csrf: false }),
      publishParams
    )).status).toBe(403);

    mocks.getSession.mockResolvedValue({ role: 'employee' });
    expect((await publishShiftPost(
      makeRequest(`/api/admin/shifts/${shiftId}/publish`, 'POST'),
      publishParams
    )).status).toBe(403);

    mocks.getSession.mockResolvedValue({ role: 'administrator' });
    expect((await publishShiftPost(
      makeRequest('/api/admin/shifts/not-a-uuid/publish', 'POST'),
      { params: { id: 'not-a-uuid' } }
    )).status).toBe(400);
    expect(mocks.publishDraftShift).not.toHaveBeenCalled();
  });

  it('returns a successful publish and a deterministic conflict on repeat', async () => {
    const published = await publishShiftPost(
      makeRequest(`/api/admin/shifts/${shiftId}/publish`, 'POST'),
      publishParams
    );
    expect(published.status).toBe(200);
    expect((await published.json()).shift.status).toBe('open');

    mocks.publishDraftShift.mockResolvedValueOnce({ status: 'conflict' });
    const repeated = await publishShiftPost(
      makeRequest(`/api/admin/shifts/${shiftId}/publish`, 'POST'),
      publishParams
    );
    expect(repeated.status).toBe(409);
  });
});

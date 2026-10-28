import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmployeeApplicationsApiError,
  fetchEmployeeApplications,
} from '@/frontend/features/employee-applications/employeeApplicationsApi';

const application = {
  id: 'application-1',
  shiftId: 'shift-1',
  status: 'pending',
  appliedAt: '2026-10-22T10:00:00.000Z',
  shift: {
    title: 'Warehouse support',
    startAt: '2026-11-01T08:00:00.000Z',
    endAt: '2026-11-01T16:00:00.000Z',
    location: 'Utrecht',
  },
};

describe('employee applications API', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the authenticated employee applications endpoint with pagination', async () => {
    const responseBody = {
      applications: [application],
      pagination: { page: 2, limit: 10, total: 11, totalPages: 2 },
    };
    fetchMock.mockResolvedValue(Response.json(responseBody));

    await expect(fetchEmployeeApplications(2, 10)).resolves.toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith('/api/employee/applications?page=2&limit=10', expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    }));
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [500, 'server'],
  ] as const)('surfaces a %s response as a %s error', async (status, kind) => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Request rejected' }, { status }));

    await expect(fetchEmployeeApplications(1, 20)).rejects.toMatchObject({ kind, status });
  });

  it('rejects an unexpected API response shape', async () => {
    fetchMock.mockResolvedValue(Response.json({
      applications: [{ ...application, status: 'approved' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    }));

    await expect(fetchEmployeeApplications(1, 20)).rejects.toMatchObject({
      kind: 'server',
      message: 'The applications response was invalid.',
    });
  });

  it('rejects invalid pagination rather than sending an invalid request', async () => {
    await expect(fetchEmployeeApplications(0, 20)).rejects.toBeInstanceOf(EmployeeApplicationsApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces network failures instead of returning a fallback', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network unavailable'));

    await expect(fetchEmployeeApplications(1, 20)).rejects.toMatchObject({ kind: 'network' });
  });
});

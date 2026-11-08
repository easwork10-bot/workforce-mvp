import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelEmployeeApplication, fetchEmployeeApplications } from '@/frontend/features/employee-applications/employeeApplicationsApi';

describe('employee applications API', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches a paginated authenticated application history', async () => {
    const body = { applications: [], pagination: { page: 2, limit: 10, total: 11, totalPages: 2 } };
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(fetchEmployeeApplications(2, 10)).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith('/api/employee/applications?page=2&limit=10',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
  });

  it('fetches CSRF and submits cancellation with an encoded ID', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ csrfToken: 'token' }))
      .mockResolvedValueOnce(Response.json({ success: true, code: 'APPLICATION_CANCELLED' }));
    await expect(cancelEmployeeApplication('application/one')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/employee/applications/application%2Fone/cancel',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', headers: expect.objectContaining({ 'x-csrf-token': 'token' }) }));
  });

  it('rejects conflicts and malformed cancellation success', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ csrfToken: 'token' }))
      .mockResolvedValueOnce(Response.json({ error: 'Conflict' }, { status: 409 }));
    await expect(cancelEmployeeApplication('one')).rejects.toMatchObject({ kind: 'invalid', status: 409 });
    fetchMock.mockResolvedValueOnce(Response.json({ csrfToken: 'token' }))
      .mockResolvedValueOnce(Response.json({ success: true, code: 'UNKNOWN' }));
    await expect(cancelEmployeeApplication('one')).rejects.toMatchObject({ kind: 'server' });
  });

  it('does not cancel when the CSRF response is invalid', async () => {
    fetchMock.mockResolvedValue(Response.json({ csrfToken: '' }));
    await expect(cancelEmployeeApplication('one')).rejects.toMatchObject({ kind: 'csrf' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

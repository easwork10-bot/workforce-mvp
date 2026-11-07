import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAdminApplications, reviewAdminApplication } from '@/frontend/features/admin-applications/adminApplicationsApi';

const id = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
describe('admin application browser API', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  it('requests filtered pages with credentials and abort support', async () => {
    const signal = new AbortController().signal;
    fetchMock.mockResolvedValue(Response.json({ applications: [], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 } }));
    await fetchAdminApplications(2, 'cancelled', signal);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/applications?page=2&limit=20&status=cancelled',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', signal }));
  });

  it('requests all attempts without a status parameter', async () => {
    fetchMock.mockResolvedValue(Response.json({ applications: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }));
    await fetchAdminApplications(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/applications?page=1&limit=20');
  });

  it.each(['accepted', 'rejected'] as const)('sends authenticated CSRF-protected %s decisions', async status => {
    fetchMock.mockResolvedValueOnce(Response.json({ csrfToken: 'signed-token' }))
      .mockResolvedValueOnce(Response.json({ success: true, code: 'APPLICATION_REVIEWED', replayed: true }));
    await expect(reviewAdminApplication(id, status, 'Reason')).resolves.toEqual({
      success: true, code: 'APPLICATION_REVIEWED', replayed: true,
    });
    expect(fetchMock.mock.calls[1]).toEqual([`/api/admin/applications/${id}/review`, expect.objectContaining({
      method: 'POST', credentials: 'same-origin', headers: expect.objectContaining({ 'x-csrf-token': 'signed-token' }),
      body: JSON.stringify({ status, ...(status === 'rejected' ? { rejectionReason: 'Reason' } : {}) }),
    })]);
  });

  it.each(['APPLICATION_DECISION_CONFLICT', 'SHIFT_UNAVAILABLE', 'CAPACITY_REACHED', 'ACTIVE_ASSIGNMENT_EXISTS', 'APPLICATION_NOT_FOUND'])(
    'preserves machine-readable %s', async code => {
      fetchMock.mockResolvedValueOnce(Response.json({ csrfToken: 'signed-token' }))
        .mockResolvedValueOnce(Response.json({ code, error: 'Do not show untranslated server text' }, { status: 409 }));
      await expect(reviewAdminApplication(id, 'accepted')).rejects.toMatchObject({ code, status: 409 });
    },
  );

  it('does not submit without a valid security token', async () => {
    fetchMock.mockResolvedValue(Response.json({ csrfToken: '' }));
    await expect(reviewAdminApplication(id, 'accepted')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed success payloads', async () => {
    fetchMock.mockResolvedValue(Response.json({ applications: [], pagination: { total: -1 } }));
    await expect(fetchAdminApplications(1)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('preserves network failures for localized feedback', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network unavailable'));
    await expect(fetchAdminApplications(1)).rejects.toThrow('Network unavailable');
  });
});

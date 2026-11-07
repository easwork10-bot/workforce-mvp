import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelAdminAssignment, fetchAdminAssignments } from '@/frontend/features/admin-assignments/adminAssignmentsApi';
import { assignmentStatuses } from '@/shared/admin-assignments';

const id = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
const assignment = {
  id, shiftId: id, employeeId: id, assignedBy: id, applicationId: null,
  status: 'assigned', assignedAt: '2026-11-01T10:00:00.000Z', confirmedAt: null,
  employee: { id, fullName: 'API employee' },
  shift: { id, title: 'API shift', location: 'Amsterdam', startAt: '2026-11-02T08:00:00.000Z', endAt: '2026-11-02T16:00:00.000Z' },
};
const page = { assignments: [assignment], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } };

describe('admin assignments browser API', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  it('validates and returns actual assignment response fields', async () => {
    fetchMock.mockResolvedValue(Response.json(page));
    await expect(fetchAdminAssignments(1)).resolves.toEqual(page);
  });

  it.each(assignmentStatuses)('requests server-side %s filtering with cookies, no cache and abort support', async status => {
    const signal = new AbortController().signal;
    fetchMock.mockResolvedValue(Response.json({ ...page, pagination: { page: 2, limit: 20, total: 21, totalPages: 2 } }));
    await fetchAdminAssignments(2, status, signal);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/admin/assignments?page=2&limit=20&status=${status}`, {
      credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' },
    });
  });

  it('omits status for All and sends no mutation or CSRF request', async () => {
    fetchMock.mockResolvedValue(Response.json(page));
    await fetchAdminAssignments(1);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/assignments?page=1&limit=20', {
      credentials: 'same-origin', cache: 'no-store', signal: undefined, headers: { Accept: 'application/json' },
    });
  });

  it.each([401, 403, 503, 500])('preserves HTTP %s even when the error body is not JSON', async status => {
    fetchMock.mockResolvedValue(new Response('Untranslated internal error', { status }));
    await expect(fetchAdminAssignments(1)).rejects.toMatchObject({ name: 'AdminAssignmentApiError', status });
  });

  it.each([
    { ...page, assignments: [{ ...assignment, status: 'accepted' }] },
    { ...page, assignments: [{ ...assignment, assignedAt: 'invalid-date' }] },
    { ...page, assignments: [{ ...assignment, shift: null }] },
    { ...page, pagination: { ...page.pagination, total: -1 } },
    { ...page, assignments: undefined },
  ])('rejects malformed response %j', async body => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(fetchAdminAssignments(1)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects invalid JSON', async () => {
    fetchMock.mockResolvedValue(new Response('not JSON'));
    await expect(fetchAdminAssignments(1)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('preserves network and abort failures for the caller', async () => {
    for (const failure of [new TypeError('Network unavailable'), new DOMException('Cancelled', 'AbortError')]) {
      fetchMock.mockRejectedValue(failure);
      await expect(fetchAdminAssignments(1)).rejects.toBe(failure);
    }
  });

  it.each([false, true])('fetches real CSRF and validates cancellation with replayed=%s', async replayed => {
    fetchMock.mockResolvedValueOnce(Response.json({ csrfToken: 'real-csrf-token' }))
      .mockResolvedValueOnce(Response.json({ success: true, code: 'ASSIGNMENT_CANCELLED', replayed }));
    await expect(cancelAdminAssignment(id)).resolves.toMatchObject({ replayed });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/csrf', {
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/admin/assignments/${id}/cancel`, {
      method: 'POST', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'x-csrf-token': 'real-csrf-token' },
    });
  });

  it.each([{}, { csrfToken: '' }, { csrfToken: 1 }])('does not POST with malformed CSRF %j', async token => {
    fetchMock.mockResolvedValueOnce(Response.json(token));
    await expect(cancelAdminAssignment(id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    {}, { success: false, code: 'ASSIGNMENT_CANCELLED', replayed: false },
    { success: true, code: 'APPLICATION_REVIEWED', replayed: false },
    { success: true, code: 'ASSIGNMENT_CANCELLED' },
    { success: true, code: 'ASSIGNMENT_CANCELLED', replayed: 'true' },
  ])('never claims success for malformed cancellation %j', async body => {
    fetchMock.mockResolvedValueOnce(Response.json({ csrfToken: 'token' })).mockResolvedValueOnce(Response.json(body));
    await expect(cancelAdminAssignment(id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    [404, 'ASSIGNMENT_NOT_FOUND'], [409, 'ASSIGNMENT_STATE_CONFLICT'], [409, 'SHIFT_STARTED'],
    [409, 'ATTENDANCE_EXISTS'], [400, 'INVALID_REQUEST'], [500, 'INTERNAL_ERROR'],
    [401, undefined], [403, undefined], [503, undefined],
  ] as const)('preserves cancellation HTTP %s code %s', async (status, code) => {
    fetchMock.mockResolvedValueOnce(Response.json({ csrfToken: 'token' }))
      .mockResolvedValueOnce(Response.json({ error: 'Do not display raw errors', code }, { status }));
    await expect(cancelAdminAssignment(id)).rejects.toMatchObject({ status, code });
  });

  it.each([401, 403, 503, 500])('does not POST after CSRF HTTP %s failure', async status => {
    fetchMock.mockResolvedValueOnce(new Response('not JSON', { status }));
    await expect(cancelAdminAssignment(id)).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['csrf', 'post'] as const)('preserves %s network failures without automatic mutation retries', async phase => {
    const failure = new TypeError('Network unavailable');
    if (phase === 'post') fetchMock.mockResolvedValueOnce(Response.json({ csrfToken: 'token' }));
    fetchMock.mockRejectedValueOnce(failure);
    await expect(cancelAdminAssignment(id)).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(phase === 'post' ? 2 : 1);
  });

  it('encodes the selected identifier in the mutation URL', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ csrfToken: 'token' }))
      .mockResolvedValueOnce(Response.json({ success: true, code: 'ASSIGNMENT_CANCELLED', replayed: false }));
    await cancelAdminAssignment('unsafe/id?');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/assignments/unsafe%2Fid%3F/cancel');
  });
});

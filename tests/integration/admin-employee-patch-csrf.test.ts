import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { generateCsrfToken, signCsrfToken } from '@/backend/security/csrf';

const mocks = vi.hoisted(() => ({
  verifyTokenFromCookie: vi.fn(),
  getSession: vi.fn(),
  updateEmployee: vi.fn(),
  getAuditMetadata: vi.fn(),
}));

vi.mock('@/backend/auth/tokens', () => ({
  verifyTokenFromCookie: mocks.verifyTokenFromCookie,
}));

vi.mock('@/backend/auth/session', () => ({
  getSession: mocks.getSession,
}));

vi.mock('@/backend/db/queries/employees', () => ({
  getEmployeeById: vi.fn(),
  updateEmployee: mocks.updateEmployee,
}));

vi.mock('@/backend/security/auditLogger', () => ({
  getAuditMetadata: mocks.getAuditMetadata,
}));

import { PATCH } from '@/app/api/admin/employees/[id]/route';

const employeeId = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
const employeeParams = { params: { id: employeeId } };
const validBody = { fullName: 'Updated Employee' };
const auditMetadata = { ipAddress: 'hashed-ip-address', userAgent: 'test-agent' };

type RequestOptions = {
  body?: unknown;
  csrfCookie?: string;
  csrfHeader?: string;
};

function createRequest(options: RequestOptions = {}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.csrfCookie) headers.set('cookie', `csrf_token=${options.csrfCookie}`);
  if (options.csrfHeader) headers.set('x-csrf-token', options.csrfHeader);

  return new NextRequest('http://localhost:3000/api/admin/employees/' + employeeId, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(options.body ?? validBody),
  });
}

function matchingCsrfOptions(body: unknown = validBody): RequestOptions {
  const signedToken = signCsrfToken(generateCsrfToken());
  return { body, csrfCookie: signedToken, csrfHeader: signedToken };
}

describe('PATCH /api/admin/employees/[id] CSRF protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyTokenFromCookie.mockResolvedValue({ sub: 'admin-user', jti: 'admin-session' });
    mocks.getSession.mockResolvedValue({ role: 'administrator' });
    mocks.updateEmployee.mockResolvedValue(true);
    mocks.getAuditMetadata.mockReturnValue(auditMetadata);
  });

  it('preserves the unauthenticated response before CSRF validation', async () => {
    mocks.verifyTokenFromCookie.mockResolvedValue(null);

    const response = await PATCH(createRequest(), employeeParams);

    expect(response.status).toBe(401);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.updateEmployee).not.toHaveBeenCalled();
  });

  it('preserves the non-admin permission check before CSRF validation', async () => {
    mocks.getSession.mockResolvedValue({ role: 'employee' });

    const response = await PATCH(createRequest(), employeeParams);

    expect(response.status).toBe(403);
    expect(mocks.updateEmployee).not.toHaveBeenCalled();
  });

  it('rejects an authenticated admin PATCH without a CSRF token', async () => {
    const response = await PATCH(createRequest(), employeeParams);

    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('CSRF');
    expect(mocks.updateEmployee).not.toHaveBeenCalled();
  });

  it.each([
    ['missing CSRF cookie', { csrfHeader: signCsrfToken('header-token') }],
    ['missing CSRF header', { csrfCookie: signCsrfToken('cookie-token') }],
    [
      'mismatched CSRF cookie and header',
      {
        csrfCookie: signCsrfToken('cookie-token'),
        csrfHeader: signCsrfToken('header-token'),
      },
    ],
  ])('rejects a request with %s without updating the employee', async (_label, options) => {
    const response = await PATCH(createRequest(options), employeeParams);

    expect(response.status).toBe(403);
    expect(mocks.updateEmployee).not.toHaveBeenCalled();
  });

  it('rejects invalid employee input without updating or auditing', async () => {
    const response = await PATCH(
      createRequest(matchingCsrfOptions({ fullName: 'x' })),
      employeeParams
    );

    expect(response.status).toBe(400);
    expect(mocks.updateEmployee).not.toHaveBeenCalled();
    expect(mocks.getAuditMetadata).not.toHaveBeenCalled();
  });

  it('updates and audits an authenticated admin request with matching CSRF credentials', async () => {
    const response = await PATCH(
      createRequest(matchingCsrfOptions(validBody)),
      employeeParams
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: 'Employee updated successfully',
    });
    expect(mocks.updateEmployee).toHaveBeenCalledOnce();
    expect(mocks.updateEmployee.mock.calls[0][0]).toBe(employeeId);
    expect(mocks.updateEmployee.mock.calls[0][1]).toBe('admin-user');
    expect(mocks.updateEmployee.mock.calls[0][5]).toEqual(auditMetadata);
  });
});

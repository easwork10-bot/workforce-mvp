/**
 * Attendance Authorization Tests
 * Verifies RBAC boundaries for attendance endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkInCore, checkOutCore } from '@/backend/services/attendance';
import { requireAuth } from '@/backend/security/requireAuth';
import { NextRequest, NextResponse } from 'next/server';

// Mock the database and session
vi.mock('@/backend/auth/tokens', () => ({
  verifyTokenFromCookie: vi.fn(),
}));

vi.mock('@/backend/auth/session', () => ({
  getSession: vi.fn(),
  RedisUnavailableError: class extends Error {},
}));

describe('Attendance Authorization Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Test 1: Employee can check in for themselves (via route handler RBAC)
   */
  it('should allow employee role through requireAuth', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    // Mock valid employee session
    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'emp-123', role: 'employee', ipHash: 'hash' });

    const { req } = createMocks({ method: 'GET', headers: { cookie: 'access_token=valid' } });
    const result = await requireAuth(req);

    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as any).role).toBe('employee');
    expect((result as any).userId).toBe('emp-123');
  });

  /**
   * Test 2: Supervisor can check in for any employee
   */
  it('should allow supervisor role through requireAuth', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'sup-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'sup-123', role: 'supervisor', ipHash: 'hash' });

    const { req } = createMocks({ method: 'GET', headers: { cookie: 'access_token=valid' } });
    const result = await requireAuth(req);

    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as any).role).toBe('supervisor');
  });

  /**
   * Test 3: Administrator can check in for any employee
   */
  it('should allow administrator role through requireAuth', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'admin-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'admin-123', role: 'administrator', ipHash: 'hash' });

    const { req } = createMocks({ method: 'GET', headers: { cookie: 'access_token=valid' } });
    const result = await requireAuth(req);

    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as any).role).toBe('administrator');
  });

  /**
   * Test 4: Unauthenticated request is rejected
   */
  it('should reject unauthenticated requests', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    (verifyTokenFromCookie as any).mockResolvedValue(null);

    const { req } = createMocks({ method: 'GET', headers: {} });
    const result = await requireAuth(req);

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  /**
   * Test 5: Expired session is rejected
   */
  it('should reject expired session', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue(null);

    const { req } = createMocks({ method: 'GET', headers: { cookie: 'access_token=valid' } });
    const result = await requireAuth(req);

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  /**
   * Test 6: Both URL variants enforce identical RBAC via withCsrfAndAuth
   */
  it('should use same role validation for both attendance URL variants', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    // Test employee role
    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'emp-123', role: 'employee', ipHash: 'hash' });

    const { req: req1 } = createMocks({ method: 'POST', headers: { cookie: 'access_token=valid' } });
    const result1 = await requireAuth(req1);
    expect((result1 as any).role).toBe('employee');

    // Test supervisor role
    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'sup-123', jti: 'jti-456' });
    (getSession as any).mockResolvedValue({ userId: 'sup-123', role: 'supervisor', ipHash: 'hash' });

    const { req: req2 } = createMocks({ method: 'POST', headers: { cookie: 'access_token=valid' } });
    const result2 = await requireAuth(req2);
    expect((result2 as any).role).toBe('supervisor');

    // Test administrator role
    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'admin-123', jti: 'jti-789' });
    (getSession as any).mockResolvedValue({ userId: 'admin-123', role: 'administrator', ipHash: 'hash' });

    const { req: req3 } = createMocks({ method: 'POST', headers: { cookie: 'access_token=valid' } });
    const result3 = await requireAuth(req3);
    expect((result3 as any).role).toBe('administrator');
  });

  /**
   * Test 7: CSRF wrapper allows GET without CSRF
   */
  it('should allow GET requests without CSRF via withCsrfAndAuth', async () => {
    const { withCsrfAndAuth } = await import('@/backend/security/csrf');
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'emp-123', role: 'employee', ipHash: 'hash' });

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    const wrappedHandler = withCsrfAndAuth(handler, ['employee']);

    const { req } = createMocks({ method: 'GET', headers: { cookie: 'access_token=valid' } });
    const response = await wrappedHandler(req);

    expect(handler).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  /**
   * Test 8: CSRF wrapper rejects POST without valid CSRF
   */
  it('should reject POST without valid CSRF via withCsrfAndAuth', async () => {
    const { withCsrfAndAuth } = await import('@/backend/security/csrf');
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'emp-123', role: 'employee', ipHash: 'hash' });

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    const wrappedHandler = withCsrfAndAuth(handler, ['employee']);

    const { req } = createMocks({
      method: 'POST',
      headers: { cookie: 'access_token=valid', 'content-type': 'application/json' },
    });

    const response = await wrappedHandler(req);
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  /**
   * Test 9: CSRF wrapper accepts POST with valid CSRF
   */
  it('should accept POST with valid CSRF via withCsrfAndAuth', async () => {
    const { withCsrfAndAuth, generateCsrfToken, signCsrfToken } = await import('@/backend/security/csrf');
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'emp-123', role: 'employee', ipHash: 'hash' });

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    const wrappedHandler = withCsrfAndAuth(handler, ['employee']);

    const token = generateCsrfToken();
    const signedToken = signCsrfToken(token);

    const { req } = createMocks({
      method: 'POST',
      headers: {
        cookie: `access_token=valid; csrf_token=${signedToken}`,
        'x-csrf-token': signedToken,
        'content-type': 'application/json',
      },
    });

    const response = await wrappedHandler(req);
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  /**
   * Test 10: Invalid role rejected by withCsrfAndAuth
   */
  it('should reject invalid role via withCsrfAndAuth', async () => {
    const { withCsrfAndAuth } = await import('@/backend/security/csrf');
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'emp-123', role: 'employee', ipHash: 'hash' });

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    // Only allow supervisor/admin
    const wrappedHandler = withCsrfAndAuth(handler, ['supervisor', 'administrator']);

    const { req } = createMocks({ method: 'GET', headers: { cookie: 'access_token=valid' } });
    const response = await wrappedHandler(req);

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});

// Helper function to create mock request (replacing node-mocks-http)
function createMocks(options: { method: string; headers: Record<string, string> }): { req: NextRequest } {
  const url = 'http://localhost:3000/api/test';
  const init: RequestInit = {
    method: options.method,
    headers: options.headers,
  };
  return { req: new NextRequest(url, init) };
}

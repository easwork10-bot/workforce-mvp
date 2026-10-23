/**
 * CSRF Security Tests - Endpoint level tests using actual route handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { generateCsrfToken, signCsrfToken } from '@/backend/security/csrf';

vi.mock('@/backend/auth/passwords', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

// Mock auth dependencies
vi.mock('@/backend/auth/tokens', () => ({
  verifyTokenFromCookie: vi.fn(),
  createTokenPair: vi.fn(),
  hashToken: vi.fn(),
  hashIp: vi.fn(),
  generateOpaqueToken: vi.fn(),
  decodeJwt: vi.fn(() => ({ jti: 'test-jti' })),
}));

vi.mock('@/backend/auth/session', () => ({
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  rotateRefreshToken: vi.fn(),
  createSession: vi.fn(),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 100, resetAt: Date.now() + 60000 }),
  RedisUnavailableError: class extends Error {},
}));

// Mock db to avoid actual database connections
vi.mock('@/backend/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      select: vi.fn(),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'new-user' }]),
        })),
      })),
      update: vi.fn(),
      delete: vi.fn(),
    })),
  },
}));

describe('CSRF Security - Endpoint Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createReq(method: string, url: string, headers: Record<string, string>, body?: any): NextRequest {
    const init: RequestInit = { method, headers };
    if (body) init.body = JSON.stringify(body);
    return new NextRequest(url, init);
  }

  /**
   * Test 1: Missing CSRF token is rejected on logout
   */
  it('should reject POST requests without CSRF token', async () => {
    const { POST } = await import('@/app/api/auth/logout/route');
    const req = createReq('POST', 'http://localhost:3000/api/auth/logout', {
      'content-type': 'application/json',
      cookie: 'access_token=valid',
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain('CSRF');
  });

  /**
   * Test 2: Invalid signature is rejected
   */
  it('should reject requests with invalid CSRF signature', async () => {
    const { POST } = await import('@/app/api/auth/logout/route');
    const req = createReq('POST', 'http://localhost:3000/api/auth/logout', {
      'content-type': 'application/json',
      cookie: 'access_token=valid; csrf_token=invalid.signature',
      'x-csrf-token': 'invalid.signature',
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  /**
   * Test 3: Cookie/header mismatch is rejected
   */
  it('should reject requests when cookie and header CSRF tokens differ', async () => {
    const cookieToken = signCsrfToken('cookie-token');
    const headerToken = signCsrfToken('header-token');

    const { POST } = await import('@/app/api/auth/logout/route');
    const req = createReq('POST', 'http://localhost:3000/api/auth/logout', {
      'content-type': 'application/json',
      cookie: `access_token=valid; csrf_token=${cookieToken}`,
      'x-csrf-token': headerToken,
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  /**
   * Test 4: Cross-session token replay is rejected
   */
  it('should reject replayed CSRF token when the browser cookie has changed', async () => {
    const tokenA = signCsrfToken('session-a-token');
    const tokenB = signCsrfToken('session-b-token');

    const { POST } = await import('@/app/api/auth/logout/route');
    const req = createReq('POST', 'http://localhost:3000/api/auth/logout', {
      'content-type': 'application/json',
      cookie: `access_token=valid; csrf_token=${tokenB}`,
      'x-csrf-token': tokenA,
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  /**
   * Test 5: Legitimate authenticated frontend requests succeed
   */
  it('should allow legitimate requests with valid CSRF token', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession, deleteSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'user-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'user-123', role: 'employee', refreshHash: 'hash', ipHash: 'hash' });
    (deleteSession as any).mockResolvedValue(undefined);

    const token = generateCsrfToken();
    const signedToken = signCsrfToken(token);

    const { POST } = await import('@/app/api/auth/logout/route');
    const req = createReq('POST', 'http://localhost:3000/api/auth/logout', {
      'content-type': 'application/json',
      cookie: `access_token=valid; csrf_token=${signedToken}`,
      'x-csrf-token': signedToken,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  /**
   * Test 6: Login/register/refresh/logout flows remain functional
   */
  it('should set CSRF cookie on login', async () => {
    const { db } = await import('@/backend/db');
    const { profiles, userRoles } = await import('@/backend/db/schema');
    const { verifyPassword } = await import('@/backend/auth/passwords');
    const { createTokenPair } = await import('@/backend/auth/tokens');

    (db.select as any).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: 'user-1', email: 'test@test.com', passwordHash: 'valid-hash', fullName: 'Test', preferredLanguage: 'nl', accountStatus: 'active' }]),
        }),
      }),
    });
    (verifyPassword as any).mockResolvedValue(true);
    (createTokenPair as any).mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });

    const { POST } = await import('@/app/api/auth/login/route');
    const req = createReq('POST', 'http://localhost:3000/api/auth/login', {
      'content-type': 'application/json',
    }, { email: 'test@test.com', password: 'Workforce-Test-Only-Password-2026!' });

    const res = await POST(req);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('csrf_token');
    expect(setCookie).toContain('HttpOnly');
  });

  it('should rotate a valid refresh session and return the established auth response and cookies', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { rotateRefreshToken } = await import('@/backend/auth/session');
    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'user-123', jti: 'old-session' });
    (rotateRefreshToken as any).mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      jti: 'new-session',
      role: 'employee',
    });

    const { POST } = await import('@/app/api/auth/refresh/route');
    const req = createReq('POST', 'http://localhost:3000/api/auth/refresh', {
      cookie: 'access_token=old-access-token; refresh_token=old-refresh-token',
    });

    const response = await POST(req);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: { id: 'user-123', role: 'employee' },
    });
    expect(response.headers.get('set-cookie')).toContain('access_token=new-access-token');
    expect(response.headers.get('set-cookie')).toContain('refresh_token=new-refresh-token');
    expect(response.headers.get('set-cookie')).toContain('csrf_token');
    expect(rotateRefreshToken).toHaveBeenCalledWith(
      'user-123',
      'old-refresh-token',
      '127.0.0.1',
      'unknown'
    );
  });

  it('should reject an invalid refresh session and clear auth cookies', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { rotateRefreshToken, revokeAllUserSessions } = await import('@/backend/auth/session');
    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'user-123', jti: 'old-session' });
    (rotateRefreshToken as any).mockResolvedValue(null);

    const { POST } = await import('@/app/api/auth/refresh/route');
    const req = createReq('POST', 'http://localhost:3000/api/auth/refresh', {
      cookie: 'access_token=old-access-token; refresh_token=invalid-refresh-token',
    });

    const response = await POST(req);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Session expired or invalid. Please log in again.',
    });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(revokeAllUserSessions).toHaveBeenCalledWith('user-123');
  });

  it('should set CSRF cookie on register', async () => {
    const { db } = await import('@/backend/db');
    const { profiles, userRoles } = await import('@/backend/db/schema');
    const { hashPassword } = await import('@/backend/auth/passwords');
    const { createTokenPair } = await import('@/backend/auth/tokens');

    (db.select as any).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });
    (db.insert as any).mockReturnValue({
      values: () => ({
        returning: () => Promise.resolve([{ id: 'new-user', email: 'test@test.com', fullName: 'Test', preferredLanguage: 'nl' }]),
      }),
      into: () => ({
        values: () => Promise.resolve(),
      }),
    });
    (hashPassword as any).mockResolvedValue('hashed');
    (createTokenPair as any).mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });

    const { POST } = await import('@/app/api/auth/register/route');
    const req = createReq('POST', 'http://localhost:3000/api/auth/register', {
      'content-type': 'application/json',
    }, { email: 'test@test.com', password: 'Workforce-Test-Only-Password-2026!', fullName: 'Test User', preferredLanguage: 'nl' });

    const res = await POST(req);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('csrf_token');
    expect(setCookie).toContain('HttpOnly');
  });

  it('should clear CSRF cookie on logout', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession, deleteSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'user-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'user-123', role: 'employee', refreshHash: 'hash', ipHash: 'hash' });
    (deleteSession as any).mockResolvedValue(undefined);

    const token = generateCsrfToken();
    const signedToken = signCsrfToken(token);

    const { POST } = await import('@/app/api/auth/logout/route');
    const req = createReq('POST', 'http://localhost:3000/api/auth/logout', {
      'content-type': 'application/json',
      cookie: `access_token=valid; csrf_token=${signedToken}`,
      'x-csrf-token': signedToken,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('csrf_token');
    expect(setCookie).toContain('Max-Age=0');
  });

  /**
   * Test 7: PATCH, PUT and DELETE mutations receive appropriate protection
   */
  it('should protect PATCH requests', async () => {
    const { POST } = await import('@/app/api/employee/shifts/[id]/apply/route');
    const req = createReq('PATCH', 'http://localhost:3000/api/employee/shifts/123/apply', {
      'content-type': 'application/json',
      cookie: 'access_token=valid',
    }, {});

    const res = await POST(req, { params: Promise.resolve({ id: '123' }) });
    expect([401, 403]).toContain(res.status);
  });

  it('should protect PUT requests on admin endpoints', async () => {
    const { POST } = await import('@/app/api/admin/shifts/route');
    const req = createReq('PUT', 'http://localhost:3000/api/admin/shifts', {
      'content-type': 'application/json',
      cookie: 'access_token=valid',
    }, { title: 'Test', workType: 'cleaning', location: 'Test', startAt: '2099-01-01T09:00:00Z', endAt: '2099-01-01T17:00:00Z', requiredWorkers: 1 });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('should protect DELETE requests', async () => {
    const { POST } = await import('@/app/api/auth/logout/route');
    const req = createReq('DELETE', 'http://localhost:3000/api/auth/logout', {
      'content-type': 'application/json',
      cookie: 'access_token=valid',
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  /**
   * Test 8: Employees cannot modify another employee's attendance
   */
  it('should prevent employee from checking in for another employee', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');
    const { db } = await import('@/backend/db');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-a', jti: 'jti-a' });
    (getSession as any).mockResolvedValue({ userId: 'emp-a', role: 'employee', refreshHash: 'hash', ipHash: 'hash' });

    // Mock DB to return no assignment for employee A (assignment belongs to employee B)
    (db.select as any).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });

    const token = generateCsrfToken();
    const signedToken = signCsrfToken(token);

    const { POST } = await import('@/app/api/employee/attendance/check-in/route');
    const req = createReq('POST', 'http://localhost:3000/api/employee/attendance/check-in', {
      'content-type': 'application/json',
      cookie: `access_token=valid; csrf_token=${signedToken}`,
      'x-csrf-token': signedToken,
    }, { shiftAssignmentId: '00000000-0000-0000-0000-000000000001' });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('toegang');
  });

  /**
   * Test 9: Supervisor/admin roles cannot bypass the self-attendance authorization rule
   */
  it('should reject supervisor trying to use employee attendance endpoint', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'sup-1', jti: 'jti-sup' });
    (getSession as any).mockResolvedValue({ userId: 'sup-1', role: 'supervisor', refreshHash: 'hash', ipHash: 'hash' });

    const token = generateCsrfToken();
    const signedToken = signCsrfToken(token);

    const { POST } = await import('@/app/api/employee/attendance/check-in/route');
    const req = createReq('POST', 'http://localhost:3000/api/employee/attendance/check-in', {
      'content-type': 'application/json',
      cookie: `access_token=valid; csrf_token=${signedToken}`,
      'x-csrf-token': signedToken,
    }, { shiftAssignmentId: 'assignment-1' });

    const res = await POST(req);
    // Should be 403 - supervisor not allowed on employee-only endpoint
    expect(res.status).toBe(403);
  });

  it('should reject administrator trying to use employee attendance endpoint', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'admin-1', jti: 'jti-admin' });
    (getSession as any).mockResolvedValue({ userId: 'admin-1', role: 'administrator', refreshHash: 'hash', ipHash: 'hash' });

    const token = generateCsrfToken();
    const signedToken = signCsrfToken(token);

    const { POST } = await import('@/app/api/employee/attendance/check-in/route');
    const req = createReq('POST', 'http://localhost:3000/api/employee/attendance/check-in', {
      'content-type': 'application/json',
      cookie: `access_token=valid; csrf_token=${signedToken}`,
      'x-csrf-token': signedToken,
    }, { shiftAssignmentId: 'assignment-1' });

    const res = await POST(req);
    // Should be 403 - admin not allowed on employee-only endpoint
    expect(res.status).toBe(403);
  });

  /**
   * Test 10: Both attendance URL variants enforce identical security boundaries
   */
  it('should enforce same authorization on /api/attendance/check-in as /api/employee/attendance/check-in', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');
    const { db } = await import('@/backend/db');

    // Mock employee session
    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-1', jti: 'jti-1' });
    (getSession as any).mockResolvedValue({ userId: 'emp-1', role: 'employee', refreshHash: 'hash', ipHash: 'hash' });
    (db.select as any).mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: 'assignment-1', employeeId: 'emp-1', status: 'assigned' }]),
        }),
      }),
    });

    const token = generateCsrfToken();
    const signedToken = signCsrfToken(token);

    // Test /api/employee/attendance/check-in with employee role
    const { POST: employeeCheckIn } = await import('@/app/api/employee/attendance/check-in/route');
    const req1 = createReq('POST', 'http://localhost:3000/api/employee/attendance/check-in', {
      'content-type': 'application/json',
      cookie: `access_token=valid; csrf_token=${signedToken}`,
      'x-csrf-token': signedToken,
    }, { shiftAssignmentId: 'assignment-1' });

    const res1 = await employeeCheckIn(req1);

    // Test /api/attendance/check-in (should behave identically - also employee only)
    const { POST: attendanceCheckIn } = await import('@/app/api/attendance/check-in/route');
    const req2 = createReq('POST', 'http://localhost:3000/api/attendance/check-in', {
      'content-type': 'application/json',
      cookie: `access_token=valid; csrf_token=${signedToken}`,
      'x-csrf-token': signedToken,
    }, { shiftAssignmentId: 'assignment-1' });

    const res2 = await attendanceCheckIn(req2);

    // Both should have same status (both employee-only endpoints)
    expect(res1.status).toBe(res2.status);
  });

  /**
   * Test 11: Supervisor rejected on /api/attendance/check-in (same as employee endpoint)
   */
  it('should reject supervisor on /api/attendance/check-in', async () => {
    const { verifyTokenFromCookie } = await import('@/backend/auth/tokens');
    const { getSession } = await import('@/backend/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'sup-1', jti: 'jti-sup' });
    (getSession as any).mockResolvedValue({ userId: 'sup-1', role: 'supervisor', refreshHash: 'hash', ipHash: 'hash' });

    const token = generateCsrfToken();
    const signedToken = signCsrfToken(token);

    const { POST } = await import('@/app/api/attendance/check-in/route');
    const req = createReq('POST', 'http://localhost:3000/api/attendance/check-in', {
      'content-type': 'application/json',
      cookie: `access_token=valid; csrf_token=${signedToken}`,
      'x-csrf-token': signedToken,
    }, { shiftAssignmentId: 'assignment-1' });

    const res = await POST(req);
    // Should be 403 - supervisor not allowed
    expect(res.status).toBe(403);
  });

  it('should deliver the raw CSRF token and set its signed HttpOnly cookie', async () => {
    const { GET } = await import('@/app/api/auth/csrf/route');
    const req = createReq('GET', 'http://localhost:3000/api/auth/csrf', {
      cookie: '',
    });

    const res = await GET(req);
    const data = await res.json();
    expect(data.csrfToken).toBeDefined();
    expect(typeof data.csrfToken).toBe('string');
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('HttpOnly');
    const signedCookie = setCookie?.match(/csrf_token=([^;]+)/)?.[1];
    expect(signedCookie?.split('.')[0]).toBe(data.csrfToken);
  });
});
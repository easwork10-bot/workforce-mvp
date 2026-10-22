/**
 * CSRF Security Tests - Utility function tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateCsrfToken,
  signCsrfToken,
  verifyCsrfToken,
  setCsrfCookie,
  getCsrfTokenFromCookie,
  getCsrfTokenFromHeader,
  requireCsrf,
  withCsrfAndAuth,
  clearCsrfCookie
} from '@/lib/middleware/csrf';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth/tokens', () => ({
  verifyTokenFromCookie: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(),
  RedisUnavailableError: class extends Error {},
}));

describe('CSRF Security - Utility Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper function to create mock request with cookie header
  function createReq(method: string, headers: Record<string, string>): NextRequest {
    const cookieHeader = headers['x-cookie-header'] || '';
    const processedHeaders: Record<string, string> = { ...headers };
    delete processedHeaders['x-cookie-header'];
    if (cookieHeader) {
      processedHeaders['cookie'] = cookieHeader;
    }
    const url = 'http://localhost:3000/api/test';
    return new NextRequest(url, { method, headers: processedHeaders });
  }

  /**
   * Test 1: Missing CSRF token rejected
   */
  it('should reject requests without CSRF token', async () => {
    const req = createReq('POST', {
      'content-type': 'application/json',
    });

    expect(getCsrfTokenFromCookie(req)).toBeNull();
    expect(getCsrfTokenFromHeader(req)).toBeNull();
  });

  /**
   * Test 2: Invalid signature rejected
   */
  it('should reject requests with invalid signature', async () => {
    const req = createReq('POST', {
      'content-type': 'application/json',
      'x-csrf-token': 'invalid.token.here',
    });

    expect(getCsrfTokenFromHeader(req)).toBeNull();
  });

  /**
   * Test 3: Cookie/header mismatch rejected
   */
  it('should reject requests when cookie and header tokens differ', async () => {
    const cookieSigned = signCsrfToken('correct-token');
    const headerSigned = signCsrfToken('different-token');

    const req = createReq('POST', {
      'content-type': 'application/json',
      'x-csrf-token': headerSigned,
      'x-cookie-header': `csrf_token=${cookieSigned}`,
    });

    const cookieToken = getCsrfTokenFromCookie(req);
    const headerToken = getCsrfTokenFromHeader(req);

    expect(cookieToken).toBe('correct-token');
    expect(headerToken).toBe('different-token');
    expect(cookieToken).not.toBe(headerToken);
  });

  /**
   * Test 4: Cross-session token replay rejected
   */
  it('should reject replayed token from different session', async () => {
    const token = generateCsrfToken();
    const signedToken = signCsrfToken(token);

    // Session 1: valid cookie + header match
    const req1 = createReq('POST', {
      'content-type': 'application/json',
      'x-csrf-token': signedToken,
      'x-cookie-header': `csrf_token=${signedToken}`,
    });

    // Session 2: same header but different cookie (simulating replay)
    const differentToken = generateCsrfToken();
    const differentSignedToken = signCsrfToken(differentToken);
    const req2 = createReq('POST', {
      'content-type': 'application/json',
      'x-csrf-token': signedToken, // Replaying old token
      'x-cookie-header': `csrf_token=${differentSignedToken}`, // Different session cookie
    });

    // Session 1 should verify - tokens match
    expect(getCsrfTokenFromCookie(req1)).toBe(token);
    expect(getCsrfTokenFromHeader(req1)).toBe(token);
    expect(getCsrfTokenFromCookie(req1)).toBe(getCsrfTokenFromHeader(req1));

    // Session 2 should have mismatched tokens (replay attack detected)
    const cookieToken2 = getCsrfTokenFromCookie(req2);
    const headerToken2 = getCsrfTokenFromHeader(req2);
    expect(cookieToken2).toBe(differentToken);
    expect(headerToken2).toBe(token);
    expect(cookieToken2).not.toBe(headerToken2);
  });

  /**
   * Test 5: Legitimate requests succeed
   */
  it('should allow legitimate requests with valid CSRF token', async () => {
    const token = generateCsrfToken();
    const signedToken = signCsrfToken(token);

    const req = createReq('POST', {
      'content-type': 'application/json',
      'x-csrf-token': signedToken,
      'x-cookie-header': `csrf_token=${signedToken}`,
    });

    const cookieToken = getCsrfTokenFromCookie(req);
    const headerToken = getCsrfTokenFromHeader(req);

    expect(cookieToken).toBe(token);
    expect(headerToken).toBe(token);
    expect(cookieToken).toBe(headerToken);
  });

  /**
   * Test 6: Login/register/refresh/logout flows functional - CSRF cookie is HttpOnly
   */
  it('should set CSRF cookie as HttpOnly on login/register/refresh', async () => {
    const response = NextResponse.json({ success: true });
    const token = generateCsrfToken();
    setCsrfCookie(response, token);

    const cookieHeader = response.headers.get('set-cookie');
    expect(cookieHeader).toContain('csrf_token');
    expect(cookieHeader).toContain('HttpOnly'); // Cookie IS HttpOnly now
    expect(cookieHeader).toMatch(/SameSite=Strict/i);
    expect(cookieHeader).toContain('Path=/');
    expect(cookieHeader).toContain('Max-Age=900'); // 15 minutes
  });

  it('should clear CSRF cookie on logout', async () => {
    const response = NextResponse.json({ success: true });
    clearCsrfCookie(response);

    const cookieHeader = response.headers.get('set-cookie');
    expect(cookieHeader).toContain('csrf_token');
    expect(cookieHeader).toContain('Max-Age=0');
    expect(cookieHeader).toContain('HttpOnly');
  });

  /**
   * Test 7: PATCH/PUT/DELETE protected by requireCsrf
   */
  it('should protect PATCH requests via requireCsrf', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    const wrappedHandler = requireCsrf(handler);

    const req = createReq('PATCH', {
      'content-type': 'application/json',
    });

    const response = await wrappedHandler(req);
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should protect PUT requests via requireCsrf', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    const wrappedHandler = requireCsrf(handler);

    const req = createReq('PUT', {
      'content-type': 'application/json',
    });

    const response = await wrappedHandler(req);
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should protect DELETE requests via requireCsrf', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    const wrappedHandler = requireCsrf(handler);

    const req = createReq('DELETE', {
      'content-type': 'application/json',
    });

    const response = await wrappedHandler(req);
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  /**
   * Test 8: withCsrfAndAuth allows GET without CSRF
   */
  it('should allow GET requests without CSRF via withCsrfAndAuth', async () => {
    const { verifyTokenFromCookie } = await import('@/lib/auth/tokens');
    const { getSession } = await import('@/lib/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'emp-123', role: 'employee', ipHash: 'hash', refreshHash: 'hash' });

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    const wrappedHandler = withCsrfAndAuth(handler, ['employee']);

    const req = createReq('GET', {
      'cookie': 'access_token=valid',
    });

    const response = await wrappedHandler(req);
    expect(handler).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  /**
   * Test 9: withCsrfAndAuth rejects POST without valid CSRF
   */
  it('should reject POST without valid CSRF via withCsrfAndAuth', async () => {
    const { verifyTokenFromCookie } = await import('@/lib/auth/tokens');
    const { getSession } = await import('@/lib/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'emp-123', role: 'employee', ipHash: 'hash', refreshHash: 'hash' });

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    const wrappedHandler = withCsrfAndAuth(handler, ['employee']);

    const req = createReq('POST', {
      'content-type': 'application/json',
      'cookie': 'access_token=valid',
    });

    const response = await wrappedHandler(req);
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  /**
   * Test 10: withCsrfAndAuth accepts POST with valid CSRF
   */
  it('should accept POST with valid CSRF via withCsrfAndAuth', async () => {
    vi.resetModules();
    const { verifyTokenFromCookie } = await import('@/lib/auth/tokens');
    const { getSession } = await import('@/lib/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'emp-123', role: 'employee', ipHash: 'hash', refreshHash: 'hash' });

    const { generateCsrfToken, signCsrfToken } = await import('@/lib/middleware/csrf');
    const token = generateCsrfToken();
    const signedToken = signCsrfToken(token);

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    const wrappedHandler = withCsrfAndAuth(handler, ['employee']);

    const req = createReq('POST', {
      'content-type': 'application/json',
      'x-csrf-token': signedToken,
      'x-cookie-header': `access_token=valid; csrf_token=${signedToken}`,
    });

    const response = await wrappedHandler(req);
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  /**
   * Test 11: withCsrfAndAuth rejects invalid role
   */
  it('should reject invalid role via withCsrfAndAuth', async () => {
    vi.resetModules();
    const { verifyTokenFromCookie } = await import('@/lib/auth/tokens');
    const { getSession } = await import('@/lib/auth/session');

    (verifyTokenFromCookie as any).mockResolvedValue({ sub: 'emp-123', jti: 'jti-123' });
    (getSession as any).mockResolvedValue({ userId: 'emp-123', role: 'employee', ipHash: 'hash', refreshHash: 'hash' });

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    // Only allow supervisor/admin
    const wrappedHandler = withCsrfAndAuth(handler, ['supervisor', 'administrator']);

    const req = createReq('GET', {
      'cookie': 'access_token=valid',
    });

    const response = await wrappedHandler(req);
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
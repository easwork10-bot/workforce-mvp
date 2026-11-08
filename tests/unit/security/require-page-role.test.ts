import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getCookie: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  verifyAccessToken: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock('@/backend/auth/tokens', () => ({ verifyAccessToken: mocks.verifyAccessToken }));
vi.mock('@/backend/auth/session', () => ({ getSession: mocks.getSession }));

import { requirePageRole } from '@/backend/security/requirePageRole';

describe('protected page authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cookies.mockResolvedValue({ get: mocks.getCookie });
    mocks.getCookie.mockReturnValue({ value: 'access-token' });
    mocks.verifyAccessToken.mockResolvedValue({ jti: 'session-id' });
    mocks.getSession.mockResolvedValue({ role: 'administrator' });
    mocks.notFound.mockImplementation(() => { throw new Error('not found'); });
    mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect ${url}`); });
  });

  it('awaits the cookie store and accepts a matching active session', async () => {
    await expect(requirePageRole('nl', 'administrator')).resolves.toBeUndefined();
    expect(mocks.cookies).toHaveBeenCalledOnce();
    expect(mocks.getCookie).toHaveBeenCalledWith('access_token');
    expect(mocks.verifyAccessToken).toHaveBeenCalledWith('access-token');
    expect(mocks.getSession).toHaveBeenCalledWith('session-id');
  });

  it('rejects unsupported locales before accessing cookies', async () => {
    await expect(requirePageRole('fr', 'employee')).rejects.toThrow('not found');
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it.each(['nl', 'ar'])('redirects an absent session to the %s login page', async locale => {
    mocks.getCookie.mockReturnValue(undefined);

    await expect(requirePageRole(locale, 'employee')).rejects.toThrow(`redirect /${locale}/auth/login`);
    expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('redirects when the access token is invalid', async () => {
    mocks.verifyAccessToken.mockResolvedValue(null);

    await expect(requirePageRole('nl', 'employee')).rejects.toThrow('redirect /nl/auth/login');
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('redirects when a previously issued session has been revoked', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(requirePageRole('ar', 'employee')).rejects.toThrow('redirect /ar/auth/login');
  });

  it('does not expose a page to a session with the wrong role', async () => {
    await expect(requirePageRole('ar', 'employee')).rejects.toThrow('not found');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

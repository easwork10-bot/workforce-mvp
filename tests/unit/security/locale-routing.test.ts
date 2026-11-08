import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import middleware from '@/middleware';

describe('locale middleware', () => {
  it('redirects an unprefixed request to the negotiated locale without losing its query', () => {
    const response = middleware(new NextRequest('https://workforce.example/?from=dashboard', {
      headers: { 'accept-language': 'nl' },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://workforce.example/nl?from=dashboard');
  });

  it('persists an explicitly selected locale for a year and uses it on later visits', () => {
    const selected = middleware(new NextRequest('https://workforce.example/ar/admin', {
      headers: { 'accept-language': 'nl' },
    }));
    expect(selected.cookies.get('NEXT_LOCALE')).toMatchObject({
      value: 'ar',
      maxAge: 31536000,
      sameSite: 'lax',
    });

    const subsequent = middleware(new NextRequest('https://workforce.example/', {
      headers: { 'accept-language': 'nl', cookie: 'NEXT_LOCALE=ar' },
    }));
    expect(subsequent.headers.get('location')).toBe('https://workforce.example/ar');
  });

  it.each([
    '/%5c%5cevil.example',
    '/%2f%2fevil.example',
    '/%09%2f%2fevil.example',
  ])('keeps redirects for the path %s on the original origin', pathname => {
    const response = middleware(new NextRequest(`https://workforce.example${pathname}`));
    const location = response.headers.get('location');

    expect(response.status).toBe(307);
    if (!location) throw new Error('Expected a redirect location');
    expect(new URL(location).origin).toBe('https://workforce.example');
  });
});

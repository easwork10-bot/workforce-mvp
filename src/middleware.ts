import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, localePrefix, pathnames } from './i18n';

const handleI18nRouting = createMiddleware({
  locales,
  localePrefix,
  pathnames,
  defaultLocale: 'nl',
  localeDetection: false,
});

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    if (pathname.length > 1 && pathname.endsWith('/')) {
      const url = new URL(request.url);
      url.pathname = pathname.replace(/\/+$/, '');
      return NextResponse.redirect(url, 308);
    }
    return NextResponse.next();
  }

  if (pathname.length > 1 && pathname.endsWith('/')) {
    const url = new URL(request.url);
    url.pathname = pathname.replace(/\/+$/, '');
    return NextResponse.redirect(url, 308);
  }

  return handleI18nRouting(request);
}

export const config = {
  matcher: [
    // Match app routes and explicitly bypass locale routing for /api.
    // Exclude framework assets and public Jofra landing-page assets.
    // - /_next/image/...
    // - /favicon.ico
    '/((?!_next/static|_next/image|favicon.ico|jofra/assets/).*)',
  ],
};
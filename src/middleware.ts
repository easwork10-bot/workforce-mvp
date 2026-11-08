import createMiddleware from 'next-intl/middleware';
import { defaultLocale, locales, localePrefix, pathnames } from './i18n';

export default createMiddleware({
  locales,
  localePrefix,
  pathnames,
  defaultLocale,
  localeCookie: { maxAge: 31536000 },
});

export const config = {
  matcher: [
    // Match all routes EXCEPT:
    // - /api/... (including locale-prefixed /nl/api/..., /ar/api/...)
    // - /_next/static/...
    // - /_next/image/...
    // - /favicon.ico
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
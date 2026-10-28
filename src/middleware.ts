import createMiddleware from 'next-intl/middleware';
import { locales, localePrefix, pathnames } from './i18n';

export default createMiddleware({
  locales,
  localePrefix,
  pathnames,
  defaultLocale: 'nl',
});

export const config = {
  matcher: [
    // Match all routes EXCEPT:
    // - /api/... (including locale-prefixed /nl/api/..., /ar/api/...)
    // - /_next/static/...
    // - /_next/image/...
    // - /favicon.ico
    // - Public Jofra landing-page assets
    '/((?!api|_next/static|_next/image|favicon.ico|jofra/assets/).*)',
  ],
};
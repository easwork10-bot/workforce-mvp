import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { locales, type Locale } from '@/shared/i18n-routing';
export {
  Link,
  localePrefix,
  locales,
  permanentRedirect,
  redirect,
  usePathname,
  useRouter,
} from '@/shared/i18n-routing';
export type { Locale } from '@/shared/i18n-routing';

export const pathnames = {
  '/': '/',
  '/aanvragen': '/aanvragen',
  '/werken-bij-jofra': '/werken-bij-jofra',
  '/auth/login': '/auth/login',
  '/auth/register': '/auth/register',
  '/auth/forgot-password': '/auth/forgot-password',
  '/auth/reset-password': '/auth/reset-password',
  '/employee': '/employee',
  '/employee/shifts': '/employee/shifts',
  '/employee/schedule': '/employee/schedule',
  '/supervisor': '/supervisor',
  '/admin': '/admin',
  '/admin/shifts': '/admin/shifts',
  '/admin/shifts/create': '/admin/shifts/create',
  '/attendance/check-in': '/attendance/check-in',
};

export default getRequestConfig(async ({ locale }) => {
  if (!locales.includes(locale as Locale)) notFound();

  return {
    messages: (await import(`@/locales/${locale}.json`)).default,
    timeZone: locale === 'ar' ? 'Asia/Riyadh' : 'Europe/Amsterdam',
  };
});
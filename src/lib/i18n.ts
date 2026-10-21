import { notFound } from 'next/navigation';
import { getRequestConfig } from 'next-intl/server';

export const locales = ['nl', 'ar'] as const;
export type Locale = (typeof locales)[number];

export function getLocaleFromRequest(request: Request): Locale {
  const url = new URL(request.url);
  const locale = url.pathname.split('/')[1];
  if (!locales.includes(locale as Locale)) {
    return 'nl';
  }
  return locale as Locale;
}

export default getRequestConfig(async ({ locale }) => {
  const resolvedLocale = locale || 'nl';

  if (!locales.includes(resolvedLocale as Locale)) {
    notFound();
  }

  return {
    messages: (await import(`@/locales/${resolvedLocale}.json`)).default,
    timeZone: resolvedLocale === 'ar' ? 'Asia/Riyadh' : 'Europe/Amsterdam',
    locale: resolvedLocale,
  };
});
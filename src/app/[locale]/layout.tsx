import '@/app/globals.css';
import { NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import { getMessages } from 'next-intl/server';
import { ReactNode } from 'react';
import type { Metadata } from 'next';
import type { Locale } from '@/i18n';
import RouteAwareShell from '@/frontend/components/route-aware-shell';

export const metadata: Metadata = {
  icons: {
    icon: '/jofra/assets/logo-source.png',
  },
};

export default async function RootLayout({
  children,
  params: { locale }
}: {
  children: ReactNode;
  params: { locale: Locale };
}) {
  if (!['nl', 'ar'].includes(locale)) {
    notFound();
  }

  const messages = await getMessages({ locale });

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={locale === 'ar' ? 'Asia/Riyadh' : 'Europe/Amsterdam'}>
      <RouteAwareShell>{children}</RouteAwareShell>
    </NextIntlClientProvider>
  );
}

export const dynamic = 'force-dynamic';

export async function generateStaticParams() {
  return [{ locale: 'nl' }, { locale: 'ar' }];
}
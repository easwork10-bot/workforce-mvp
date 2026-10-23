import '@/app/globals.css';
import { Inter } from 'next/font/google';
import { Noto_Sans_Arabic } from 'next/font/google';
import { Space_Grotesk } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import { getMessages } from 'next-intl/server';
import { ReactNode } from 'react';
import { cn } from '@/frontend/lib/utils';
import type { Locale } from '@/i18n';
import Navigation from '@/frontend/components/navigation';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  preload: true,
});

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
  preload: true,
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sentient',
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  preload: true,
});

import { SessionProvider } from '@/frontend/components/session-provider';

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
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body className={cn(inter.variable, notoSansArabic.variable, spaceGrotesk.variable, 'font-sans antialiased', locale === 'ar' && 'font-arabic')}>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone={locale === 'ar' ? 'Asia/Riyadh' : 'Europe/Amsterdam'}>
          <SessionProvider>
            <Navigation />
            <div className="pt-16">
              {children}
            </div>
          </SessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

export const dynamic = 'force-dynamic';

export async function generateStaticParams() {
  return [{ locale: 'nl' }, { locale: 'ar' }];
}
import '@/app/globals.css';
import { Inter } from 'next/font/google';
import { Noto_Sans_Arabic } from 'next/font/google';
import { Space_Grotesk } from 'next/font/google';
import { getLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ReactNode } from 'react';
import { cn } from '@/frontend/lib/utils';

export const dynamic = 'force-dynamic';

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

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = await getLocale();
  if (locale !== 'nl' && locale !== 'ar') notFound();

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body className={cn(inter.variable, notoSansArabic.variable, spaceGrotesk.variable, 'font-sans antialiased', locale === 'ar' && 'font-arabic')}>
        {children}
      </body>
    </html>
  );
}
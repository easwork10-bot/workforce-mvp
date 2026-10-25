import { NextIntlClientProvider } from "next-intl";
import arMessages from "../../../src/locales/ar.json";
import nlMessages from "../../../src/locales/nl.json";

const messages = {
  ar: arMessages,
  nl: nlMessages,
} as const;

type Locale = keyof typeof messages;

export function generateStaticParams() {
  return [{ locale: "nl" }, { locale: "ar" }];
}

export const dynamicParams = false;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const { locale: requestedLocale } = params;
  if (requestedLocale !== "nl" && requestedLocale !== "ar") {
    throw new Error(`Unsupported showcase locale: ${requestedLocale}`);
  }

  const locale = requestedLocale;
  const localeMessages = messages[locale];

  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body style={{ margin: 0 }}>
        <NextIntlClientProvider
          locale={locale}
          messages={localeMessages}
          now={new Date(0)}
          timeZone={locale === "ar" ? "Asia/Riyadh" : "Europe/Amsterdam"}
        >
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

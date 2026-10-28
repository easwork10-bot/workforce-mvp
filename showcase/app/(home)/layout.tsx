import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import nlMessages from "../../../src/locales/nl.json";
import { jofraMetadata } from "../../../src/lib/jofra-metadata";

export const metadata: Metadata = jofraMetadata("nl");

export default function ShowcaseHomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl" dir="ltr">
      <body style={{ margin: 0 }}>
        <NextIntlClientProvider
          locale="nl"
          messages={nlMessages}
          now={new Date(0)}
          timeZone="Europe/Amsterdam"
        >
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

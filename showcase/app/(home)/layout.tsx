import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Jofra Verkeer",
  description: "Veiligheid in beweging.",
};

export default function ShowcaseHomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}

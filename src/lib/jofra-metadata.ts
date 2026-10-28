import type { Metadata } from "next";
import nl from "../locales/nl.json";
import ar from "../locales/ar.json";

export function jofraMetadata(locale: string, page: "home" | "request" | "recruitment" = "home"): Metadata {
  const copy = (locale === "ar" ? ar : nl).jofraLanding;
  const title = page === "home" ? `${copy.hero.line1} ${copy.hero.line2}` : copy[page].title;
  const paths = {
    home: "/",
    request: "/aanvragen",
    recruitment: "/werken-bij-jofra",
  } as const;
  const pathname = paths[page];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  let alternates: Metadata["alternates"];

  if (appUrl) {
    try {
      const configuredUrl = new URL(appUrl);
      if (configuredUrl.protocol === "https:" || configuredUrl.protocol === "http:") {
        const origin = configuredUrl.origin;
        const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
        const dutchPath = basePath
          ? `${basePath}${pathname === "/" ? "/" : `${pathname}/`}`
          : pathname;
        const arabicPath = basePath
          ? `${basePath}/ar${pathname === "/" ? "/" : `${pathname}/`}`
          : `/ar${pathname === "/" ? "" : pathname}`;
        const dutchUrl = new URL(dutchPath, origin).toString();
        const arabicUrl = new URL(arabicPath, origin).toString();
        alternates = {
          canonical: locale === "ar" ? arabicUrl : dutchUrl,
          languages: {
            nl: dutchUrl,
            ar: arabicUrl,
            "x-default": dutchUrl,
          },
        };
      }
    } catch {
      alternates = undefined;
    }
  }

  return {
    title: `${title} | Jofra Verkeer`,
    description: page === "recruitment" ? copy.recruitment.description : page === "request" ? copy.request.notice : copy.hero.lead,
    ...(alternates ? { alternates } : {}),
  };
}

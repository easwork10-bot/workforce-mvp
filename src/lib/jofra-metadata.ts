import type { Metadata } from "next";
import nl from "../locales/nl.json";
import ar from "../locales/ar.json";

export function jofraMetadata(locale: string, page: "home" | "request" | "recruitment" = "home"): Metadata {
  const copy = (locale === "ar" ? ar : nl).jofraLanding;
  const title = page === "home" ? `${copy.hero.line1} ${copy.hero.line2}` : copy[page].title;
  return {
    title: `${title} | Jofra Verkeer`,
    description: page === "recruitment" ? copy.recruitment.description : page === "request" ? copy.request.notice : copy.hero.lead,
  };
}

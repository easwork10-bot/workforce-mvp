"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getAlternateJofraPath } from "./jofraRoutes";

export default function LanguageSwitch() {
  const locale = useLocale();
  const t = useTranslations("jofraLanding");
  const pathname = usePathname();
  const target = locale === "ar" ? "nl" : "ar";
  const [urlSuffix, setUrlSuffix] = useState({ search: "", hash: "" });
  useEffect(() => {
    const update = () => setUrlSuffix({
      search: window.location.search,
      hash: window.location.hash,
    });
    update();
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const href = getAlternateJofraPath(pathname, target, base);
  return (
    <a
      className="language-switch"
      href={`${href}${urlSuffix.search}${urlSuffix.hash}`}
      hrefLang={target}
      lang={target}
      dir="auto"
      aria-label={`${t("navigation.switchLanguage")}: ${t(target === "ar" ? "navigation.arabic" : "navigation.dutch")}`}
    >
      <span className="language-code" aria-hidden="true">{target === "ar" ? "ع" : "NL"}</span>
      <span>{target === "ar" ? "العربية" : "Nederlands"}</span>
    </a>
  );
}

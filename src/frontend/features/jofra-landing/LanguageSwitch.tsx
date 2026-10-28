"use client";

import { useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function LanguageSwitch() {
  const locale = useLocale();
  const pathname = usePathname();
  const target = locale === "ar" ? "nl" : "ar";
  const [hash, setHash] = useState("");
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const route = pathname.replace(new RegExp(`^${base}`), "").replace(/^\/(nl|ar)(?=\/|$)/, `/${target}`);
  return <a className="language-switch" href={`${base}${route}${hash}`} hrefLang={target} lang={target} dir="auto">{target === "ar" ? "العربية" : "Nederlands"}</a>;
}

"use client";

import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import JofraSiteHeader from "./JofraSiteHeader";
import JofraPublicForm from "./JofraPublicForm";
import { getJofraPath } from "./jofraRoutes";
import "./JofraLanding.css";
import { dmSans, manrope } from "./jofraFonts";

export default function JofraPublicPage({ recruitment = false }: { recruitment?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("jofraLanding");
  const home = getJofraPath(locale, "/");
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return (
    <div className={`jofra-page public-page ${dmSans.variable} ${manrope.variable}`} lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <a className="skip-link" href="#main-content">{t("public.skip")}</a>
      <JofraSiteHeader />
      <main id="main-content" className="container public-content">
        <section className="public-hero">
          <p className="public-eyebrow">{t(recruitment ? "public.recruitmentKicker" : "public.requestKicker")}</p>
          <h1>{t(recruitment ? "recruitment.title" : "request.title")}</h1>
          <p className="public-lead" id={recruitment ? undefined : "draft-notice"}>{t(recruitment ? "recruitment.description" : "request.notice")}</p>
        </section>
        {recruitment ? (
          <section className="public-card-stack">
            <JofraPublicForm type="application" />
            <aside className="public-card public-card-support">
              <div className="public-card-photo">
                <Image
                  src={`${basePath}/jofra/assets/03_s02_waaromjofra_team_talk.jpg`}
                  alt={t("public.recruitmentImageAlt")}
                  fill
                  sizes="(max-width: 650px) 100vw, 35vw"
                />
              </div>
              <p>{t("public.alternative")}</p>
              <p><a href="tel:+31641239337" dir="ltr">+31 6 41239337</a></p>
              <p><a href="mailto:info@jofraverkeer.nl" dir="ltr">info@jofraverkeer.nl</a></p>
            </aside>
          </section>
        ) : (
          <section className="public-request-grid">
            <JofraPublicForm type="inquiry" />
            <aside className="public-card public-card-support">
              <div className="public-card-photo">
                <Image
                  src={`${basePath}/jofra/assets/06_case_forklift_coordination.jpg`}
                  alt={t("public.requestImageAlt")}
                  fill
                  sizes="(max-width: 650px) 100vw, 35vw"
                />
              </div>
              <p>{t("public.alternative")}</p>
              <p><a href="tel:+31641239337" dir="ltr">+31 6 41239337</a></p>
              <p><a href="mailto:info@jofraverkeer.nl" dir="ltr">info@jofraverkeer.nl</a></p>
            </aside>
          </section>
        )}
      </main>
      <footer className="public-footer">
        <div className="container public-footer-inner">
          <a href={home} className="public-footer-home">{t("public.home")}</a>
          <span>Jofra Verkeer B.V. · <bdi>Hogeweg 30, 6247 CJ Gronsveld</bdi> · KvK 98843397</span>
        </div>
      </footer>
    </div>
  );
}

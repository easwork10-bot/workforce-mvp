"use client";

import { FormEvent, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import LanguageSwitch from "./LanguageSwitch";
import { inquiryMailto, inquirySchema } from "./inquiry";
import "./JofraLanding.css";

export default function JofraPublicPage({ recruitment = false }: { recruitment?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("jofraLanding");
  const home = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/${locale}/`;
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = inquirySchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    setInvalid(!result.success);
    setDraft(result.success ? inquiryMailto(result.data) : "");
  };
  const fields = ["quantity", "date", "location", "hours", "name", "email", "phone"] as const;
  return (
    <div className="jofra-page public-page" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <header className="public-header">
        <a href={home}>JOFRA VERKEER</a>
        <LanguageSwitch />
        <a href={home}>{t("public.home")}</a>
      </header>
      <main id="main-content" className="container public-content">
        <section className="public-hero">
          <h1>{t(recruitment ? "recruitment.title" : "request.title")}</h1>
          <p className="public-lead" id={recruitment ? undefined : "draft-notice"}>{t(recruitment ? "recruitment.description" : "request.notice")}</p>
        </section>
        {recruitment ? (
          <section className="public-card-stack">
            <article className="public-card public-card-main">
              <p>{t("recruitment.notice")}</p>
              <a className="btn orange" href="mailto:info@jofraverkeer.nl?subject=Werken%20bij%20Jofra">{t("recruitment.action")}</a>
            </article>
            <aside className="public-card public-card-support">
              <p>{t("public.alternative")}</p>
              <p><a href="tel:+31641239337" dir="ltr">+31 6 41239337</a></p>
              <p><a href="mailto:info@jofraverkeer.nl" dir="ltr">info@jofraverkeer.nl</a></p>
            </aside>
          </section>
        ) : (
          <section className="public-request-grid">
            <article className="public-card public-card-main">
            <noscript><p>{t("request.noScript")}</p></noscript>
            <form onSubmit={submit} onChange={() => { setDraft(""); setInvalid(false); }} aria-describedby="draft-notice">
              <fieldset disabled={!ready}>
              <legend className="sr-only">{t("request.title")}</legend>
              <div className="inquiry-fields">
                {fields.map((field) => (
                  <label key={field} htmlFor={`request-${field}`}>
                    {t(`request.${field}`)}
                    <input id={`request-${field}`} name={field} required
                      type={field === "quantity" ? "number" : field === "date" ? "date" : field === "email" ? "email" : field === "phone" ? "tel" : "text"}
                      min={field === "quantity" ? 1 : undefined} max={field === "quantity" ? 999 : undefined}
                      minLength={["location", "hours", "name"].includes(field) ? 2 : field === "phone" ? 6 : undefined}
                      maxLength={field === "email" ? 254 : field === "phone" ? 40 : field === "name" ? 100 : 200}
                      autoComplete={field === "name" ? "name" : field === "email" ? "email" : field === "phone" ? "tel" : "off"}
                      dir={["email", "phone", "date", "quantity"].includes(field) ? "ltr" : undefined} />
                  </label>
                ))}
              </div>
              <button className="btn orange" type="submit">{t("request.prepare")}</button>
              </fieldset>
              {invalid && <p className="public-alert" role="alert">{t("request.invalid")}</p>}
              <div aria-live="polite">
                {draft && <div className="draft-result"><p>{t("request.ready")}</p><a className="btn orange" href={draft}>{t("request.open")}</a></div>}
              </div>
            </form>
            </article>
            <aside className="public-card public-card-support">
              <p>{t("public.alternative")}</p>
              <p><a href="tel:+31641239337" dir="ltr">+31 6 41239337</a></p>
              <p><a href="mailto:info@jofraverkeer.nl" dir="ltr">info@jofraverkeer.nl</a></p>
            </aside>
          </section>
        )}
      </main>
      <footer className="public-footer">Jofra Verkeer B.V. · <bdi>Hogeweg 30, 6247 CJ Gronsveld</bdi> · KvK 98843397</footer>
    </div>
  );
}

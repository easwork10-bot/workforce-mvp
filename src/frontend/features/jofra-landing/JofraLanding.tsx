"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DM_Sans, Manrope } from "next/font/google";
import Image from "next/image";
import "./JofraLanding.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  preload: false,
  weight: ["400", "500", "600", "700"],
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
  preload: false,
  weight: ["400", "500", "600", "700", "800"],
});

const SECTION_LINKS = [
  { href: "#diensten", label: "services" },
  { href: "#waarom", label: "benefits" },
  { href: "#werkwijze", label: "process" },
  { href: "#contact", label: "contact" },
] as const;

const SERVICE_ITEMS = ["0", "1", "2"] as const;
const BENEFIT_ITEMS = ["0", "1", "2"] as const;
const PROCESS_STEPS = ["0", "1", "2", "3"] as const;

const QUOTE_HREF = "mailto:info@jofraverkeer.nl?subject=Offerteaanvraag%20Jofra%20Verkeer";
const ASSET_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function JofraLanding() {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const locale = useLocale();
  const t = useTranslations("jofraLanding");
  const isArabic = locale === "ar";

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const revealTargets = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let revealObserver: IntersectionObserver | null = null;

    if (!reduceMotion && "IntersectionObserver" in window) {
      root.classList.add("motion-enabled");
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            revealObserver?.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });

      revealTargets.forEach((target) => revealObserver?.observe(target));
    } else {
      revealTargets.forEach((target) => target.classList.add("visible"));
    }

    const processTrack = root.querySelector<HTMLElement>(".process-grid");
    let processObserver: IntersectionObserver | null = null;
    if (!reduceMotion && processTrack && "IntersectionObserver" in window) {
      processObserver = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) {
          processTrack.classList.add("track-visible");
          processObserver?.disconnect();
        }
      }, { threshold: 0.25 });
      processObserver.observe(processTrack);
    }

    const navAnchors = Array.from(root.querySelectorAll<HTMLAnchorElement>(".navlinks a"));
    const sections = navAnchors
      .map((anchor) => {
        const target = anchor.getAttribute("href");
        return target?.startsWith("#") ? root.querySelector<HTMLElement>(target) : null;
      })
      .filter((section): section is HTMLElement => section !== null);

    let sectionObserver: IntersectionObserver | null = null;
    if (sections.length && "IntersectionObserver" in window) {
      sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          navAnchors.forEach((anchor) => {
            const active = anchor.getAttribute("href") === `#${entry.target.id}`;
            anchor.classList.toggle("active", active);
            if (active) {
              anchor.setAttribute("aria-current", "location");
            } else {
              anchor.removeAttribute("aria-current");
            }
          });
        });
      }, { rootMargin: "-25% 0px -60% 0px" });

      sections.forEach((section) => sectionObserver?.observe(section));
    }

    const header = root.querySelector<HTMLElement>(".site-header");
    const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 30);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });

    return () => {
      revealObserver?.disconnect();
      processObserver?.disconnect();
      sectionObserver?.disconnect();
      window.removeEventListener("scroll", updateHeader);
    };
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const root = rootRef.current;
    const isMobile = window.matchMedia("(max-width: 780px)").matches;
    const previousOverflow = document.body.style.overflow;

    if (isMobile) {
      document.body.style.overflow = "hidden";
      root?.querySelector<HTMLAnchorElement>(".navlinks a")?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !isMobile || !root) return;

      const focusable = Array.from(root.querySelectorAll<HTMLElement>(".navlinks a, .menu"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    const closeOnDesktopResize = () => {
      if (window.innerWidth > 780) setMobileMenuOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeOnDesktopResize);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeOnDesktopResize);
    };
  }, [mobileMenuOpen]);

  return (
    <div ref={rootRef} className={`jofra-page ${dmSans.variable} ${manrope.variable}`} lang={locale} dir={isArabic ? "rtl" : "ltr"}>
      <header className="site-header">
        <div className="container">
          <nav className="nav" aria-label={t("navigation.label")}>
            <a className="brand" href="#home">
              <Image className="brandmark" src={`${ASSET_BASE_PATH}/jofra/assets/logo-source.png`} alt="" width={56} height={30} priority />
              <span className="brandname">JOFRA VERKEER</span>
            </a>
            <div className={`navlinks${mobileMenuOpen ? " open" : ""}`} id="jofra-navlinks">
              {SECTION_LINKS.map((link) => (
                <a key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)}>
                  {t(`navigation.${link.label}`)}
                </a>
              ))}
            </div>
            <a className="btn orange nav-quote" href={QUOTE_HREF}>
              {t("navigation.quote")} <span className="arrow" aria-hidden="true">↗</span>
            </a>
            <button
              ref={menuButtonRef}
              className="menu"
              type="button"
              aria-label={mobileMenuOpen ? t("navigation.menuClose") : t("navigation.menuOpen")}
              aria-expanded={mobileMenuOpen}
              aria-controls="jofra-navlinks"
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              <span className={`menu-icon${mobileMenuOpen ? " is-open" : ""}`} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-image">
            <Image
              src={`${ASSET_BASE_PATH}/jofra/assets/worker.jpg`}
              alt={t("hero.imageAlt")}
              fill
              unoptimized
              priority
              sizes="(max-width: 900px) 100vw, 55vw"
            />
            <div className="image-label">{t("hero.imageLabel")}</div>
          </div>
          <svg className="hero-flow" viewBox="0 0 1440 760" fill="none" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
            <path className="flow-lane" d="M1500 150C1290 168 1210 300 1080 470S830 690 560 790" />
            <path className="flow-lane" d="M1500 190C1308 214 1236 340 1112 500S858 722 600 820" />
            <path className="flow-draw" d="M1500 128C1272 142 1180 288 1048 458S800 668 520 770" />
          </svg>
          <div className="container hero-inner">
            <div className="hero-copy">
              <span className="eyebrow">{t("hero.eyebrow")}</span>
              <h1 className="hero-headline">
                {t("hero.line1")} <span>{t("hero.line2")}<span className="headline-period">.</span></span>
              </h1>
              <p className="lead">{t("hero.lead")}</p>
              <div className="hero-actions">
                <a className="btn orange" href={QUOTE_HREF}>
                  {t("hero.quote")} <span className="arrow" aria-hidden="true">↗</span>
                </a>
                <a className="btn outline" href="#diensten">
                  {t("hero.discover")} <span className="arrow" aria-hidden="true">↓</span>
                </a>
              </div>
              <div className="hero-foot">
                <span className="dot" aria-hidden="true" />
                {t("hero.foot1")} <span aria-hidden="true">·</span> {t("hero.foot2")}
              </div>
            </div>
          </div>
        </section>

        <div className="route-divider" aria-hidden="true">
          <div className="container route-divider-inner">
            <span>{t("route.from")}</span>
            <div className="route-track"><span /><span /><span /><span /><span /></div>
            <span>{t("route.count")}</span>
          </div>
        </div>

        <section className="section" id="diensten">
          <div className="container">
            <div className="section-head reveal">
              <div>
                <span className="eyebrow">{t("services.eyebrow")}</span>
                <h2 className="section-title">{t("services.titleLine1")}<br />{t("services.titleLine2")}</h2>
              </div>
              <p className="section-desc">{t("services.description")}</p>
            </div>
            <div className="services">
              {SERVICE_ITEMS.map((item) => (
                <a className="service-row reveal" key={item} href="#contact">
                  <span className="service-id">{String(Number(item) + 1).padStart(2, "0")}</span>
                  <div className="service-name">
                    <span className="service-tag">{t(`services.items.${item}.tag`)}</span>
                    <strong className="service-title">{t(`services.items.${item}.title`)}</strong>
                  </div>
                  <span className="service-desc">{t(`services.items.${item}.description`)}</span>
                  <span className="service-arrow" aria-hidden="true">↗</span>
                </a>
              ))}
            </div>
            <p className="services-after reveal">
              <span className="road-dash" aria-hidden="true" /> {t("services.after")}
            </p>
          </div>
        </section>

        <div className="transition-rule" aria-hidden="true">
          <div className="container"><span>JOFRA / 02</span><i /></div>
        </div>

        <section className="benefits" id="waarom">
          <div className="container">
            <span className="eyebrow reveal">{t("benefits.eyebrow")}</span>
            <h2 className="reveal">{t("benefits.titleLine1")}</h2>
            <p className="benefits-statement reveal">{t("benefits.titleLine2")}</p>
            <div className="benefit-grid">
              {BENEFIT_ITEMS.map((item) => (
                <div className="benefit reveal" key={item}>
                  <span className="benefit-index" aria-hidden="true">{String(Number(item) + 1).padStart(2, "0")}</span>
                  <strong>{t(`benefits.items.${item}.title`)}</strong>
                  <p>{t(`benefits.items.${item}.description`)}</p>
                </div>
              ))}
            </div>
            <div className="benefits-signature reveal">
              <span>JOFRA / VERKEER</span><span className="signature-line" /><span>{t("benefits.signature")}</span>
            </div>
          </div>
        </section>

        <div className="dark-to-light" aria-hidden="true"><span>→</span></div>

        <section className="field-story">
          <div className="container field-grid">
            <div className="field-photo reveal">
              <Image
                src={`${ASSET_BASE_PATH}/jofra/assets/worker.jpg`}
                alt={t("story.imageAlt")}
                fill
                unoptimized
                sizes="(max-width: 650px) 100vw, 50vw"
              />
              <span className="field-photo-caption">
                {t("story.caption")} <span aria-hidden="true">↗</span>
              </span>
            </div>
            <div className="field-copy reveal">
              <span className="eyebrow">{t("story.eyebrow")}</span>
              <span className="field-small">{t("story.small")}</span>
              <h2>{t("story.titleLine1")} <em>{t("story.titleLine2")}</em></h2>
              <p>{t("story.description")}</p>
              <a className="text-link" href="#contact">
                {t("story.link")} <span aria-hidden="true">↗</span>
              </a>
              <div className="field-coordinate" aria-hidden="true">{t("story.coordinate")}</div>
            </div>
          </div>
        </section>

        <section className="section" id="werkwijze">
          <div className="container">
            <div className="process-intro">
              <span className="eyebrow reveal">{t("process.eyebrow")}</span>
              <span className="process-aside reveal">{t("process.asideLine1")}<br />{t("process.asideLine2")}</span>
            </div>
            <h2 className="section-title process-head reveal">
              {t("process.titleLine1")}<br />{t("process.titleLine2")}
            </h2>
            <div className="process-grid">
              {PROCESS_STEPS.map((step) => (
                <div className="step reveal" key={step}>
                  <span className="step-number">{String(Number(step) + 1).padStart(2, "0")} /</span>
                  <h3>{t(`process.steps.${step}.title`)}</h3>
                  <p>{t(`process.steps.${step}.description`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="contact-lead-in" aria-hidden="true">
          <div className="container"><span>{t("contact.leadIn")}</span><span className="contact-lead-arrow">↘</span></div>
        </div>

        <section className="contact" id="contact">
          <div className="container contact-grid">
            <div className="reveal">
              <span className="eyebrow">{t("contact.eyebrow")}</span>
              <h2>{t("contact.titleLine1")}<br /><span>{t("contact.titleLine2")}</span></h2>
              <p>{t("contact.description")}</p>
              <a className="btn orange" href={QUOTE_HREF}>
                {t("contact.quote")} <span className="arrow" aria-hidden="true">↗</span>
              </a>
            </div>
            <div className="contact-info reveal">
              <div className="contact-line">
                <small>{t("contact.phone")}</small>
                <a className="ltr" href="tel:+31641239337">+31 6 41239337 ↗</a>
              </div>
              <div className="contact-line">
                <small>{t("contact.email")}</small>
                <a className="ltr" href="mailto:info@jofraverkeer.nl">info@jofraverkeer.nl ↗</a>
              </div>
              <div className="contact-line">
                <small>{t("contact.address")}</small>
                <span>Hogeweg 30<br />6247 CJ Gronsveld</span>
              </div>
              <div className="contact-line">
                <small>{t("contact.company")}</small>
                <span>Jofra Verkeer B.V.</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-art reveal" aria-hidden="true">
          <svg viewBox="0 0 900 420" fill="none" preserveAspectRatio="xMaxYMin slice">
            <path className="flow-lane" d="M920 40C720 60 640 190 520 300S260 420 60 440" />
            <path className="flow-lane" d="M920 84C736 104 668 228 552 332S290 450 100 470" />
            <path className="flow-draw" d="M920 0C700 24 610 160 490 276S230 392 20 410" />
          </svg>
        </div>
        <div className="container">
          <div className="footer-main">
            <div className="footer-intro">
              <a className="brand" href="#home">
                <Image className="brandmark" src={`${ASSET_BASE_PATH}/jofra/assets/logo-source.png`} alt="" width={56} height={30} />
                <span className="brandname">JOFRA VERKEER</span>
              </a>
              <p>{t("footer.tagline")}</p>
              <a className="footer-mail" href="mailto:info@jofraverkeer.nl">
                {t("footer.emailCta")} <span aria-hidden="true">↗</span>
              </a>
            </div>
            <div className="footer-column">
              <span className="footer-label">{t("footer.explore")}</span>
              {SECTION_LINKS.map((link) => (
                <a key={link.href} href={link.href}>{t(`navigation.${link.label}`)}</a>
              ))}
            </div>
            <div className="footer-column">
              <span className="footer-label">{t("footer.reach")}</span>
              <a className="ltr" href="tel:+31641239337">+31 6 41239337</a>
              <a className="ltr" href="mailto:info@jofraverkeer.nl">info@jofraverkeer.nl</a>
              <p>Hogeweg 30<br />6247 CJ Gronsveld</p>
            </div>
          </div>
          <div className="footer-bottom">
            <small>© {new Date().getFullYear()} Jofra Verkeer B.V. · KvK 98843397</small>
            <span>{t("footer.slogan")} <span className="footer-orange-dot">●</span></span>
            <a href="#home">{t("footer.backToTop")}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

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
const ROAD_PATH = "M-20 110C60 108 150 66 250 64C350 62 440 160 570 160C700 160 840 140 900 104C940 78 990 72 1020 72";
const ROAD_PATH_MOBILE = "M-20 100C60 100 140 60 220 66C330 74 400 160 560 158C720 156 850 100 1020 70";
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
        <div className="header-art" aria-hidden="true">
          <svg viewBox="0 0 1440 80" preserveAspectRatio="xMidYMax slice" fill="none">
            <g className="hdr-diag">
              <path d="M340 80L430 0M368 80L458 0M396 80L486 0M424 80L514 0" />
            </g>
            <path className="hdr-road" d="M-20 78C260 78 560 74 860 66S1260 54 1470 50" />
            <path className="hdr-road" d="M-20 90C260 90 560 86 860 78S1260 66 1470 62" />
            <path className="hdr-road hdr-road-dash" d="M-20 84C260 84 560 80 860 72S1260 60 1470 56" />
            <path className="hdr-accent" d="M-20 78C260 78 560 74 860 66S1260 54 1470 50" />
          </svg>
        </div>
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
              <a className="btn orange nav-panel-quote" href={QUOTE_HREF} onClick={() => setMobileMenuOpen(false)}>
                {t("navigation.quote")} <span className="arrow" aria-hidden="true">↗</span>
              </a>
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
            <defs>
              <linearGradient id="jofra-flow-fade" x1="1440" y1="0" x2="360" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#EF850D" />
                <stop offset=".72" stopColor="#EF850D" />
                <stop offset="1" stopColor="#EF850D" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g className="hero-scratches">
              <path d="M70 150L560 96" />
              <path d="M150 640L620 590" />
              <path d="M30 400L330 372" />
            </g>
            <path className="flow-draw" d="M1500 500C1370 506 1262 566 1110 604S820 640 400 622" stroke="url(#jofra-flow-fade)" />
            <circle className="flow-node" cx="1110" cy="604" r="5" />
          </svg>
          <svg className="hero-wave" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true">
            <path className="wave-back" d="M0 70C210 84 360 38 620 34S960 72 1180 50S1370 16 1440 4V121H0Z" />
            <path className="wave-front" d="M0 88C210 102 360 56 620 52S960 90 1180 68S1370 34 1440 22V121H0Z" />
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
          </div>
          <div className="road-art reveal" aria-hidden="true">
            <div className="road-scenery">
              <svg className="rd-obj rd-tree rd-tree-a" viewBox="0 0 40 70"><path d="M20 2C32 2 38 14 36 26 34 38 28 42 22 44V70H18V44C12 42 6 38 4 26 2 14 8 2 20 2Z" /></svg>
              <svg className="rd-obj rd-tree rd-tree-b" viewBox="0 0 40 70"><path d="M20 2C32 2 38 14 36 26 34 38 28 42 22 44V70H18V44C12 42 6 38 4 26 2 14 8 2 20 2Z" /></svg>
              <svg className="rd-obj rd-tree rd-tree-c" viewBox="0 0 40 70"><path d="M20 2C32 2 38 14 36 26 34 38 28 42 22 44V70H18V44C12 42 6 38 4 26 2 14 8 2 20 2Z" /></svg>
              <svg className="rd-obj rd-lamp rd-lamp-a" viewBox="0 0 30 110"><path d="M4 110V10C4 4 8 2 14 2H26" /></svg>
              <svg className="rd-obj rd-lamp rd-lamp-b" viewBox="0 0 30 110"><path d="M26 110V10C26 4 22 2 16 2H4" /></svg>
            </div>
            <svg className="road-svg road-desktop" viewBox="0 0 1000 200" preserveAspectRatio="none" fill="none">
              <path className="road-shoulder" d={ROAD_PATH} />
              <path className="road-body" d={ROAD_PATH} />
              <path className="road-core" d={ROAD_PATH} />
              <path className="road-dash" d={ROAD_PATH} />
            </svg>
            <svg className="road-svg road-mobile" viewBox="0 0 1000 200" preserveAspectRatio="none" fill="none">
              <path className="road-shoulder" d={ROAD_PATH_MOBILE} />
              <path className="road-body" d={ROAD_PATH_MOBILE} />
              <path className="road-core" d={ROAD_PATH_MOBILE} />
              <path className="road-dash" d={ROAD_PATH_MOBILE} />
            </svg>
            <svg className="road-svg road-edge road-desktop" viewBox="0 0 1000 200" preserveAspectRatio="none" fill="none">
              <path d={ROAD_PATH} />
            </svg>
            <svg className="road-svg road-edge road-mobile" viewBox="0 0 1000 200" preserveAspectRatio="none" fill="none">
              <path d={ROAD_PATH_MOBILE} />
            </svg>
            <svg className="rd-obj rd-sign-left" viewBox="0 0 36 104" fill="none">
              <ellipse cx="18" cy="101" rx="11" ry="2.6" fill="#313332" opacity=".18" />
              <rect x="16" y="30" width="4" height="72" fill="#8e9390" />
              <circle cx="18" cy="16" r="15" fill="#313332" />
              <path d="M12 10L24 22M24 12V22H14" stroke="#fbffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="9" y="38" width="18" height="46" rx="1.5" fill="#fbffff" />
              <path d="M9 44L27 38M9 58L27 52M9 72L27 66M9 84L27 78" stroke="#ef850d" strokeWidth="6" />
            </svg>
            <svg className="rd-obj rd-cone" viewBox="0 0 40 52" fill="none">
              <ellipse cx="22" cy="49" rx="17" ry="3" fill="#313332" opacity=".18" />
              <path d="M20 2L33 42H7Z" fill="#ef850d" />
              <path d="M14.5 24H25.5L28 33H12Z" fill="#fbffff" />
              <rect x="3" y="42" width="34" height="6" rx="2" fill="#313332" opacity=".8" />
            </svg>
            <svg className="rd-obj rd-sign-right" viewBox="0 0 44 112" fill="none">
              <ellipse cx="22" cy="109" rx="12" ry="2.6" fill="#313332" opacity=".18" />
              <rect x="20" y="40" width="4" height="70" fill="#8e9390" />
              <rect x="2" y="2" width="40" height="42" rx="3" fill="#ef850d" />
              <path d="M22 36V12M13 21L22 11L31 21" stroke="#fbffff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="container">
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
          <div className="benefits-art reveal" aria-hidden="true">
            <svg viewBox="0 0 1000 700" preserveAspectRatio="xMaxYMid slice" fill="none">
              <defs>
                <radialGradient id="benefitsGlow" cx="1" cy=".2" r=".6">
                  <stop offset="0" stopColor="#ef850d" stopOpacity=".2" />
                  <stop offset="1" stopColor="#ef850d" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="benefitsBandDark" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" stopColor="#171a19" stopOpacity="0" />
                  <stop offset=".55" stopColor="#171a19" stopOpacity=".7" />
                  <stop offset="1" stopColor="#171a19" stopOpacity=".95" />
                </linearGradient>
                <linearGradient id="benefitsBandLight" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" stopColor="#434644" stopOpacity="0" />
                  <stop offset=".6" stopColor="#434644" stopOpacity=".55" />
                  <stop offset="1" stopColor="#434644" stopOpacity=".8" />
                </linearGradient>
              </defs>
              <rect className="ba-glow" x="300" y="-200" width="900" height="800" fill="url(#benefitsGlow)" />
              <g className="ba-shapes">
                <path className="ba-extra" d="M330 700H450L1284 0H1164Z" fill="url(#benefitsBandDark)" />
                <path d="M540 700H730L1564 0H1374Z" fill="url(#benefitsBandLight)" />
                <path className="ba-extra" d="M790 700H850L1684 0H1624Z" fill="url(#benefitsBandDark)" />
                <path d="M900 700H1140L1974 0H1734Z" fill="url(#benefitsBandDark)" />
              </g>
              <g className="ba-lines">
                <path className="ba-extra" d="M-440 700L394 0M-390 700L444 0M-330 700L504 0" />
                <path d="M300 700L1134 0M690 700L1524 0" />
              </g>
              <path className="ba-orange" pathLength="1" d="M610 700L1444 0" />
            </svg>
          </div>
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

        <section className="type-band" aria-hidden="true">
          <div className="container reveal">
            <div className="type-kicker"><span>JOFRA VERKEER</span><i /></div>
            <div className="type-mask">
              <div className="type-stack">
                <span className="type-disc" />
                <span className="type-word">{t("hero.line2")}</span>
                <span className="type-word type-word-knock">{t("hero.line2")}</span>
              </div>
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
                  <span className="step-node" aria-hidden="true" />
                  <span className="step-number">{String(Number(step) + 1).padStart(2, "0")} /</span>
                  <h3>{t(`process.steps.${step}.title`)}</h3>
                  <p>{t(`process.steps.${step}.description`)}</p>
                </div>
              ))}
              <svg className="process-route" viewBox="0 0 1000 112" preserveAspectRatio="none" fill="none" aria-hidden="true">
                <path className="route-base" pathLength="1" d="M0 73L5 73C130 73 130 39 255 39C380 39 380 73 505 73C630 73 630 39 755 39C880 39 900 39 1000 20" />
                <path className="route-draw" pathLength="1" d="M0 73L5 73C130 73 130 39 255 39C380 39 380 73 505 73C630 73 630 39 755 39C880 39 900 39 1000 20" />
              </svg>
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

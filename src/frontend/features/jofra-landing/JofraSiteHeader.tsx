"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import LanguageSwitch from "./LanguageSwitch";
import { getJofraPath } from "./jofraRoutes";

const SECTION_LINKS = [
  { href: "#diensten", label: "services" },
  { href: "#waarom", label: "benefits" },
  { href: "#werkwijze", label: "process" },
  { href: "#contact", label: "contact" },
] as const;

const ASSET_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function JofraSiteHeader({ landing = false }: { landing?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("jofraLanding");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const home = getJofraPath(locale, "/");
  const quoteHref = getJofraPath(locale, "/aanvragen");

  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".jofra-page .site-header");
    const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 30);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });

    if (landing) {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(".jofra-page .navlinks a"))
        .filter((anchor) => anchor.getAttribute("href")?.startsWith("#"));
      const sections = anchors
        .map((anchor) => document.querySelector<HTMLElement>(anchor.getAttribute("href")!))
        .filter((section): section is HTMLElement => section !== null);
      const observer = "IntersectionObserver" in window
        ? new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              anchors.forEach((anchor) => {
                const active = anchor.hash === `#${entry.target.id}`;
                anchor.classList.toggle("active", active);
                if (active) anchor.setAttribute("aria-current", "location");
                else anchor.removeAttribute("aria-current");
              });
            });
          }, { rootMargin: "-25% 0px -60% 0px" })
        : null;
      sections.forEach((section) => observer?.observe(section));

      return () => {
        window.removeEventListener("scroll", updateHeader);
        observer?.disconnect();
      };
    }

    return () => window.removeEventListener("scroll", updateHeader);
  }, [landing]);

  useEffect(() => {
    if (!menuOpen) return;

    const mobile = window.matchMedia("(max-width: 1000px)").matches;
    const previousOverflow = document.body.style.overflow;
    if (mobile) {
      document.body.style.overflow = "hidden";
      document.querySelector<HTMLAnchorElement>(".jofra-page .navlinks a")?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !mobile) return;

      const focusable = Array.from(document.querySelectorAll<HTMLElement>(".jofra-page .site-header a, .jofra-page .menu"))
        .filter((element) => element.getClientRects().length > 0);
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
      if (window.innerWidth > 1000) setMenuOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeOnDesktopResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeOnDesktopResize);
    };
  }, [menuOpen]);

  const sectionHref = (href: string) => landing ? href : `${home}${href}`;

  return (
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
          <a className="brand" href={landing ? "#home" : home}>
            <Image className="brandmark" src={`${ASSET_BASE_PATH}/jofra/assets/logo-source.png`} alt="" width={56} height={30} priority />
            <span className="brandname">JOFRA VERKEER</span>
          </a>
          <div className={`navlinks${menuOpen ? " open" : ""}`} id="jofra-navlinks">
            {SECTION_LINKS.map((link) => (
              <a key={link.href} href={sectionHref(link.href)} onClick={() => setMenuOpen(false)}>
                {t(`navigation.${link.label}`)}
              </a>
            ))}
            <a className="btn orange nav-panel-quote" href={quoteHref} onClick={() => setMenuOpen(false)}>
              {t("navigation.quote")} <span className="arrow" aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="nav-actions">
            <a className="btn orange nav-quote" href={quoteHref}>
              {t("navigation.quote")} <span className="arrow" aria-hidden="true">↗</span>
            </a>
            <LanguageSwitch />
          </div>
          <button
            ref={menuButtonRef}
            className="menu"
            type="button"
            aria-label={menuOpen ? t("navigation.menuClose") : t("navigation.menuOpen")}
            aria-expanded={menuOpen}
            aria-controls="jofra-navlinks"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className={`menu-icon${menuOpen ? " is-open" : ""}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        </nav>
      </div>
    </header>
  );
}

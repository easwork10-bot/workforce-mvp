"use client";

import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import "./JofraLanding.css";
import JofraSiteHeader from "./JofraSiteHeader";
import { arabic, dmSans, manrope } from "./jofraFonts";
import { getJofraPath } from "./jofraRoutes";
import ArrowIcon from "./ArrowIcon";
import JofraPhoto from "./JofraPhoto";

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

const ASSET_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function JofraLanding() {
  const rootRef = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const t = useTranslations("jofraLanding");
  const isArabic = locale === "ar";
  const QUOTE_HREF = getJofraPath(locale, "/aanvragen");
  const recruitmentHref = getJofraPath(locale, "/werken-bij-jofra");

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

    return () => {
      revealObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const track = root?.querySelector<HTMLElement>(".process-grid");
    const section = root?.querySelector<HTMLElement>("#werkwijze");
    const svg = track?.querySelector<SVGSVGElement>(".process-route");
    const base = svg?.querySelector<SVGPathElement>(".route-base");
    const draw = svg?.querySelector<SVGPathElement>(".route-draw");
    const preview = svg?.querySelector<SVGPathElement>(".route-preview");
    if (!root || !track || !section || !svg || !base || !draw || !preview) return;

    const steps = Array.from(track.querySelectorAll<HTMLElement>(".step"));
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const desktopPath = base.getAttribute("d") ?? "";
    let thresholds: number[] = [];
    let start = 0;
    let end = 1;
    let frame = 0;
    let hovered = -1;
    let focused = -1;
    let progress = 1;

    const paint = () => {
      frame = 0;
      progress = motion.matches ? 1 : Math.max(0, Math.min(1, (window.scrollY - start) / (end - start)));
      // Scroll coordinates are rounded to device pixels at the range boundaries.
      if (progress < 0.001) progress = 0;
      if (progress > 0.999) progress = 1;
      draw.style.strokeDashoffset = String(1 - progress);
      let active = -1;
      thresholds.forEach((value, index) => {
        if (progress >= value) active = index;
      });
      const highlighted = focused >= 0 ? focused : hovered;
      steps.forEach((step, index) => {
        step.classList.toggle("step-complete", progress >= thresholds[index]);
        step.classList.toggle("step-active", active === index);
        step.classList.toggle("step-highlighted", highlighted === index);
      });
      preview.style.opacity = highlighted >= 0 ? "1" : "0";
      if (highlighted >= 0) {
        const from = Math.max(0, thresholds[highlighted] - 0.07);
        const to = Math.min(1, thresholds[highlighted] + 0.07);
        preview.style.strokeDasharray = `${to - from} 1`;
        preview.style.strokeDashoffset = String(-from);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const measure = () => {
      const vertical = window.innerWidth <= 1100;
      const bounds = track.getBoundingClientRect();
      const rtl = root.dir === "rtl";
      let path = desktopPath;
      if (vertical) {
        steps.forEach((step) => step.querySelector<HTMLElement>(".step-node")?.style.removeProperty("top"));
        svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
        const x = rtl ? bounds.width - 8 : 8;
        const ys = steps.map((step) => step.offsetTop + 10);
        path = `M${x} ${ys[0]}V${ys[ys.length - 1]}`;
        thresholds = ys.map((y) => (y - ys[0]) / (ys[ys.length - 1] - ys[0]));
        start = bounds.top + window.scrollY + ys[0] - window.innerHeight * 0.7;
        end = bounds.top + window.scrollY + ys[ys.length - 1] - window.innerHeight * 0.45;
      } else {
        svg.setAttribute("viewBox", "0 0 1000 112");
      }
      [base, draw, preview].forEach((element) => element.setAttribute("d", path));
      if (!vertical) {
        const length = base.getTotalLength();
        thresholds = steps.map((step) => {
          const x = ((rtl ? bounds.width - step.offsetLeft - step.offsetWidth : step.offsetLeft) + 6) / bounds.width * 1000;
          let lo = 0;
          let hi = length;
          for (let i = 0; i < 20; i++) {
            const mid = (lo + hi) / 2;
            if (base.getPointAtLength(mid).x < x) lo = mid;
            else hi = mid;
          }
          const distance = (lo + hi) / 2;
          const node = step.querySelector<HTMLElement>(".step-node");
          if (node) node.style.top = `${base.getPointAtLength(distance).y - step.offsetTop}px`;
          return distance / length;
        });
        start = section.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.8;
        end = bounds.top + window.scrollY - window.innerHeight * 0.35;
      }
      track.classList.add("route-ready");
      paint();
    };
    const handlers = steps.map((step, index) => {
      const enter = () => { if (pointer.matches) hovered = index; schedule(); };
      const leave = () => { hovered = -1; schedule(); };
      const focus = () => { focused = index; schedule(); };
      const blur = (event: FocusEvent) => {
        if (!(event.relatedTarget instanceof Node) || !step.contains(event.relatedTarget)) focused = -1;
        schedule();
      };
      step.addEventListener("pointerenter", enter);
      step.addEventListener("pointerleave", leave);
      step.addEventListener("focusin", focus);
      step.addEventListener("focusout", blur);
      return () => {
        step.removeEventListener("pointerenter", enter);
        step.removeEventListener("pointerleave", leave);
        step.removeEventListener("focusin", focus);
        step.removeEventListener("focusout", blur);
      };
    });
    const resize = new ResizeObserver(measure);
    resize.observe(track);
    resize.observe(section);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure);
    motion.addEventListener("change", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      handlers.forEach((cleanup) => cleanup());
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", measure);
      motion.removeEventListener("change", measure);
    };
  }, []);

  return (
    <div ref={rootRef} className={`jofra-page ${dmSans.variable} ${manrope.variable} ${arabic.variable}`} lang={locale} dir={isArabic ? "rtl" : "ltr"}>
      <a className="skip-link" href="#main-content">{t("public.skip")}</a>
      <JofraSiteHeader landing />

      <main id="main-content">
        <section className="hero" id="home">
          <div className="hero-image">
            <JofraPhoto
              photo="04_s03_mensen_portret"
              alt={t("hero.imageAlt")}
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
                  {t("hero.quote")} <span className="arrow"><ArrowIcon /></span>
                </a>
                <a className="btn outline" href="#diensten">
                  {t("hero.discover")} <span className="arrow"><ArrowIcon direction="down" /></span>
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
            <div className="expertise-photo-pair">
              <figure className="expertise-photo expertise-photo-main reveal">
                <JofraPhoto
                  photo="01_s01_expertise_site_overview"
                  alt={t("services.overviewAlt")}
                  sizes="(max-width: 650px) 100vw, 58vw"
                />
              </figure>
              <figure className="expertise-photo expertise-photo-detail reveal">
                <JofraPhoto
                  photo="02_s01_expertise_close_control"
                  alt={t("services.detailAlt")}
                  sizes="(max-width: 650px) 82vw, 36vw"
                />
              </figure>
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
                  <span className="service-arrow"><ArrowIcon /></span>
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
            <div className="benefits-layout">
              <div className="benefits-copy">
                <span className="eyebrow reveal">{t("benefits.eyebrow")}</span>
                <h2 className="reveal">{t("benefits.titleLine1")}</h2>
                <p className="benefits-statement reveal">{t("benefits.titleLine2")}</p>
              </div>
              <figure className="benefits-photo reveal">
                <JofraPhoto
                  photo="03_s02_waaromjofra_team_talk"
                  alt={t("benefits.imageAlt")}
                  sizes="(max-width: 650px) 82vw, 340px"
                />
              </figure>
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
          </div>
        </section>

        <div className="dark-to-light" aria-hidden="true"><span><ArrowIcon direction="right" /></span></div>

        <section className="field-story">
          <div className="container field-grid">
            <div className="field-photo reveal">
              <JofraPhoto
                photo="worker"
                alt={t("story.imageAlt")}
                sizes="(max-width: 1000px) min(100vw, 560px), 50vw"
              />
              <span className="field-photo-caption">
                {t("story.caption")} <span><ArrowIcon /></span>
              </span>
            </div>
            <div className="field-copy reveal">
              <span className="eyebrow">{t("story.eyebrow")}</span>
              <span className="field-small">{t("story.small")}</span>
              <h2>{t("story.titleLine1")} <em>{t("story.titleLine2")}</em></h2>
              <p>{t("story.description")}</p>
              <a className="text-link" href="#contact">
                {t("story.link")} <span><ArrowIcon /></span>
              </a>
              <div className="field-coordinate" aria-hidden="true">
              {t("story.coordinate")}
              <div className="story-art" aria-hidden="true">
                <svg className="story-art-desktop" viewBox="0 -56 700 240" fill="none">
              <path pathLength="1" className="ba3-main" d="M40 128V106Q40 98 48 96L88 88L106 56Q109 50 116 50H170V30H350V128H314A28 28 0 0 0 258 128H156A28 28 0 0 0 100 128H40Z" />
              <path pathLength="1" className="ba3-main" d="M98 84L111 60H162V84Z" />
              <path pathLength="1" className="ba3-main" d="M118 88V128M170 108H350M335 38V108" />
              <circle pathLength="1" className="ba3-main" cx="128" cy="128" r="22" />
              <circle pathLength="1" className="ba3-main" cx="286" cy="128" r="22" />
              <path pathLength="1" className="ba3-main" d="M350 74H410L424 90V128H350M372 74V128M394 74V128" />
              <path pathLength="1" className="ba3-main" d="M240 8V30M318 8V30" />
              <path pathLength="1" className="ba3-orange" d="M208 -36H348V8H208Z" />
              <path pathLength="1" className="ba3-fine" d="M224 -14H330M312 -28L332 -14L312 0" />
              <circle pathLength="1" className="ba3-fine" cx="128" cy="128" r="9" />
              <circle pathLength="1" className="ba3-fine" cx="286" cy="128" r="9" />
              <path pathLength="1" className="ba3-fine" d="M40 112H48V120H40M148 100H160M136 50V44H150V50" />
              <path pathLength="1" className="ba3-main" d="M470 98H566V132H470Z" />
              <path pathLength="1" className="ba3-fine" d="M470 132L486 98M486 132L502 98M502 132L518 98M518 132L534 98M534 132L550 98M550 132L566 98" />
              <path pathLength="1" className="ba3-main" d="M486 132L478 150M550 132L558 150" />
              <path pathLength="1" className="ba3-main" d="M584 98H680V132H584Z" />
              <path pathLength="1" className="ba3-fine" d="M584 132L600 98M600 132L616 98M616 132L632 98M632 132L648 98M648 132L664 98M664 132L680 98" />
              <path pathLength="1" className="ba3-main" d="M600 132L592 150M664 132L672 150" />
              <path pathLength="1" className="ba3-dim" d="M40 172H350M40 166V178M350 166V178M18 30V128M12 30H24M12 128H24" />
              <path pathLength="1" className="ba3-ground" d="M-300 150H900" />
                </svg>
                <svg className="story-art-mobile" viewBox="176 -56 460 240" fill="none">
              <path pathLength="1" className="ba3-main" d="M40 128V106Q40 98 48 96L88 88L106 56Q109 50 116 50H170V30H350V128H314A28 28 0 0 0 258 128H156A28 28 0 0 0 100 128H40Z" />
              <path pathLength="1" className="ba3-main" d="M98 84L111 60H162V84Z" />
              <path pathLength="1" className="ba3-main" d="M118 88V128M170 108H350M335 38V108" />
              <circle pathLength="1" className="ba3-main" cx="128" cy="128" r="22" />
              <circle pathLength="1" className="ba3-main" cx="286" cy="128" r="22" />
              <path pathLength="1" className="ba3-main" d="M350 74H410L424 90V128H350M372 74V128M394 74V128" />
              <path pathLength="1" className="ba3-main" d="M240 8V30M318 8V30" />
              <path pathLength="1" className="ba3-orange" d="M208 -36H348V8H208Z" />
              <path pathLength="1" className="ba3-fine" d="M224 -14H330M312 -28L332 -14L312 0" />
              <circle pathLength="1" className="ba3-fine" cx="128" cy="128" r="9" />
              <circle pathLength="1" className="ba3-fine" cx="286" cy="128" r="9" />
              <path pathLength="1" className="ba3-fine" d="M40 112H48V120H40M148 100H160M136 50V44H150V50" />
              <path pathLength="1" className="ba3-main" d="M470 98H566V132H470Z" />
              <path pathLength="1" className="ba3-fine" d="M470 132L486 98M486 132L502 98M502 132L518 98M518 132L534 98M534 132L550 98M550 132L566 98" />
              <path pathLength="1" className="ba3-main" d="M486 132L478 150M550 132L558 150" />
              <path pathLength="1" className="ba3-main" d="M584 98H680V132H584Z" />
              <path pathLength="1" className="ba3-fine" d="M584 132L600 98M600 132L616 98M616 132L632 98M632 132L648 98M648 132L664 98M664 132L680 98" />
              <path pathLength="1" className="ba3-main" d="M600 132L592 150M664 132L672 150" />
              <path pathLength="1" className="ba3-dim" d="M40 172H350M40 166V178M350 166V178M18 30V128M12 30H24M12 128H24" />
              <path pathLength="1" className="ba3-ground" d="M-300 150H900" />
                </svg>
              </div>
            </div>
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
            <div className="process-feature">
              <h2 className="section-title process-head reveal">
                {t("process.titleLine1")}<br />{t("process.titleLine2")}
              </h2>
              <figure className="process-photo reveal">
                <JofraPhoto
                  photo="05_s04_werkwijze_hand_signal"
                  alt={t("process.imageAlt")}
                  sizes="(max-width: 650px) 70vw, 260px"
                />
              </figure>
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
                  <path className="route-preview" pathLength="1" d="M0 73L5 73C130 73 130 39 255 39C380 39 380 73 505 73C630 73 630 39 755 39C880 39 900 39 1000 20" />
                </svg>
              </div>
            </div>
          </div>
        </section>

        <section className="practice-showcase">
          <div className="container">
            <div className="practice-heading reveal">
              <h2>{t("practice.title")}</h2>
              <p>{t("practice.description")}</p>
            </div>
            <div className="practice-grid">
              <figure className="practice-photo practice-photo-day reveal">
                <JofraPhoto
                  photo="06_case_forklift_coordination"
                  alt={t("practice.dayAlt")}
                  sizes="(max-width: 650px) 100vw, 50vw"
                />
                <figcaption>{t("practice.dayCaption")}</figcaption>
              </figure>
              <figure className="practice-photo practice-photo-night reveal">
                <JofraPhoto
                  photo="07_case_night_operation"
                  alt={t("practice.nightAlt")}
                  sizes="(max-width: 650px) 88vw, 50vw"
                />
                <figcaption>{t("practice.nightCaption")}</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <div className="contact-lead-in" aria-hidden="true">
          <div className="contact-boundary reveal">
            {[
              { size: "desktop", width: 1440, curve: "M0 22C250 26 610 76 936 76C1130 76 1320 42 1440 18", guides: "M1010 63C1180 58 1330 30 1450 6M1110 72C1230 60 1370 36 1450 20" },
              { size: "tablet", width: 768, curve: "M0 20C160 24 318 64 500 64C610 64 706 40 768 22", guides: "M560 52C650 42 720 24 778 10" },
              { size: "phone", width: 390, curve: "M0 18C90 20 164 46 248 46C306 46 354 32 390 20", guides: "M300 37C344 29 374 20 400 14" },
            ].map(({ size, width, curve, guides }) => (
              <svg className={`boundary-${size}`} key={size} viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" fill="none">
                <defs>
                  <linearGradient id={`boundary-accent-${size}`} x1="0" x2="1">
                    <stop offset=".36" stopColor="#ef850d" stopOpacity="0" />
                    <stop offset=".59" stopColor="#ef850d" stopOpacity=".7" />
                    <stop offset=".8" stopColor="#ef850d" stopOpacity=".7" />
                    <stop offset=".98" stopColor="#ef850d" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path className="boundary-layer" d={`${curve}L${width} 101H0Z`} transform="translate(0 -7)" />
                <path className="boundary-surface" d={`${curve}L${width} 101H0Z`} />
                <path className="boundary-guides" d={guides} />
                <path className="boundary-accent" pathLength="1" stroke={`url(#boundary-accent-${size})`} d={curve} />
              </svg>
            ))}
          </div>
        </div>

        <section className="contact" id="contact">
          <div className="contact-art" aria-hidden="true">
            <svg viewBox="0 0 380 280" fill="none" preserveAspectRatio="xMaxYMin meet">
              <path d="M0 266L242 28L380 16M28 280L270 42L380 32M112 280L350 46" />
              <path className="contact-art-accent" d="M130 270L380 20" />
              <path className="contact-art-guide" d="M224 88V116M210 102H238" />
            </svg>
          </div>
          <div className="container contact-grid">
            <div className="reveal">
              <span className="eyebrow">{t("contact.eyebrow")}</span>
              <h2>{t("contact.titleLine1")}<br /><span>{t("contact.titleLine2")}</span></h2>
              <p>{t("contact.description")}</p>
              <div className="contact-actions">
                <a className="btn orange" href={QUOTE_HREF}>
                  {t("contact.quote")} <span className="arrow"><ArrowIcon /></span>
                </a>
                <a className="contact-direct" href="tel:+31641239337">
                  {t("contact.direct")} <span className="arrow"><ArrowIcon /></span>
                </a>
              </div>
            </div>
            <div className="contact-info">
              <div className="contact-line reveal">
                <small>{t("contact.phone")}</small>
                <a className="ltr" href="tel:+31641239337">+31 6 41239337 <ArrowIcon /></a>
              </div>
              <div className="contact-line reveal">
                <small>{t("contact.email")}</small>
                <a className="ltr" href="mailto:info@jofraverkeer.nl">info@jofraverkeer.nl <ArrowIcon /></a>
              </div>
              <div className="contact-line reveal">
                <small>{t("contact.address")}</small>
                <span dir="ltr">Hogeweg 30<br />6247 CJ Gronsveld</span>
              </div>
              <div className="contact-line reveal">
                <small>{t("contact.company")}</small>
                <span dir="ltr">Jofra Verkeer B.V.</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-boundary" aria-hidden="true">
          <svg viewBox="0 0 1440 80" preserveAspectRatio="none">
            <path d="M0 10C280 76 560 58 900 68C1110 74 1320 42 1440 0V81H0Z" />
          </svg>
        </div>
        <div className="footer-art reveal" aria-hidden="true">
          <svg viewBox="0 0 360 500" fill="none" preserveAspectRatio="xMaxYMin slice">
            <path className="footer-plane-orange" d="M182 -30H270V242L182 330Z" />
            <path className="footer-plane-grey" d="M80 310L296 94V220L80 436Z" />
            <path className="footer-plane-charcoal" d="M208 408L390 208V500H208Z" />
            <path className="footer-plane-orange" d="M298 350L390 248V500H298Z" />
            <path className="footer-cutout" d="M182 242C280 242 312 342 270 420L232 462H182Z" />
            <path className="footer-construction" d="M8 338L360 -14M38 500L360 178M0 438L360 78M270 0V500" />
            <path className="footer-accent" pathLength="1" d="M82 372L270 184V40" />
          </svg>
        </div>
        <div className="container">
          <div className="footer-main">
            <div className="footer-intro">
              <a className="brand" href="#home">
                <Image className="brandmark" src={`${ASSET_BASE_PATH}/jofra/assets/logo-source.png`} alt="" width={56} height={30} unoptimized />
                <span className="brandname">JOFRA VERKEER</span>
              </a>
              <span className="footer-statement">{t("footer.tagline")}</span>
              <p className="footer-message reveal">{t("footer.closingLine1")}<br />{t("footer.closingLine2")}</p>
              <a className="footer-mail" href="mailto:info@jofraverkeer.nl">
                {t("footer.emailCta")} <span><ArrowIcon /></span>
              </a>
            </div>
            <div className="footer-column">
              <span className="footer-label">{t("navigation.services")}</span>
              <a href="#diensten">{t("navigation.services")}</a>
            </div>
            <div className="footer-column">
              <span className="footer-label">{t("footer.explore")}</span>
              {SECTION_LINKS.filter((link) => link.href !== "#diensten").map((link) => (
                <a key={link.href} href={link.href}>{t(`navigation.${link.label}`)}</a>
              ))}
              <a href={recruitmentHref}>{t("public.recruitment")}</a>
            </div>
            <div className="footer-column">
              <span className="footer-label">{t("footer.reach")}</span>
              <small>{t("contact.phone")}</small>
              <a className="ltr" href="tel:+31641239337">+31 6 41239337</a>
              <small>{t("contact.email")}</small>
              <a className="ltr" href="mailto:info@jofraverkeer.nl">info@jofraverkeer.nl</a>
              <small>{t("contact.address")}</small>
              <p dir="ltr">Hogeweg 30<br />6247 CJ Gronsveld</p>
              <a className="ltr" href="https://www.jofraverkeer.nl">www.jofraverkeer.nl</a>
            </div>
          </div>
          <div className="footer-bottom">
            <small>© {new Date().getFullYear()} Jofra Verkeer B.V. · KvK 98843397</small>
            <span>{t("footer.slogan")} <span className="footer-orange-dot">●</span></span>
            <a href="#home">{t("footer.backToTop")} <ArrowIcon direction="up" /></a>
          </div>
        </div>
      </footer>
    </div>
  );
}

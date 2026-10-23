"use client";

import Link from "next/link";
import { Button } from "@/frontend/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/ui/card";
import { Users, Clock, Calendar, Shield, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

const features = [
  {
    icon: Users,
    titleKey: "features.employees.title",
    descKey: "features.employees.desc",
  },
  {
    icon: Calendar,
    titleKey: "features.shifts.title",
    descKey: "features.shifts.desc",
  },
  {
    icon: Clock,
    titleKey: "features.attendance.title",
    descKey: "features.attendance.desc",
  },
  {
    icon: Shield,
    titleKey: "features.compliance.title",
    descKey: "features.compliance.desc",
  },
];

const stats = [
  { value: "500+", labelKey: "stats.companies" },
  { value: "50k+", labelKey: "stats.employees" },
  { value: "99.9%", labelKey: "stats.uptime" },
  { value: "24/7", labelKey: "stats.support" },
];

export default function HomePage() {
  const t = useTranslations("landing");
  const tApp = useTranslations();

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="section relative overflow-hidden">
        <div className="container-wide">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-light text-primary text-sm font-medium mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              {t("hero.badge")}
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-balance text-foreground mb-6">
              {t("hero.title")}
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 text-balance">
              {t("hero.description")}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/auth/register">
                <Button size="lg" className="w-full sm:w-auto gap-2">
                  {t("hero.cta.primary")}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Link>
              <Link href="/auth/login">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  {t("hero.cta.secondary")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Indicators */}
      <section className="section-sm border-y border-border">
        <div className="container-wide">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-3xl sm:text-4xl font-bold text-foreground mb-1">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{t(stat.labelKey)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="section">
        <div className="container-wide">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t("features.title")}</h2>
            <p className="text-lg text-muted-foreground">{t("features.description")}</p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, index) => (
              <Card key={index} className="card-hover h-full">
                <CardHeader>
                  <div className="w-12 h-12 rounded-lg bg-primary-light text-primary flex items-center justify-center mb-4">
                    <feature.icon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <CardTitle className="text-lg">{t(feature.titleKey)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{t(feature.descKey)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="section bg-muted/50">
        <div className="container-wide">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t("howItWorks.title")}</h2>
            <p className="text-lg text-muted-foreground">{t("howItWorks.description")}</p>
          </div>
          <div className="grid gap-8 md:grid-cols-3 max-w-4xl mx-auto">
            {[
              { step: "01", titleKey: "howItWorks.step1.title", descKey: "howItWorks.step1.desc" },
              { step: "02", titleKey: "howItWorks.step2.title", descKey: "howItWorks.step2.desc" },
              { step: "03", titleKey: "howItWorks.step3.title", descKey: "howItWorks.step3.desc" },
            ].map((step, index) => (
              <div key={index} className="relative text-center">
                <div className="absolute left-1/2 -translate-x-1/2 top-0 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-2xl mb-6">
                  {step.step}
                </div>
                <div className="pt-16">
                  <h3 className="text-xl font-semibold mb-3">{t(step.titleKey)}</h3>
                  <p className="text-muted-foreground">{t(step.descKey)}</p>
                </div>
                {index < 2 && (
                  <div className="hidden md:block absolute top-8 left-[calc(50%+8px)] right-[calc(50%+8px)] h-0.5 bg-border" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="section">
        <div className="container-wide">
          <Card className="bg-primary text-primary-foreground max-w-3xl mx-auto text-center">
            <CardContent className="py-12 sm:py-16">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t("cta.title")}</h2>
              <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">{t("cta.description")}</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/auth/register">
                  <Button size="lg" variant="secondary" className="w-full sm:w-auto gap-2">
                    {t("cta.button")}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Link>
                <Link href="/auth/login">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10">
                    {t("hero.cta.secondary")}
                  </Button>
                </Link>
              </div>
              <p className="mt-6 text-sm text-primary-foreground/60">{t("cta.note")}</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container-wide">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 font-semibold text-lg text-foreground">
              <svg className="h-8 w-8 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M9 9h6M9 15h6M9 12h4" />
              </svg>
              <span>{tApp("app.name")}</span>
            </div>
            <p className="text-sm text-muted-foreground text-center md:text-left">
              {t("footer.copyright")}
            </p>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link href="/privacy" className="hover:text-foreground transition-colors">{t("footer.privacy")}</Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">{t("footer.terms")}</Link>
              <Link href="/contact" className="hover:text-foreground transition-colors">{t("footer.contact")}</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
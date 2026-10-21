"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Users, LogOut, Home, Menu, X } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export default function Navigation() {
  const t = useTranslations("navigation");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const { user, loading } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const isAdmin = user?.role === "administrator";
  const isSupervisor = user?.role === "supervisor";
  const isEmployee = user?.role === "employee";

  const handleLogout = async () => {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (res.ok) {
      window.location.href = "/auth/login";
    }
  };

  const navLinks = React.useMemo(() => {
    const links = [];
    if (isAdmin) {
      links.push(
        { href: "/admin", label: t("admin.dashboard"), icon: Home },
        { href: "/admin/shifts", label: t("admin.shifts"), icon: Users },
        { href: "/admin/employees", label: t("admin.employees"), icon: Users }
      );
    }
    if (isSupervisor) {
      links.push(
        { href: "/supervisor", label: t("supervisor.dashboard"), icon: Home },
        { href: "/supervisor/attendance", label: t("supervisor.attendance"), icon: Users }
      );
    }
    if (isEmployee) {
      links.push(
        { href: "/employee", label: t("employee.dashboard"), icon: Home },
        { href: "/employee/shifts", label: t("shifts.title"), icon: Users },
        { href: "/employee/schedule", label: t("employee.my.schedule"), icon: Users }
      );
    }
    return links;
  }, [isAdmin, isSupervisor, isEmployee, t]);

  if (loading) {
    return (
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container-wide h-16" />
      </header>
    );
  }

  const isActive = (href: string) => {
    if (href === "/") return pathname === `/${pathname.split("/")[1]}` || pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <nav className="container-wide flex h-16 items-center justify-between" aria-label={t("main.navigation")}>
        {/* Brand / Logo */}
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-lg text-foreground" aria-label={t("app.name")}>
            <svg className="h-8 w-8 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M9 9h6M9 15h6M9 12h4" />
            </svg>
            <span className="hidden sm:block">{t("app.name")}</span>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "nav-link",
                isActive(link.href) && "nav-link-active"
              )}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              <link.icon className="h-4 w-4" aria-hidden="true" />
              {link.label}
            </Link>
          ))}

          {user && (
            <div className="border-l border-border mx-2 h-6" aria-hidden="true" />
          )}

          {user && (
            <div className="flex items-center gap-2">
              <Link
                href="/profile"
                className={cn(
                  "nav-link",
                  pathname === "/profile" && "nav-link-active"
                )}
                aria-current={pathname === "/profile" ? "page" : undefined}
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                {t("profile")}
              </Link>

              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                aria-label={t("logout")}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}

          {!user && (
            <div className="flex items-center gap-2">
              <Link href="/auth/login">
                <Button variant="ghost" size="sm">
                  {t("login")}
                </Button>
              </Link>
              <Link href="/auth/register">
                <Button size="sm">{t("register")}</Button>
              </Link>
            </div>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="md:hidden">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={mobileMenuOpen ? tCommon("close") : tCommon("menu")}>
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-72 p-0" side="right">
              <div className="flex flex-col h-full">
                {/* Mobile Nav Links */}
                <nav className="flex-1 py-4 space-y-1" aria-label={t("main.navigation")}>
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors",
                        isActive(link.href)
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                      onClick={() => setMobileMenuOpen(false)}
                      aria-current={isActive(link.href) ? "page" : undefined}
                    >
                      <link.icon className="h-5 w-5" aria-hidden="true" />
                      {link.label}
                    </Link>
                  ))}

                  {user && (
                    <>
                      <div className="border-t border-border my-2" aria-hidden="true" />
                      <Link
                        href="/profile"
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors",
                          pathname === "/profile"
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                        onClick={() => setMobileMenuOpen(false)}
                        aria-current={pathname === "/profile" ? "page" : undefined}
                      >
                        <Users className="h-5 w-5" aria-hidden="true" />
                        {t("profile")}
                      </Link>

                      <Button
                        variant="outline"
                        className="mx-4 mt-2 w-[calc(100%-1rem)] justify-start gap-3"
                        onClick={() => {
                          handleLogout();
                          setMobileMenuOpen(false);
                        }}
                      >
                        <LogOut className="h-5 w-5" aria-hidden="true" />
                        {t("logout")}
                      </Button>
                    </>
                  )}

                  {!user && (
                    <div className="flex flex-col gap-2 px-4 pt-4 border-t border-border">
                      <Link
                        href="/auth/login"
                        onClick={() => setMobileMenuOpen(false)}
                        className="text-center"
                      >
                        <Button variant="outline" className="w-full">
                          {t("login")}
                        </Button>
                      </Link>
                      <Link
                        href="/auth/register"
                        onClick={() => setMobileMenuOpen(false)}
                        className="text-center"
                      >
                        <Button className="w-full">
                          {t("register")}
                        </Button>
                      </Link>
                    </div>
                  )}
                </nav>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export default function LoginPage() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const registered = searchParams.get("registered") === "true";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // Client-side validation
    let hasErrors = false;
    if (!email) {
      setFieldErrors({ email: t("validation.required") });
      hasErrors = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldErrors({ email: t("validation.email") });
      hasErrors = true;
    }
    if (!password) {
      setFieldErrors({ password: t("validation.required") });
      hasErrors = true;
    }
    if (hasErrors) return;

    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.details) {
          setFieldErrors(data.details);
        }
        throw new Error(data.error || t("login.error"));
      }

      // Redirect based on role
      const redirectPath: Record<string, string> = {
        administrator: "/admin",
        supervisor: "/supervisor",
        employee: "/employee",
      };

      router.push(redirectPath[data.user.role] || "/employee");
      router.refresh();
    } catch (err: any) {
      if (!fieldErrors.email && !fieldErrors.password) {
        setError(err.message || t("login.error"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-light via-background to-primary-light dark:from-primary-light/20 dark:via-background dark:to-primary-light/20 p-4">
      <div className="w-full max-w-md">
        {/* Back to home link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          {tCommon("backToHome")}
        </Link>

        <Card className="shadow-card-hover">
          <CardHeader className="space-y-1 text-center">
            <div className="w-12 h-12 rounded-xl bg-primary-light text-primary flex items-center justify-center mx-auto mb-4">
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M9 9h6M9 15h6M9 12h4" />
              </svg>
            </div>
            <CardTitle className="text-2xl font-bold">{t("login.title")}</CardTitle>
            <CardDescription>{t("login.description")}</CardDescription>
          </CardHeader>

          {registered && (
            <div className="mb-6 p-3 text-sm text-success bg-success-light dark:bg-success-light rounded-md border border-success/20" role="alert">
              {t("login.registeredSuccess")}
            </div>
          )}

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Email Field */}
              <div className="form-group">
                <Label htmlFor="email">{t("login.email")}</Label>
                <div className="relative">
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: "" }));
                    }}
                    required
                    disabled={loading}
                    aria-invalid={!!fieldErrors.email}
                    aria-describedby={fieldErrors.email ? "email-error" : undefined}
                    className={fieldErrors.email ? "input-error" : undefined}
                  />
                  {fieldErrors.email && (
                    <p id="email-error" className="form-error mt-1" role="alert">
                      {fieldErrors.email}
                    </p>
                  )}
                </div>
              </div>

              {/* Password Field */}
              <div className="form-group">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{t("login.password")}</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="text-sm text-primary hover:underline"
                  >
                    {t("login.forgotPassword")}
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: "" }));
                    }}
                    required
                    disabled={loading}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby={fieldErrors.password ? "password-error" : undefined}
                    className={fieldErrors.password ? "input-error pr-10" : "pr-10"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                  {fieldErrors.password && (
                    <p id="password-error" className="form-error mt-1" role="alert">
                      {fieldErrors.password}
                    </p>
                  )}
                </div>
              </div>

              {/* General Error */}
              {error && (
                <div className="p-3 text-sm text-destructive bg-destructive-light dark:bg-destructive-light rounded-md border border-destructive/20" role="alert">
                  {error}
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full"
                disabled={loading}
                aria-busy={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                    {tCommon("loading")}
                  </>
                ) : (
                  t("login.submit")
                )}
              </Button>
            </form>

            <div className="mt-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("login.noAccount")}{" "}
                <Link href="/auth/register" className="font-medium text-primary hover:underline">
                  {t("register")}
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Demo credentials hint */}
        <div className="mt-6 p-4 rounded-lg bg-muted/50 border border-border">
          <p className="text-xs text-muted-foreground text-center">
            {t("login.demoHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/frontend/ui/button";
import { Input } from "@/frontend/ui/input";
import { Label } from "@/frontend/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/ui/card";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Check } from "lucide-react";

const passwordRequirements = [
  { key: "length", labelKey: "requirements.length", test: (p: string) => p.length >= 8 },
  { key: "uppercase", labelKey: "requirements.uppercase", test: (p: string) => /[A-Z]/.test(p) },
  { key: "lowercase", labelKey: "requirements.lowercase", test: (p: string) => /[a-z]/.test(p) },
  { key: "number", labelKey: "requirements.number", test: (p: string) => /[0-9]/.test(p) },
];

export default function RegisterPage() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    phone: "",
    city: "",
    preferredLanguage: "nl",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  type FormField = keyof typeof formData;

  const handleChange = (field: FormField, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const handleBlur = (field: FormField) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    validateField(field, formData[field]);
  };

  const tRegister = useTranslations("auth.register");
  const tValidation = useTranslations("auth.validation");
  const tLanguages = useTranslations("languages");

  const validateField = (field: string, value: string): boolean => {
    let errorMessage = "";

    switch (field) {
      case "fullName":
        if (!value.trim()) errorMessage = tValidation("required");
        else if (value.trim().length < 2) errorMessage = tValidation("minLength", { min: 2 });
        break;
      case "email":
        if (!value) errorMessage = tValidation("required");
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errorMessage = tValidation("email");
        break;
      case "phone":
        if (value && !/^[\d\s+\-()]{8,}$/.test(value)) errorMessage = tValidation("phone");
        break;
      case "password":
        if (!value) errorMessage = tValidation("required");
        else if (value.length < 8) errorMessage = tValidation("minLength", { min: 8 });
        break;
      case "confirmPassword":
        if (!value) errorMessage = tValidation("required");
        else if (value !== formData.password) errorMessage = tRegister("passwordsMismatch");
        break;
    }

    if (errorMessage) {
      setFieldErrors((prev) => ({ ...prev, [field]: errorMessage }));
      return false;
    } else {
      setFieldErrors((prev) => ({ ...prev, [field]: "" }));
      return true;
    }
  };

  const validateForm = (): boolean => {
    let isValid = true;
    Object.keys(formData).forEach((key) => {
      if (!validateField(key, formData[key as keyof typeof formData])) {
        isValid = false;
      }
    });
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          fullName: formData.fullName,
          phone: formData.phone || null,
          city: formData.city || null,
          preferredLanguage: formData.preferredLanguage,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.details) {
          setFieldErrors(data.details);
        }
        throw new Error(data.error || "Registration failed. Please try again.");
      }

      router.push("/auth/login?registered=true");
    } catch (err: any) {
      // Field errors are already set, general error handling could be added here if needed
      console.error("Registration error:", err);
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = passwordRequirements.filter((req) => req.test(formData.password)).length;

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
            <CardTitle className="text-2xl font-bold">{tRegister("title")}</CardTitle>
            <CardDescription>{tRegister("description")}</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Full Name */}
              <div className="form-group">
                <Label htmlFor="fullName">{tRegister("fullName")}</Label>
                <Input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  placeholder="John Doe"
                  value={formData.fullName}
                  onChange={(e) => handleChange("fullName", e.target.value)}
                  onBlur={() => handleBlur("fullName")}
                  required
                  disabled={loading}
                  aria-invalid={!!fieldErrors.fullName && touched.fullName}
                  aria-describedby={fieldErrors.fullName && touched.fullName ? "fullName-error" : undefined}
                  className={fieldErrors.fullName && touched.fullName ? "input-error" : undefined}
                />
                {fieldErrors.fullName && touched.fullName && (
                  <p id="fullName-error" className="form-error mt-1" role="alert">
                    {fieldErrors.fullName}
                  </p>
                )}
              </div>

              {/* Email */}
              <div className="form-group">
                <Label htmlFor="email">{tRegister("email")}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={formData.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  onBlur={() => handleBlur("email")}
                  required
                  disabled={loading}
                  aria-invalid={!!fieldErrors.email && touched.email}
                  aria-describedby={fieldErrors.email && touched.email ? "email-error" : undefined}
                  className={fieldErrors.email && touched.email ? "input-error" : undefined}
                />
                {fieldErrors.email && touched.email && (
                  <p id="email-error" className="form-error mt-1" role="alert">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              {/* Password */}
              <div className="form-group">
                <Label htmlFor="password">{tRegister("password")}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => handleChange("password", e.target.value)}
                    onBlur={() => handleBlur("password")}
                    required
                    disabled={loading}
                    aria-invalid={!!fieldErrors.password && touched.password}
                    aria-describedby={fieldErrors.password && touched.password ? "password-error" : "password-hint"}
                    className={fieldErrors.password && touched.password ? "input-error pr-10" : "pr-10"}
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
                  {fieldErrors.password && touched.password && (
                    <p id="password-error" className="form-error mt-1" role="alert">
                      {fieldErrors.password}
                    </p>
                  )}
                </div>

                {/* Password strength indicator */}
                <div className="mt-2" aria-live="polite">
                  <div className="flex gap-1 mb-1" role="progressbar" aria-valuenow={passwordStrength} aria-valuemin={0} aria-valuemax={4} aria-label={t("register.passwordStrength")}>
                    {passwordRequirements.map((req, index) => (
                      <div
                        key={req.key}
                        className={`h-1 flex-1 rounded transition-colors ${
                          index < passwordStrength
                            ? passwordStrength <= 2
                              ? "bg-destructive"
                              : passwordStrength === 3
                              ? "bg-warning"
                              : "bg-success"
                            : "bg-border"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {passwordStrength === 0
                      ? tRegister("passwordStrength.weak")
                      : passwordStrength <= 2
                      ? tRegister("passwordStrength.fair")
                      : passwordStrength === 3
                      ? tRegister("passwordStrength.good")
                      : tRegister("passwordStrength.strong")}
                  </p>

                  {/* Password requirements */}
                  <ul className="mt-2 space-y-1" role="list">
                    {passwordRequirements.map((req) => (
                      <li key={req.key} className="flex items-center gap-2 text-xs">
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded",
                            req.test(formData.password)
                              ? "bg-success text-success-foreground"
                              : "bg-border text-muted-foreground"
                          )}
                        >
                          {req.test(formData.password) && <Check className="h-3 w-3" />}
                        </span>
                        <span
                          className={cn(
                            req.test(formData.password) ? "text-success" : "text-muted-foreground"
                          )}
                        >
                          {tRegister(req.labelKey)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="form-group">
                <Label htmlFor="confirmPassword">{tRegister("confirmPassword")}</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={formData.confirmPassword}
                    onChange={(e) => handleChange("confirmPassword", e.target.value)}
                    onBlur={() => handleBlur("confirmPassword")}
                    required
                    disabled={loading}
                    aria-invalid={!!fieldErrors.confirmPassword && touched.confirmPassword}
                    aria-describedby={fieldErrors.confirmPassword && touched.confirmPassword ? "confirmPassword-error" : undefined}
                    className={fieldErrors.confirmPassword && touched.confirmPassword ? "input-error pr-10" : "pr-10"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showConfirmPassword ? t("login.hidePassword") : t("login.showPassword")}
                    aria-pressed={showConfirmPassword}
                  >
                    {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                  {fieldErrors.confirmPassword && touched.confirmPassword && (
                    <p id="confirmPassword-error" className="form-error mt-1" role="alert">
                      {fieldErrors.confirmPassword}
                    </p>
                  )}
                </div>
              </div>

              {/* Phone */}
              <div className="form-group">
                <Label htmlFor="phone">{tRegister("phone")}</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+31 6 12345678"
                  value={formData.phone}
                  onChange={(e) => handleChange("phone", e.target.value)}
                  onBlur={() => handleBlur("phone")}
                  disabled={loading}
                  aria-invalid={!!fieldErrors.phone && touched.phone}
                  aria-describedby={fieldErrors.phone && touched.phone ? "phone-error" : undefined}
                  className={fieldErrors.phone && touched.phone ? "input-error" : undefined}
                />
                {fieldErrors.phone && touched.phone && (
                  <p id="phone-error" className="form-error mt-1" role="alert">
                    {fieldErrors.phone}
                  </p>
                )}
                <p id="phone-hint" className="form-hint mt-1">{tRegister("phoneHint")}</p>
              </div>

              {/* City */}
              <div className="form-group">
                <Label htmlFor="city">{tRegister("city")}</Label>
                <Input
                  id="city"
                  type="text"
                  autoComplete="address-level2"
                  placeholder="Amsterdam"
                  value={formData.city}
                  onChange={(e) => handleChange("city", e.target.value)}
                  disabled={loading}
                />
                <p id="city-hint" className="form-hint mt-1">{tRegister("cityHint")}</p>
              </div>

              {/* Language */}
              <div className="form-group">
                <Label htmlFor="preferredLanguage">{tRegister("language")}</Label>
                <select
                  id="preferredLanguage"
                  value={formData.preferredLanguage}
                  onChange={(e) => handleChange("preferredLanguage", e.target.value)}
                  disabled={loading}
                  className="input"
                  aria-describedby="language-hint"
                >
                  <option value="nl">{tLanguages("nl")}</option>
                  <option value="ar">{tLanguages("ar")}</option>
                  <option value="en">{tLanguages("en")}</option>
                </select>
                <p id="language-hint" className="form-hint mt-1">{tRegister("languageHint")}</p>
              </div>

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
                  tRegister("title")
                )}
              </Button>
            </form>

            <div className="mt-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("login.hasAccount")}{" "}
                <Link href="/auth/login" className="font-medium text-primary hover:underline">
                  {t("login.title")}
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { cn } from "@/frontend/lib/utils";
"use client";

import { FormEvent, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  businessInquirySchema,
  jobApplicationSchema,
} from "@/shared/jofra-public-form-schemas";

type FormType = "inquiry" | "application";
type FieldName =
  | "companyName"
  | "contactName"
  | "email"
  | "phone"
  | "location"
  | "startDate"
  | "endDate"
  | "workingHours"
  | "quantity"
  | "additionalInformation"
  | "fullName"
  | "city"
  | "experience"
  | "qualifications"
  | "availability"
  | "motivation";
type FieldDefinition = {
  name: FieldName;
  type: "text" | "email" | "tel" | "date" | "number" | "textarea";
  required?: boolean;
  maxLength?: number;
  autoComplete?: string;
};

const inquiryFields: readonly FieldDefinition[] = [
  { name: "companyName", type: "text", required: true, maxLength: 160, autoComplete: "organization" },
  { name: "contactName", type: "text", required: true, maxLength: 100, autoComplete: "name" },
  { name: "email", type: "email", required: true, maxLength: 254, autoComplete: "email" },
  { name: "phone", type: "tel", required: true, maxLength: 40, autoComplete: "tel" },
  { name: "location", type: "text", required: true, maxLength: 200, autoComplete: "address-level2" },
  { name: "startDate", type: "date", required: true },
  { name: "endDate", type: "date", required: true },
  { name: "workingHours", type: "text", required: true, maxLength: 200 },
  { name: "quantity", type: "number", required: true },
  { name: "additionalInformation", type: "textarea", maxLength: 2000 },
];

const applicationFields: readonly FieldDefinition[] = [
  { name: "fullName", type: "text", required: true, maxLength: 100, autoComplete: "name" },
  { name: "email", type: "email", required: true, maxLength: 254, autoComplete: "email" },
  { name: "city", type: "text", required: true, maxLength: 100, autoComplete: "address-level2" },
  { name: "phone", type: "tel", maxLength: 40, autoComplete: "tel" },
  { name: "experience", type: "textarea", maxLength: 1200 },
  { name: "qualifications", type: "textarea", maxLength: 1200 },
  { name: "availability", type: "textarea", maxLength: 500 },
  { name: "motivation", type: "textarea", maxLength: 2000 },
];

export default function JofraPublicForm({
  type,
  staticPreview = false,
}: {
  type: FormType;
  staticPreview?: boolean;
}) {
  const t = useTranslations("jofraLanding");
  const locale = useLocale() === "ar" ? "ar" : "nl";
  const idempotencyKey = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<"success" | "failure" | null>(null);
  const fields = type === "inquiry" ? inquiryFields : applicationFields;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (staticPreview) return;
    if (submitting) return;

    const form = event.currentTarget;
    const values = {
      ...Object.fromEntries(new FormData(form)),
      locale,
    };
    const schema = type === "inquiry" ? businessInquirySchema : jobApplicationSchema;
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const errors = Object.fromEntries(
        parsed.error.issues
          .filter((issue) => typeof issue.path[0] === "string")
          .map((issue) => [String(issue.path[0]), true]),
      );
      setFieldErrors(errors);
      setFeedback(null);
      return;
    }

    idempotencyKey.current ??= crypto.randomUUID();
    setFieldErrors({});
    setFeedback(null);
    setSubmitting(true);
    try {
      const response = await fetch(
        type === "inquiry" ? "/api/public/jofra/inquiries" : "/api/public/jofra/applications",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey.current,
          },
          body: JSON.stringify(parsed.data),
        },
      );
      const result: unknown = await response.json().catch(() => null);
      if (response.ok) {
        setFeedback("success");
        form.reset();
        idempotencyKey.current = null;
        return;
      }

      if (
        response.status === 400 &&
        result !== null &&
        typeof result === "object" &&
        "fieldErrors" in result &&
        result.fieldErrors !== null &&
        typeof result.fieldErrors === "object"
      ) {
        const errors = Object.fromEntries(
          Object.keys(result.fieldErrors).map((field) => [field, true]),
        );
        if (Object.keys(errors).length > 0) setFieldErrors(errors);
      }
      setFeedback("failure");
    } catch {
      setFeedback("failure");
    } finally {
      setSubmitting(false);
    }
  };

  const clearFeedback = () => {
    setFieldErrors({});
    setFeedback(null);
    idempotencyKey.current = null;
  };

  return (
    <article className="public-card public-card-main">
      {type === "application" && <p>{t("recruitment.notice")}</p>}
      {staticPreview && (
        <p className="public-alert" role="note">{t("forms.staticUnavailable")}</p>
      )}
      <form className="public-form" method="post" noValidate onSubmit={submit} onChange={clearFeedback}>
        <noscript><p className="public-alert">{t("forms.noScript")}</p></noscript>
        <fieldset disabled={staticPreview || submitting}>
          <legend className="sr-only">
            {t(type === "inquiry" ? "request.title" : "recruitment.title")}
          </legend>
          <div className="public-honeypot" aria-hidden="true">
            <label htmlFor={`jofra-${type}-website`}>{t("forms.website")}</label>
            <input
              id={`jofra-${type}-website`}
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>
          <div className="inquiry-fields">
            {fields.map((field) => {
              const inputId = `jofra-${type}-${field.name}`;
              const hasError = Boolean(fieldErrors[field.name]);
              const direction = ["email", "phone", "date", "quantity", "workingHours"].includes(field.name)
                ? "ltr"
                : undefined;
              return (
                <label key={field.name} htmlFor={inputId} className={field.type === "textarea" ? "public-form-wide" : undefined}>
                  {t(`forms.fields.${field.name}`)}
                  {field.type === "textarea" ? (
                    <textarea
                      id={inputId}
                      name={field.name}
                      required={field.required}
                      maxLength={field.maxLength}
                      aria-invalid={hasError}
                      aria-describedby={hasError ? `${inputId}-error` : undefined}
                    />
                  ) : (
                    <input
                      id={inputId}
                      name={field.name}
                      type={field.type}
                      required={field.required}
                      min={field.type === "number" ? 1 : undefined}
                      max={field.type === "number" ? 999 : undefined}
                      minLength={field.required && field.type === "text" ? 2 : undefined}
                      maxLength={field.maxLength}
                      autoComplete={field.autoComplete}
                      dir={direction}
                      aria-invalid={hasError}
                      aria-describedby={hasError ? `${inputId}-error` : undefined}
                    />
                  )}
                  {hasError && (
                    <span className="public-field-error" id={`${inputId}-error`}>
                      {t("forms.fieldError")}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <button className="btn orange" type="submit">
            {submitting
              ? t("forms.sending")
              : t(type === "inquiry" ? "forms.submitInquiry" : "forms.submitApplication")}
          </button>
        </fieldset>
        <div className="public-form-feedback" aria-live="polite">
          {feedback === "success" && (
            <p className="public-form-success" role="status">
              {t(type === "inquiry" ? "forms.inquirySuccess" : "forms.applicationSuccess")}
            </p>
          )}
          {feedback === "failure" && (
            <p className="public-alert" role="alert">{t("forms.failure")}</p>
          )}
        </div>
      </form>
    </article>
  );
}

import { describe, expect, it } from "vitest";
import {
  businessInquirySchema,
  jobApplicationSchema,
} from "@/shared/jofra-public-form-schemas";
import { jofraMetadata } from "@/lib/jofra-metadata";
import { getAlternateJofraPath, getJofraPath } from "@/frontend/features/jofra-landing/jofraRoutes";
import nl from "@/locales/nl.json";
import ar from "@/locales/ar.json";

const inquiry = {
  locale: "nl",
  website: "",
  companyName: "Voorbeeld BV",
  contactName: "Test Contact",
  email: "test@example.com",
  phone: "+31612345678",
  location: "Maastricht",
  startDate: "2026-12-01",
  endDate: "2026-12-02",
  workingHours: "22:00–06:00",
  quantity: "3",
  additionalInformation: "",
};

const application = {
  locale: "ar",
  website: "",
  fullName: "Test Applicant",
  email: "test@example.com",
  city: "Maastricht",
  phone: "",
};

describe("Jofra public form contracts", () => {
  it("validates a business request including overnight working hours", () => {
    expect(businessInquirySchema.parse(inquiry)).toMatchObject({
      quantity: 3,
      workingHours: "22:00–06:00",
    });
  });

  it.each([
    { quantity: "0" },
    { quantity: "1000" },
    { quantity: "1.5" },
    { startDate: "2026-02-30" },
    { endDate: "2026-11-30" },
    { location: " " },
    { workingHours: "" },
    { email: "invalid" },
    { phone: "12" },
    { contactName: "" },
  ])("rejects invalid business request values %o", (invalid) => {
    expect(businessInquirySchema.safeParse({ ...inquiry, ...invalid }).success).toBe(false);
  });

  it.each(["1", "999"])("accepts quantity boundary %s", (quantity) => {
    expect(businessInquirySchema.safeParse({ ...inquiry, quantity }).success).toBe(true);
  });

  it("validates an Arabic job application and optional fields", () => {
    expect(jobApplicationSchema.parse({
      ...application,
      experience: "One year",
      qualifications: "Traffic controller certificate",
    })).toMatchObject({ locale: "ar", city: "Maastricht" });
  });

  it("rejects unsupported application fields such as CV uploads", () => {
    expect(jobApplicationSchema.safeParse({
      ...application,
      cv: "resume.pdf",
    }).success).toBe(false);
  });

  it("keeps all public translation keys equivalent", () => {
    const keys = (value: object, prefix = ""): string[] => Object.entries(value).flatMap(([key, child]) =>
      typeof child === "object" ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`]);
    expect(keys(nl.jofraLanding)).toEqual(keys(ar.jofraLanding));
  });

  it("provides localized metadata for all public pages", () => {
    expect(jofraMetadata("nl", "recruitment").title).toContain("Werken bij Jofra");
    expect(jofraMetadata("ar", "request").title).toContain(ar.jofraLanding.request.title);
    expect(jofraMetadata("nl").title).toContain("Jofra Verkeer");
  });

  it("uses unprefixed Dutch paths and Arabic-prefixed paths in production", () => {
    expect(getJofraPath("nl", "/", "")).toBe("/");
    expect(getJofraPath("nl", "/aanvragen", "")).toBe("/aanvragen");
    expect(getJofraPath("ar", "/werken-bij-jofra", "")).toBe("/ar/werken-bij-jofra");
    expect(getAlternateJofraPath("/ar/werken-bij-jofra", "nl", "")).toBe("/werken-bij-jofra");
    expect(getAlternateJofraPath("/aanvragen", "ar", "")).toBe("/ar/aanvragen");
  });

  it("keeps the locale-prefixed path structure in the static showcase export", () => {
    expect(getJofraPath("nl", "/aanvragen", "/workforce-mvp"))
      .toBe("/workforce-mvp/nl/aanvragen/");
    expect(getAlternateJofraPath("/workforce-mvp/ar/werken-bij-jofra", "nl", "/workforce-mvp"))
      .toBe("/workforce-mvp/nl/werken-bij-jofra/");
  });

  it("generates canonical and hreflang URLs only when the configured app URL is available", () => {
    const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://jofraverkeer.example";
    try {
      expect(jofraMetadata("nl", "request").alternates).toEqual({
        canonical: "https://jofraverkeer.example/aanvragen",
        languages: {
          nl: "https://jofraverkeer.example/aanvragen",
          ar: "https://jofraverkeer.example/ar/aanvragen",
          "x-default": "https://jofraverkeer.example/aanvragen",
        },
      });
      expect(jofraMetadata("ar", "home").alternates?.canonical)
        .toBe("https://jofraverkeer.example/ar");
    } finally {
      if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
    }
  });
});

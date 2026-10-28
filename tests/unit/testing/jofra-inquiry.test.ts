import { describe, expect, it } from "vitest";
import { inquiryMailto, inquirySchema } from "@/frontend/features/jofra-landing/inquiry";
import { jofraMetadata } from "@/lib/jofra-metadata";
import nl from "@/locales/nl.json";
import ar from "@/locales/ar.json";

const request = {
  quantity: "3", date: "2026-12-01", location: "Maastricht",
  hours: "22:00–06:00", name: "Test Contact", email: "test@example.com", phone: "+31612345678",
};

describe("Jofra public inquiries", () => {
  it("validates a request including overnight working hours", () => {
    expect(inquirySchema.parse(request).quantity).toBe(3);
  });
  it.each([
    { quantity: "0" }, { quantity: "1.5" }, { date: "2026-02-30" },
    { location: " " }, { hours: "" }, { email: "invalid" }, { phone: "12" }, { name: "" },
  ])("rejects invalid required values %o", (invalid) => {
    expect(inquirySchema.safeParse({ ...request, ...invalid }).success).toBe(false);
  });
  it("builds an encoded draft, not an automatic submission", () => {
    const url = new URL(inquiryMailto(inquirySchema.parse({ ...request, location: "A & B #1" })));
    expect(url.pathname).toBe("info@jofraverkeer.nl");
    const body = url.searchParams.get("body");
    for (const value of ["A & B #1", "3", request.date, request.hours, request.name, request.email, request.phone]) {
      expect(body).toContain(value);
    }
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  send: vi.fn(async () => ({
    data: { id: "email-id" },
    error: null as { message: string } | null,
  })),
}));

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = { send: provider.send };
  },
}));

const inquiry = {
  locale: "nl" as const,
  companyName: "Voorbeeld BV",
  contactName: "Test Contact",
  email: "customer@example.com",
  phone: "+31612345678",
  location: "Maastricht",
  startDate: "2026-12-01",
  endDate: "2026-12-02",
  workingHours: "22:00-06:00",
  quantity: 3,
};

const application = {
  locale: "ar" as const,
  fullName: "Test Applicant",
  email: "applicant@example.com",
  city: "Maastricht",
  motivation: "أرغب في العمل",
};

describe("Jofra form email delivery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test_secret";
    process.env.JOFRA_FORMS_FROM = "forms@example.nl";
    process.env.JOFRA_FORMS_TO = "info@jofraverkeer.nl";
    provider.send.mockResolvedValue({ data: { id: "email-id" }, error: null });
  });

  it("uses the fixed recipient, verified sender, customer Reply-To, and plain-text inquiry template", async () => {
    const { sendJofraFormEmail } = await import("@/backend/jofra/publicFormsEmail");
    await sendJofraFormEmail("inquiry", inquiry, "provider-idempotency-key");

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Jofra Verkeer <forms@example.nl>",
        to: ["info@jofraverkeer.nl"],
        replyTo: "customer@example.com",
        subject: "Aanvraag verkeersregelaars",
        text: expect.stringContaining("Bedrijf:\n  Voorbeeld BV"),
      }),
      { idempotencyKey: "provider-idempotency-key" },
    );
  });

  it("renders a separate Arabic job application email", async () => {
    const { sendJofraFormEmail } = await import("@/backend/jofra/publicFormsEmail");
    await sendJofraFormEmail("application", application, "provider-idempotency-key");

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["info@jofraverkeer.nl"],
        replyTo: "applicant@example.com",
        subject: "طلب اهتمام بالعمل لدى جوفرا",
        text: expect.stringContaining("الاسم الكامل"),
      }),
      { idempotencyKey: "provider-idempotency-key" },
    );
  });

  it("accepts a configured display-name sender without nesting it", async () => {
    process.env.JOFRA_FORMS_FROM = "Jofra Verkeer <website@jofraverkeer.nl>";
    const { sendJofraFormEmail } = await import("@/backend/jofra/publicFormsEmail");
    await sendJofraFormEmail("inquiry", inquiry, "provider-idempotency-key");

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Jofra Verkeer <website@jofraverkeer.nl>" }),
      { idempotencyKey: "provider-idempotency-key" },
    );
  });

  it("rejects sender header injection", async () => {
    process.env.JOFRA_FORMS_FROM = "Jofra <forms@example.nl>\r\nBcc: attacker@example.test";
    const { sendJofraFormEmail } = await import("@/backend/jofra/publicFormsEmail");

    await expect(sendJofraFormEmail("inquiry", inquiry, "provider-idempotency-key"))
      .rejects.toThrow("Jofra email delivery is not configured");
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("does not claim delivery when Resend rejects a message", async () => {
    provider.send.mockResolvedValue({ data: null, error: { message: "provider failure" } });
    const { sendJofraFormEmail } = await import("@/backend/jofra/publicFormsEmail");

    await expect(sendJofraFormEmail("inquiry", inquiry, "provider-idempotency-key"))
      .rejects.toThrow("Email provider rejected the message");
  });

  it("requires server-side provider configuration", async () => {
    process.env.RESEND_API_KEY = "";
    const { sendJofraFormEmail } = await import("@/backend/jofra/publicFormsEmail");

    await expect(sendJofraFormEmail("inquiry", inquiry, "provider-idempotency-key"))
      .rejects.toThrow("Jofra email delivery is not configured");
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("requires an explicit valid recipient and does not send without one", async () => {
    process.env.JOFRA_FORMS_TO = "";
    const { sendJofraFormEmail } = await import("@/backend/jofra/publicFormsEmail");

    await expect(sendJofraFormEmail("inquiry", inquiry, "provider-idempotency-key"))
      .rejects.toThrow("Jofra email delivery is not configured");
    expect(provider.send).not.toHaveBeenCalled();
  });
});

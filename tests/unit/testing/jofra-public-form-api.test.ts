import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getTrustedClientIp: vi.fn(() => "203.0.113.10" as string | null),
  reservePublicSubmission: vi.fn(async () => ({
    status: "reserved" as string,
    providerKey: "provider-key",
    redisKey: "redis-key",
  })),
  markPublicSubmissionSent: vi.fn(async () => undefined),
  releasePublicSubmission: vi.fn(async () => undefined),
  sendJofraFormEmail: vi.fn(async () => undefined),
  JofraEmailDeliveryError: class JofraEmailDeliveryError extends Error {
    constructor(
      message: string,
      readonly reason: "not-configured" | "rejected",
    ) {
      super(message);
      this.name = "JofraEmailDeliveryError";
    }
  },
}));

vi.mock("@/backend/security/clientIp", () => ({
  getTrustedClientIp: mocks.getTrustedClientIp,
}));

vi.mock("@/backend/jofra/publicFormRedis", () => ({
  reservePublicSubmission: mocks.reservePublicSubmission,
  markPublicSubmissionSent: mocks.markPublicSubmissionSent,
  releasePublicSubmission: mocks.releasePublicSubmission,
}));

vi.mock("@/backend/jofra/publicFormsEmail", () => ({
  JofraEmailDeliveryError: mocks.JofraEmailDeliveryError,
  sendJofraFormEmail: mocks.sendJofraFormEmail,
}));

const inquiry = {
  locale: "nl",
  website: "",
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

function request(
  body: string,
  options: { origin?: string; contentType?: string; idempotencyKey?: string } = {},
): NextRequest {
  const headers = new Headers();
  const origin = options.origin === undefined ? "https://jofra.example" : options.origin;
  headers.set("origin", origin);
  if (options.contentType !== undefined) headers.set("content-type", options.contentType);
  else headers.set("content-type", "application/json");
  if (options.idempotencyKey !== undefined) headers.set("idempotency-key", options.idempotencyKey);
  else headers.set("idempotency-key", "550e8400-e29b-41d4-a716-446655440000");

  return new NextRequest("https://jofra.example/api/public/jofra/inquiries", {
    method: "POST",
    headers,
    body,
  });
}

async function submit(req: NextRequest) {
  const { submitJofraPublicForm } = await import("@/backend/jofra/publicFormSubmission");
  return submitJofraPublicForm(req, "inquiry");
}

describe("Jofra public inquiry API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.JOFRA_PUBLIC_ORIGINS = "https://jofra.example";
    mocks.getTrustedClientIp.mockReturnValue("203.0.113.10");
    mocks.reservePublicSubmission.mockResolvedValue({
      status: "reserved",
      providerKey: "provider-key",
      redisKey: "redis-key",
    });
    mocks.markPublicSubmissionSent.mockResolvedValue(undefined);
    mocks.releasePublicSubmission.mockResolvedValue(undefined);
    mocks.sendJofraFormEmail.mockResolvedValue(undefined);
  });

  it("sends a validated message and reports provider acceptance", async () => {
    const response = await submit(request(JSON.stringify(inquiry)));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.sendJofraFormEmail).toHaveBeenCalledWith(
      "inquiry",
      expect.objectContaining({ email: "customer@example.com", quantity: 3 }),
      "provider-key",
    );
    expect(mocks.markPublicSubmissionSent).toHaveBeenCalledWith("redis-key");
  });

  it("rejects invalid data with field names but no submitted values", async () => {
    const response = await submit(request(JSON.stringify({
      ...inquiry,
      contactName: "Private Person",
      email: "not-an-email",
    })));
    const body = await response.json() as { fieldErrors: Record<string, string[]> };

    expect(response.status).toBe(400);
    expect(body.fieldErrors).toHaveProperty("email");
    expect(JSON.stringify(body)).not.toContain("Private Person");
    expect(mocks.reservePublicSubmission).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before abuse controls or email delivery", async () => {
    const response = await submit(request(JSON.stringify({
      ...inquiry,
      additionalInformation: "x".repeat(17_000),
    })));

    expect(response.status).toBe(413);
    expect(mocks.reservePublicSubmission).not.toHaveBeenCalled();
    expect(mocks.sendJofraFormEmail).not.toHaveBeenCalled();
  });

  it("rejects missing and unapproved origins", async () => {
    const missing = await submit(request(JSON.stringify(inquiry), { origin: "" }));
    const unapproved = await submit(request(JSON.stringify(inquiry), { origin: "https://attacker.example" }));

    expect(missing.status).toBe(403);
    expect(unapproved.status).toBe(403);
    expect(mocks.reservePublicSubmission).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and non-JSON content types", async () => {
    const malformed = await submit(request("{"));
    const wrongType = await submit(request(JSON.stringify(inquiry), { contentType: "text/plain" }));

    expect(malformed.status).toBe(400);
    expect(wrongType.status).toBe(415);
    expect(mocks.reservePublicSubmission).not.toHaveBeenCalled();
  });

  it("rejects honeypot submissions without delivering them", async () => {
    const response = await submit(request(JSON.stringify({ ...inquiry, website: "bot-filled" })));

    expect(response.status).toBe(400);
    expect(mocks.reservePublicSubmission).not.toHaveBeenCalled();
    expect(mocks.sendJofraFormEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["rate-limited", 429],
    ["in-progress", 409],
    ["already-sent", 200],
  ])("handles duplicate and rate-limit state %s", async (status, expectedStatus) => {
    mocks.reservePublicSubmission.mockResolvedValue({
      status,
      providerKey: "unused",
      redisKey: "unused",
    });
    const response = await submit(request(JSON.stringify(inquiry)));

    expect(response.status).toBe(expectedStatus);
    expect(mocks.sendJofraFormEmail).not.toHaveBeenCalled();
  });

  it("retains the idempotency reservation when delivery outcome is uncertain", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
    mocks.sendJofraFormEmail.mockRejectedValue(new Error(
      "customer@example.com RESEND_API_KEY=secret-value",
    ));

    const response = await submit(request(JSON.stringify(inquiry)));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).not.toContain("customer@example.com");
    expect(body).not.toContain("secret-value");
    expect(logs.join(" ")).not.toContain("customer@example.com");
    expect(logs.join(" ")).not.toContain("secret-value");
    expect(mocks.releasePublicSubmission).not.toHaveBeenCalled();
  });

  it("releases the idempotency reservation when the provider explicitly rejects delivery", async () => {
    mocks.sendJofraFormEmail.mockRejectedValue(
      new mocks.JofraEmailDeliveryError("provider rejection", "rejected"),
    );

    const response = await submit(request(JSON.stringify(inquiry)));

    expect(response.status).toBe(502);
    expect(mocks.releasePublicSubmission).toHaveBeenCalledWith("redis-key");
  });

  it("releases the idempotency reservation when email configuration is missing", async () => {
    mocks.sendJofraFormEmail.mockRejectedValue(
      new mocks.JofraEmailDeliveryError("not configured", "not-configured"),
    );

    const response = await submit(request(JSON.stringify(inquiry)));

    expect(response.status).toBe(503);
    expect(mocks.releasePublicSubmission).toHaveBeenCalledWith("redis-key");
  });

  it("fails closed when origin configuration or trusted IP metadata is unavailable", async () => {
    process.env.JOFRA_PUBLIC_ORIGINS = "";
    const noOriginConfig = await submit(request(JSON.stringify(inquiry)));

    process.env.JOFRA_PUBLIC_ORIGINS = "https://jofra.example";
    mocks.getTrustedClientIp.mockReturnValue(null);
    const noIp = await submit(request(JSON.stringify(inquiry)));

    expect(noOriginConfig.status).toBe(503);
    expect(noIp.status).toBe(503);
    expect(mocks.reservePublicSubmission).not.toHaveBeenCalled();
  });

  it("fails closed when Redis-backed abuse protection is unavailable", async () => {
    mocks.reservePublicSubmission.mockRejectedValue(new Error("Redis unavailable"));
    const response = await submit(request(JSON.stringify(inquiry)));

    expect(response.status).toBe(503);
    expect(mocks.sendJofraFormEmail).not.toHaveBeenCalled();
  });
});

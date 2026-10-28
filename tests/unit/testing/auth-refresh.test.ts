import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getTrustedClientIp: vi.fn(() => "203.0.113.10"),
  verifyTokenFromCookie: vi.fn(async () => ({
    sub: "user-1",
    role: "employee",
    jti: "session-1",
    ipHash: "ip-hash",
  })),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetAt: 0 })),
  rotateRefreshToken: vi.fn(async () => null),
  revokeAllUserSessions: vi.fn(async () => undefined),
  generateCsrfToken: vi.fn(() => "csrf-token"),
  setCsrfCookie: vi.fn(),
  RedisUnavailableError: class RedisUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RedisUnavailableError";
    }
  },
}));

vi.mock("@/backend/security/clientIp", () => ({
  getTrustedClientIp: mocks.getTrustedClientIp,
}));

vi.mock("@/backend/auth/tokens", () => ({
  verifyTokenFromCookie: mocks.verifyTokenFromCookie,
}));

vi.mock("@/backend/auth/session", () => ({
  RedisUnavailableError: mocks.RedisUnavailableError,
  checkRateLimit: mocks.checkRateLimit,
  rotateRefreshToken: mocks.rotateRefreshToken,
  revokeAllUserSessions: mocks.revokeAllUserSessions,
}));

vi.mock("@/backend/security/csrf", () => ({
  generateCsrfToken: mocks.generateCsrfToken,
  setCsrfCookie: mocks.setCsrfCookie,
}));

describe("refresh token API dependency failures", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getTrustedClientIp.mockReturnValue("203.0.113.10");
    mocks.verifyTokenFromCookie.mockResolvedValue({
      sub: "user-1",
      role: "employee",
      jti: "session-1",
      ipHash: "ip-hash",
    });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });
    mocks.rotateRefreshToken.mockResolvedValue(null);
    mocks.revokeAllUserSessions.mockResolvedValue(undefined);
  });

  it("returns service unavailable when Redis cannot rotate a refresh token", async () => {
    mocks.rotateRefreshToken.mockRejectedValue(
      new mocks.RedisUnavailableError("Authentication service is unavailable"),
    );
    const { POST } = await import("@/app/api/auth/refresh/route");
    const request = new NextRequest("https://workforce.example/api/auth/refresh", {
      method: "POST",
      headers: {
        cookie: "access_token=synthetic-access; refresh_token=synthetic-refresh",
        "user-agent": "test-agent",
      },
    });
    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Service temporarily unavailable" });
    expect(mocks.revokeAllUserSessions).not.toHaveBeenCalled();
  });
});

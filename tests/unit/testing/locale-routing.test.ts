import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import middleware from "@/middleware";
import { localizeHref } from "@/shared/localized-href";

describe("locale routing middleware", () => {
  it.each([
    ["/nl", 307, "https://jofra.example/"],
    ["/nl/aanvragen?campaign=legacy", 307, "https://jofra.example/aanvragen?campaign=legacy"],
    ["/nl/aanvragen/?campaign=legacy", 308, "https://jofra.example/nl/aanvragen?campaign=legacy"],
  ])("canonicalizes Dutch-prefixed route %s", (path, status, expectedLocation) => {
    const response = middleware(new NextRequest(`https://jofra.example${path}`));

    expect(response.status).toBe(status);
    expect(response.headers.get("location")).toBe(expectedLocation);
  });

  it("serves the unprefixed Dutch root through the internal locale rewrite", () => {
    const response = middleware(new NextRequest("https://jofra.example/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/nl");
  });

  it("normalizes Arabic page trailing slashes without changing locale", () => {
    const response = middleware(new NextRequest("https://jofra.example/ar/aanvragen/?campaign=arabic"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://jofra.example/ar/aanvragen?campaign=arabic");
  });

  it("bypasses locale routing on API paths", () => {
    const response = middleware(new NextRequest("https://jofra.example/api/public/jofra/inquiries", {
      method: "POST",
    }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("locale-aware links", () => {
  it("omits the Dutch prefix and applies the Arabic prefix to links", () => {
    expect(localizeHref("/", "nl")).toBe("/");
    expect(localizeHref("/", "ar")).toBe("/ar");
    expect(localizeHref("/auth/register", "nl")).toBe("/auth/register");
    expect(localizeHref("/auth/register", "ar")).toBe("/ar/auth/register");
    expect(localizeHref("/nl/auth/register", "ar")).toBe("/ar/auth/register");
  });

  it("preserves query strings, hashes, and URL object parameters", () => {
    expect(localizeHref("/aanvragen?campaign=summer#form", "ar")).toBe(
      "/ar/aanvragen?campaign=summer#form"
    );
    expect(
      localizeHref(
        { pathname: "/ar/auth/register", query: { source: "login" } },
        "nl"
      )
    ).toEqual({ pathname: "/auth/register", query: { source: "login" } });
  });
});

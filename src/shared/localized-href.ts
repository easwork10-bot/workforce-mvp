import type { UrlObject } from "url";

type Href = string | UrlObject;

function localizePath(pathname: string, locale: string) {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return pathname;

  const unprefixedPath = pathname.replace(/^\/(?:nl|ar)(?=\/|$)/, "") || "/";
  if (locale !== "ar") return unprefixedPath;

  return unprefixedPath === "/" ? "/ar" : `/ar${unprefixedPath}`;
}

export function localizeHref(href: Href, locale: string): Href {
  if (typeof href === "string") {
    const match = href.match(/^([^?#]*)(.*)$/);
    if (!match) return href;
    return `${localizePath(match[1], locale)}${match[2]}`;
  }

  return href.pathname
    ? { ...href, pathname: localizePath(href.pathname, locale) }
    : href;
}

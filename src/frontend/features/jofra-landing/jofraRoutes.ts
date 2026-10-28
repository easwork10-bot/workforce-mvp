const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function normalizedPath(pathname: string): string {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (withLeadingSlash === "/") return "/";
  return withLeadingSlash.replace(/\/+$/, "");
}

export function getJofraPath(
  locale: string,
  pathname: string,
  basePath = BASE_PATH,
): string {
  const path = normalizedPath(pathname);
  const resolvedLocale = locale === "ar" ? "ar" : "nl";
  const localePrefix = resolvedLocale === "ar" ? "/ar" : "";
  const staticPath = basePath && path !== "/" ? `${path}/` : path;
  return `${basePath}${localePrefix}${staticPath}`;
}

export function getAlternateJofraPath(
  pathname: string,
  locale: string,
  basePath = BASE_PATH,
): string {
  let path = pathname;
  if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length) || "/";
  path = path.replace(/^\/(?:nl|ar)(?=\/|$)/, "") || "/";
  return getJofraPath(locale, path, basePath);
}

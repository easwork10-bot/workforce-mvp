import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build, createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "out");
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "/workforce-mvp").replace(/\/+$/, "");
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://easwork10-bot.github.io";

assert.ok(basePath.startsWith("/") && basePath !== "/", "NEXT_PUBLIC_BASE_PATH must be a non-root absolute path.");
const configModule = await import("./jofra-pages/vite.config.mjs");
const viteConfig = configModule.default;
viteConfig.define["process.env.NEXT_PUBLIC_APP_URL"] = JSON.stringify(appUrl);
await build(viteConfig);

const manifest = JSON.parse(await readFile(path.join(outputRoot, ".vite", "manifest.json"), "utf8"));
const clientEntry = manifest["scripts/jofra-pages/client.tsx"];
assert.ok(clientEntry?.file, "The Jofra browser entry was not emitted.");
const stylesheet = clientEntry.css?.[0];
assert.ok(stylesheet, "The Jofra stylesheet was not emitted.");

const server = await createServer({
  ...viteConfig,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
});

try {
  const { JofraPage } = await server.ssrLoadModule("/scripts/jofra-pages/page.tsx");
  const { JofraRuntime } = await server.ssrLoadModule("/scripts/jofra-pages/runtime.tsx");
  const { jofraMetadata } = await server.ssrLoadModule("/src/lib/jofra-metadata.ts");
  const routes = [
    { path: "/", locale: "nl", page: "home" },
    { path: "/nl/", locale: "nl", page: "home" },
    { path: "/ar/", locale: "ar", page: "home" },
    { path: "/aanvragen/", locale: "nl", page: "request" },
    { path: "/nl/aanvragen/", locale: "nl", page: "request" },
    { path: "/ar/aanvragen/", locale: "ar", page: "request" },
    { path: "/werken-bij-jofra/", locale: "nl", page: "recruitment" },
    { path: "/nl/werken-bij-jofra/", locale: "nl", page: "recruitment" },
    { path: "/ar/werken-bij-jofra/", locale: "ar", page: "recruitment" },
  ];

  for (const route of routes) {
    const pathname = route.path.replace(/\/+$/, "") || "/";
    const content = renderToString(createElement(
      JofraRuntime,
      { locale: route.locale, pathname },
      createElement(JofraPage, { page: route.page }),
    ));
    const metadata = jofraMetadata(route.locale, route.page);
    const alternates = metadata.alternates?.languages ?? {};
    const html = `<!doctype html>
<html lang="${route.locale}" dir="${route.locale === "ar" ? "rtl" : "ltr"}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(metadata.title)}</title>
    <meta name="description" content="${escapeAttribute(metadata.description)}">
    <link rel="icon" href="${basePath}/jofra/assets/logo-source.png">
    <link rel="canonical" href="${escapeAttribute(metadata.alternates?.canonical ?? "")}">
    <link rel="alternate" hreflang="nl" href="${escapeAttribute(alternates.nl ?? "")}">
    <link rel="alternate" hreflang="ar" href="${escapeAttribute(alternates.ar ?? "")}">
    <link rel="alternate" hreflang="x-default" href="${escapeAttribute(alternates["x-default"] ?? "")}">
    <link rel="stylesheet" href="${basePath}/${stylesheet}">
    <script type="module" src="${basePath}/${clientEntry.file}"></script>
  </head>
  <body style="margin:0">
    <div id="jofra-root" data-locale="${route.locale}" data-page="${route.page}" data-pathname="${escapeAttribute(pathname)}">${content}</div>
  </body>
</html>`;
    const relativeRoute = route.path.replace(/^\/+|\/+$/g, "");
    const routeDirectory = path.join(outputRoot, relativeRoute);
    await mkdir(routeDirectory, { recursive: true });
    await writeFile(path.join(routeDirectory, "index.html"), html);
  }
} finally {
  await server.close();
}

await cp(path.join(projectRoot, "public", "jofra", "assets"), path.join(outputRoot, "jofra", "assets"), {
  recursive: true,
});
await rm(path.join(outputRoot, ".vite"), { recursive: true, force: true });

console.log(`Built ${9} Jofra Pages routes from the primary application source in ${path.relative(projectRoot, outputRoot)}.`);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

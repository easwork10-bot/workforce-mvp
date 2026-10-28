import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.resolve(process.argv[2] ?? path.join(projectRoot, "showcase", "out"));
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

assert.ok(basePath.startsWith("/"), "NEXT_PUBLIC_BASE_PATH must be an absolute path.");

const routes = [
  { file: "index.html", locale: "nl", dir: "ltr" },
  { file: "nl/index.html", locale: "nl", dir: "ltr" },
  { file: "ar/index.html", locale: "ar", dir: "rtl" },
  { file: "nl/aanvragen/index.html", locale: "nl", dir: "ltr", form: "nl" },
  { file: "ar/aanvragen/index.html", locale: "ar", dir: "rtl", form: "ar" },
  { file: "nl/werken-bij-jofra/index.html", locale: "nl", dir: "ltr", form: "nl" },
  { file: "ar/werken-bij-jofra/index.html", locale: "ar", dir: "rtl", form: "ar" },
];
const staticFormNotice = {
  nl: "Dit is een statische voorbeeldsite.",
  ar: "هذا موقع معاينة ثابت.",
};
const assetReferences = new Set();
const stylesheetReferences = new Set();
let nextAssetFound = false;

for (const route of routes) {
  const html = await readFile(path.join(outputRoot, route.file), "utf8");
  assert.match(html, new RegExp(`<html[^>]*lang="${route.locale}"`), `${route.file} has the expected language`);
  assert.match(html, new RegExp(`<html[^>]*dir="${route.dir}"`), `${route.file} has the expected text direction`);
  assert.ok(html.includes(`${basePath}/_next/static/`), `${route.file} uses the Pages base path for Next assets`);
  assert.ok(!html.includes("/_next/image"), `${route.file} does not depend on the unavailable Next image optimizer`);

  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = match[1];
    if (url.startsWith("/_next/")) {
      assert.fail(`${route.file} contains a Next asset URL without the Pages base path: ${url}`);
    }
    if (url.startsWith(`${basePath}/_next/static/`)) nextAssetFound = true;
    const stylesheetMatch = url.match(new RegExp(`^${basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/_next/static/css/(.+)$`));
    if (stylesheetMatch) stylesheetReferences.add(decodeURIComponent(stylesheetMatch[1]));
    const assetMatch = url.match(new RegExp(`^${basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/jofra/assets/(.+)$`));
    if (assetMatch) assetReferences.add(decodeURIComponent(assetMatch[1]));
  }

  if (route.form) {
    assert.ok(html.includes(staticFormNotice[route.form]), `${route.file} explains static form limitations`);
    assert.match(html, /<fieldset[^>]*disabled/, `${route.file} disables static form controls`);
  }
}

assert.ok(nextAssetFound, "At least one base-path-qualified Next asset is present.");
assert.ok(assetReferences.size > 0, "The pages reference Jofra image assets.");
assert.ok(stylesheetReferences.size > 0, "The pages reference compiled stylesheets.");

for (const asset of assetReferences) {
  await access(path.join(outputRoot, "jofra", "assets", asset));
}

const fontReferences = new Set();
for (const stylesheet of stylesheetReferences) {
  const css = await readFile(path.join(outputRoot, "_next", "static", "css", stylesheet), "utf8");
  for (const match of css.matchAll(/url\((?:["']?)([^)"']+)(?:["']?)\)/g)) {
    const url = match[1];
    if (url.includes("/_next/static/media/")) {
      assert.ok(url.startsWith(`${basePath}/_next/static/media/`), `Font URL uses the Pages base path: ${url}`);
      const file = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
      fontReferences.add(file);
    }
  }
}

assert.ok(fontReferences.size >= 8, "The shared self-hosted Jofra font subsets are present.");
for (const font of fontReferences) {
  await access(path.join(outputRoot, "_next", "static", "media", font));
}

console.log(`Verified ${routes.length} static routes, ${assetReferences.size} Jofra images, ${fontReferences.size} self-hosted font files, base path ${basePath}, and Dutch/Arabic direction.`);

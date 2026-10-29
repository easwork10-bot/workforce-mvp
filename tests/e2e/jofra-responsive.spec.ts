import { expect, test } from "@playwright/test";

const arrowGlyphs = /[\u2190-\u21ff\u27a1\u2b05-\u2b07]/;
const photoSelectors = [
  ".hero-image", ".expertise-photo-main", ".expertise-photo-detail",
  ".benefits-photo", ".field-photo", ".process-photo",
  ".practice-photo-day", ".practice-photo-night",
];

for (const width of [1440, 768, 390, 320]) {
  test(`all public pages preserve images, SVG icons and layout at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    const mainImageSizes = new Map<string, { width: number; height: number }[]>();
    page.on("pageerror", (error) => errors.push(error.message));

    for (const staticPreview of [false, true]) {
      for (const locale of ["nl", "ar"]) {
        for (const route of ["", "aanvragen", "werken-bij-jofra"]) {
          const prefix = staticPreview ? "http://127.0.0.1:4173/workforce-mvp" : "";
          const localePath = locale === "ar" ? "/ar" : "";
          const suffix = route ? `/${route}` : "";
          const url = `${prefix}${localePath}${suffix}${staticPreview ? "/" : ""}` || "/";
          await page.goto(url, { waitUntil: "networkidle" });
          const photos = page.locator('.jofra-page img[src$=".webp"]');
          await expect(photos).toHaveCount(route ? 1 : 8);
          for (const photo of await photos.all()) {
            await expect(photo).toHaveAttribute("srcset", /\.webp \d+w/);
            await expect(photo).toHaveAttribute("sizes", /.+/);
            const isHero = await photo.evaluate(image => Boolean(image.closest(".hero-image")));
            await expect(photo).toHaveAttribute("loading", isHero ? "eager" : "lazy");
            if (isHero) await expect(photo).toHaveAttribute("fetchpriority", "high");
          }
          await page.evaluate(async () => {
            for (const image of document.images) image.loading = "eager";
            await document.fonts.ready;
            await Promise.all([...document.images].map(image => image.decode()));
          });
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
          expect(await page.locator("body").innerText()).not.toMatch(arrowGlyphs);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

          const images = await page.locator(".jofra-page img").evaluateAll(elements => elements.map(image => {
            const img = image as HTMLImageElement;
            const box = img.getBoundingClientRect();
            const container = img.parentElement!.getBoundingClientRect();
            return { src: img.src, currentSrc: img.currentSrc, loaded: img.complete && img.naturalWidth > 0,
              width: box.width, height: box.height,
              containerWidth: container.width, containerHeight: container.height };
          }));
          const pageKey = `${locale}/${route}`;
          if (staticPreview) {
            const mainImages = mainImageSizes.get(pageKey)!;
            expect(images).toHaveLength(mainImages.length);
            for (let index = 0; index < images.length; index++) {
              expect(Math.abs(images[index].width - mainImages[index].width), `${pageKey} image ${index} width`).toBeLessThan(2);
              expect(Math.abs(images[index].height - mainImages[index].height), `${pageKey} image ${index} height`).toBeLessThan(2);
            }
          } else {
            mainImageSizes.set(pageKey, images);
          }
          for (const image of images) {
            expect(image.loaded, image.src).toBe(true);
            expect(image.width, image.src).toBeGreaterThan(0);
            expect(image.height, image.src).toBeGreaterThan(0);
            if (!image.src.endsWith("logo-source.png")) {
              expect(image.currentSrc).toMatch(/\.webp$/);
              if (width <= 390 && await page.evaluate(() => devicePixelRatio) === 1 && !image.src.includes("05_s04")) {
                expect(image.currentSrc).toMatch(/-480w\.webp$/);
              }
              expect(Math.abs(image.width - image.containerWidth), image.src).toBeLessThan(2);
              expect(Math.abs(image.height - image.containerHeight), image.src).toBeLessThan(2);
            }
          }

          const languageSwitch = page.locator("a.language-switch");
          const alternate = `${staticPreview ? "/workforce-mvp" : ""}${locale === "nl" ? "/ar" : ""}${suffix || "/"}${staticPreview && suffix ? "/" : ""}`;
          await expect(languageSwitch).toHaveAttribute("href", alternate);
          await expect(page.locator('a[href^="/workforce-mvp/nl"], a[href="/nl"], a[href^="/nl/"]')).toHaveCount(0);
          if (width <= 768) {
            for (const target of await page.locator(
              ".site-header .brand, .language-switch, button.menu, .footer a, .public-card-support p a, .public-footer-home",
            ).all()) {
              const box = await target.boundingBox();
              if (box) expect(box.height).toBeGreaterThanOrEqual(44);
            }
          }
          await expect(page.locator(".jofra-arrow-icon")).toHaveCount(route ? 2 : 16);
          for (const icon of await page.locator(".jofra-arrow-icon").all()) {
            await expect(icon).toHaveAttribute("aria-hidden", "true");
            await expect(icon).toHaveAttribute("focusable", "false");
            await expect(icon.locator("path")).toHaveAttribute("d", /^M.+/);
            const size = await icon.boundingBox();
            if (size) {
              expect(size.width).toBeGreaterThanOrEqual(12);
              expect(size.height).toBeCloseTo(size.width, 1);
            }
          }

          if (!route) {
            const benefitsHeading = (await page.locator(".benefits-copy").boundingBox())!;
            const benefitsPhoto = (await page.locator(".benefits-photo").boundingBox())!;
            const benefitsList = (await page.locator(".benefit-grid").boundingBox())!;
            const processHeading = (await page.locator(".process-head").boundingBox())!;
            const processPhoto = (await page.locator(".process-photo").boundingBox())!;
            const processSteps = (await page.locator(".process-grid").boundingBox())!;
            expect(processPhoto.width / processPhoto.height).toBeCloseTo(.65, 2);
            if (width <= 650) {
              for (const [heading, photo, list] of [
                [benefitsHeading, benefitsPhoto, benefitsList],
                [processHeading, processPhoto, processSteps],
              ]) {
                expect(photo.y - (heading.y + heading.height)).toBeCloseTo(28, 0);
                expect(list.y - (photo.y + photo.height)).toBeCloseTo(28, 0);
                expect(Math.abs(photo.x + photo.width / 2 - (heading.x + heading.width / 2))).toBeLessThan(2);
              }
              expect(processPhoto.height).toBeLessThan(380);
              expect(benefitsPhoto.width / benefitsHeading.width).toBeCloseTo(.82, 2);
            } else {
              expect(benefitsList.y).toBeGreaterThanOrEqual(benefitsPhoto.y + benefitsPhoto.height);
              expect(Math.min(benefitsHeading.x + benefitsHeading.width, benefitsPhoto.x + benefitsPhoto.width))
                .toBeLessThanOrEqual(Math.max(benefitsHeading.x, benefitsPhoto.x));
              expect(Math.min(processSteps.x + processSteps.width, processPhoto.x + processPhoto.width))
                .toBeLessThanOrEqual(Math.max(processSteps.x, processPhoto.x));
            }
            const imageLabel = page.locator(".hero .image-label");
            if (await imageLabel.isVisible()) {
              const labelBox = await imageLabel.boundingBox();
              expect(labelBox).not.toBeNull();
              expect(labelBox!.height).toBeLessThan(60);
            }
            for (const description of await page.locator(".service-desc").all()) {
              await expect(description).toBeVisible();
            }
            for (const selector of photoSelectors) {
              const photo = page.locator(selector);
              const bounds = await photo.boundingBox();
              expect(bounds?.width, selector).toBeGreaterThan(100);
              expect(bounds?.height, selector).toBeGreaterThan(150);
            }
            // These portraits must retain their natural framing, without zoom or head clipping.
            for (const selector of [".field-photo", ".benefits-photo", ".practice-photo-night"]) {
              const box = await page.locator(selector).boundingBox();
              expect(box!.width / box!.height, selector).toBeCloseTo(.75, 2);
            }
            const draw = page.locator(".process-grid .route-draw");
            await expect.poll(() => draw.evaluate(path => parseFloat(path.style.strokeDashoffset))).toBe(0);
            if (width <= 768) {
              const menu = page.locator("button.menu");
              await menu.click();
              await expect(menu).toHaveAttribute("aria-expanded", "true");
              await page.locator("#jofra-navlinks a").first().click();
              await expect(menu).toHaveAttribute("aria-expanded", "false");
              await expect(page).toHaveURL(/#diensten$/);
              await page.waitForLoadState("networkidle");
            }
          } else if (staticPreview) {
            await expect(page.locator("fieldset")).toHaveAttribute("disabled", "");
            await expect(page.locator('form button[type="submit"]')).toBeDisabled();
            await expect(page.locator(".public-alert")).toBeVisible();
          } else {
            await expect(page.locator('form button[type="submit"]')).toBeEnabled();
          }
        }
      }
    }
    expect(errors).toEqual([]);
  });
}

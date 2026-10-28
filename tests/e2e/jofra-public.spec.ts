import { expect, test, type Page } from "@playwright/test";

const staticPagesUrl = "http://127.0.0.1:4173/workforce-mvp";

async function expectArabicFont(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).first().evaluate(
    (element) => getComputedStyle(element).fontFamily,
  )).toContain('"Jofra Noto Sans Arabic"');
  const loaded = await page.evaluate(async () => {
    const sample = "السلام عليكم";
    await document.fonts.load('40px "Jofra Noto Sans Arabic"', sample);
    return document.fonts.check('40px "Jofra Noto Sans Arabic"', sample);
  });
  expect(loaded).toBe(true);
}

test("main Jofra landing loads its images and the process line reverses with scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator(".site-header nav")).toBeVisible();
  await expect(page.locator(".hero .hero-headline")).toBeVisible();
  await expect.poll(() => page.locator(".hero-image img").evaluate(
    (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
  )).toBe(true);

  const drawPath = page.locator(".process-grid .route-draw");
  await expect.poll(() => drawPath.evaluate((path) => path.closest(".process-grid")?.classList.contains("route-ready")))
    .toBe(true);

  const offsetAtTop = await drawPath.evaluate((path) => Number(path.style.strokeDashoffset));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => drawPath.evaluate((path) => Number(path.style.strokeDashoffset)))
    .toBeLessThan(offsetAtTop);
  const offsetAtBottom = await drawPath.evaluate((path) => Number(path.style.strokeDashoffset));
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => drawPath.evaluate((path) => Number(path.style.strokeDashoffset)))
    .toBeGreaterThan(offsetAtBottom);
});

test("mobile navigation works and the inquiry form validates before a mocked submission", async ({ page }) => {
  let interceptedSubmissions = 0;
  await page.route("**/api/public/jofra/inquiries", async (route) => {
    interceptedSubmissions += 1;
    await route.fulfill({ status: 202, contentType: "application/json", body: '{"ok":true}' });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const menuButton = page.locator(".site-header button.menu");
  await menuButton.click();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await page.locator("#jofra-navlinks .nav-panel-quote").click();
  await expect(page).toHaveURL(/\/aanvragen$/);
  await expect(page.locator("form")).toBeVisible();
  await page.waitForLoadState("networkidle");

  const companyName = page.locator('input[name="companyName"]');
  await page.locator('button[type="submit"]').click();
  await expect(companyName).toHaveAttribute("aria-invalid", "true");
  expect(interceptedSubmissions).toBe(0);

  const values: Record<string, string> = {
    companyName: "Voorbeeld BV",
    contactName: "Test Contact",
    email: "test@example.com",
    phone: "+31612345678",
    location: "Maastricht",
    startDate: "2027-01-10",
    endDate: "2027-01-11",
    workingHours: "08:00-17:00",
    quantity: "2",
  };
  for (const [name, value] of Object.entries(values)) {
    await page.locator(`[name="${name}"]`).fill(value);
  }
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole("status")).toBeVisible();
  expect(interceptedSubmissions).toBe(1);
});

test("Arabic layout uses RTL typography without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".jofra-page")).toHaveAttribute("dir", "rtl");
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  )).toBe(true);

  const heading = page.locator(".hero-headline");
  await expect(heading).toBeVisible();
  const textFits = await heading.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  expect(textFits).toBe(true);
  await expectArabicFont(page, ".hero-headline");
  await expectArabicFont(page, ".site-header .navlinks a");

  const processPath = page.locator(".process-grid .route-draw");
  await expect.poll(() => processPath.evaluate(
    (path) => path.closest(".process-grid")?.classList.contains("route-ready"),
  )).toBe(true);
  const verticalPathX = await processPath.evaluate((path) => {
    const track = path.closest(".process-grid");
    const svg = path.closest("svg");
    const x = Number(path.getAttribute("d")?.match(/^M([-\d.]+)/)?.[1]);
    return { x, width: track?.getBoundingClientRect().width ?? 0, transform: svg ? getComputedStyle(svg).transform : "" };
  });
  expect(verticalPathX.x).toBeGreaterThan(verticalPathX.width / 2);
  expect(verticalPathX.transform).toBe("none");

  const offsetAtTop = await processPath.evaluate((path) => Number(path.style.strokeDashoffset));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => processPath.evaluate((path) => Number(path.style.strokeDashoffset)))
    .toBeLessThan(offsetAtTop);
  const offsetAtBottom = await processPath.evaluate((path) => Number(path.style.strokeDashoffset));
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => processPath.evaluate((path) => Number(path.style.strokeDashoffset)))
    .toBeGreaterThan(offsetAtBottom);
});

test("reduced motion leaves the process route fully drawn", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const drawPath = page.locator(".process-grid .route-draw");
  await expect.poll(() => drawPath.evaluate((path) => Number(path.style.strokeDashoffset)))
    .toBe(0);
});

test("static Pages export exposes canonical Dutch routes and a disabled Arabic preview form", async ({ page }) => {
  await page.goto(`${staticPagesUrl}/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.locator("a.language-switch")).toHaveAttribute("href", "/workforce-mvp/ar/");

  await page.goto(`${staticPagesUrl}/aanvragen/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.locator('form input[name="companyName"]')).toBeDisabled();
  await expect(page.locator('form button[type="submit"]')).toBeDisabled();
  await expect(page.locator(".public-alert")).toBeVisible();
  await expect.poll(() => page.locator(".public-card-photo img").evaluate(
    (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
  )).toBe(true);

  await page.goto(`${staticPagesUrl}/ar/aanvragen/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("a.language-switch")).toHaveAttribute("href", "/workforce-mvp/aanvragen/");
  await expect(page.locator('form input[name="companyName"]')).toBeDisabled();
  await expect(page.locator('form button[type="submit"]')).toBeDisabled();
  await expectArabicFont(page, ".public-content h1");
  await expectArabicFont(page, "form label");
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  )).toBe(true);

  await page.goto(`${staticPagesUrl}/ar/werken-bij-jofra/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator('form input[name="fullName"]')).toBeDisabled();
  await expect(page.locator('form button[type="submit"]')).toBeDisabled();
  await expect.poll(() => page.locator(".public-card-photo img").evaluate(
    (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
  )).toBe(true);
  await expectArabicFont(page, ".public-content h1");
  await expectArabicFont(page, "form label");
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  )).toBe(true);
});

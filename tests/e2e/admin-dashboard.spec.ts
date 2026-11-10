import { expect } from '@playwright/test';
import { adminTest as test } from './authenticated-test';

const shiftId = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';

function shift() {
  return {
    id: shiftId,
    title: 'Future traffic control',
    workType: 'Traffic control',
    clientOrProject: 'City project',
    location: 'Amsterdam',
    startAt: '2099-01-15T08:00:00.000Z',
    endAt: '2099-01-15T16:00:00.000Z',
    requiredWorkers: 2,
    status: 'open',
    applicationCount: 0,
    assignedCount: 0,
  };
}

for (const locale of ['nl', 'ar'] as const) {
  for (const width of [1280, 390]) {
    test(`${locale} admin dashboard shows live shift data at ${width}px`, async ({ page }) => {
      await page.route('**/api/admin/shifts?*', route => route.fulfill({
        json: {
          shifts: [shift()],
          pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
          stats: { total: 1, draft: 0, open: 1, filled: 0, cancelled: 0, completed: 0 },
        },
      }));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(locale === 'ar' ? '/ar/admin' : '/nl/admin');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.getByText('Future traffic control')).toBeVisible();
      const expectedStats = [1, 0, 1, 0];
      for (const [index, key] of ['total', 'draft', 'open', 'filled'].entries()) {
        const formatted = await page.evaluate(
          ({ value, language }) => new Intl.NumberFormat(language).format(value),
          { value: expectedStats[index], language: locale === 'ar' ? 'ar' : 'nl-NL' },
        );
        await expect(page.getByTestId(`admin-dashboard-stat-${key}`)).toHaveText(formatted);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }

  test(`${locale} admin dashboard shows localized errors and retries`, async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/admin/shifts?*', async route => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({ status: 503, json: { error: 'English backend error' } });
        return;
      }
      await route.fulfill({
        json: {
          shifts: [shift()],
          pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
          stats: { total: 12, draft: 3, open: 4, filled: 5, cancelled: 0, completed: 0 },
        },
      });
    });
    const loadError = locale === 'ar' ? 'تعذر تحميل المناوبات.' : 'De diensten konden niet worden geladen.';
    const retry = locale === 'ar' ? 'إعادة المحاولة' : 'Opnieuw proberen';
    await page.goto(locale === 'ar' ? '/ar/admin' : '/nl/admin');
    const errorMessage = page.locator('p[role="alert"]');
    await expect(errorMessage).toHaveText(loadError);
    await expect(errorMessage).not.toContainText('English backend error');
    await page.getByRole('button', { name: retry }).click();
    await expect(page.getByText('Future traffic control')).toBeVisible();
    await expect.poll(() => attempts).toBe(2);
    for (const [key, value] of [['total', 12], ['draft', 3], ['open', 4], ['filled', 5]] as const) {
      const formatted = await page.evaluate(
        ({ input, language }) => new Intl.NumberFormat(language).format(input),
        { input: value, language: locale === 'ar' ? 'ar' : 'nl-NL' },
      );
      await expect(page.getByTestId(`admin-dashboard-stat-${key}`)).toHaveText(formatted);
    }
  });
}

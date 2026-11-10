import { expect } from '@playwright/test';
import { adminTest as test } from './authenticated-test';

const shiftId = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';

function shift(status: 'draft' | 'open') {
  return {
    id: shiftId,
    title: 'Future traffic control',
    workType: 'Traffic control',
    clientOrProject: 'City project',
    location: 'Amsterdam',
    startAt: '2099-01-15T08:00:00.000Z',
    endAt: '2099-01-15T16:00:00.000Z',
    requiredWorkers: 2,
    status,
    applicationCount: 0,
    assignedCount: 0,
  };
}

function stats() {
  return { total: 1, draft: 1, open: 0, filled: 0, cancelled: 0, completed: 0 };
}

for (const locale of ['nl', 'ar']) {
  for (const width of [1280, 390]) {
    test(`${locale} admin shifts list and publish work at ${width}px`, async ({ page }) => {
      let currentStatus: 'draft' | 'open' = 'draft';
      const queries: string[] = [];

      await page.route('**/api/admin/shifts?*', async (route) => {
        const url = new URL(route.request().url());
        queries.push(url.search);
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            shifts: url.searchParams.get('status') === 'draft' && currentStatus === 'open'
              ? []
              : [shift(currentStatus)],
            pagination: { page: Number(url.searchParams.get('page') ?? 1), limit: 20, total: 21, totalPages: 2 },
            stats: stats(),
          }),
        });
      });
      await page.route('**/api/auth/csrf', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
      }));
      await page.route(`**/api/admin/shifts/${shiftId}/publish`, async (route) => {
        currentStatus = 'open';
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ shift: shift('open'), message: 'Shift published successfully' }),
        });
      });

      await page.setViewportSize({ width, height: 900 });
      await page.goto(locale === 'ar' ? '/ar/admin/shifts' : '/admin/shifts');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('h1')).toHaveText(locale === 'ar' ? 'قائمة المناوبات' : 'Overzicht shifts');
      await expect(page.getByRole('link', { name: 'Workforce MVP' })).toBeVisible();
      if (width < 768) {
        await page.getByRole('button', { name: locale === 'ar' ? 'قائمة' : 'Menu' }).click();
      }
      await expect(page.getByRole('link', {
        name: locale === 'ar' ? 'إدارة الموظفين' : 'Werknemers',
      })).toBeVisible();
      if (width < 768) {
        await page.keyboard.press('Escape');
      }
      const shiftRow = page.locator('li').filter({ hasText: 'Future traffic control' });
      await expect(shiftRow).toBeVisible();

      const publishLabel = locale === 'ar' ? 'نشر' : 'Publiceren';
      await page.getByRole('button', { name: publishLabel }).click();
      await expect(shiftRow.getByText(locale === 'ar' ? 'مفتوح' : 'Open')).toBeVisible();

      const statusSelect = page.getByLabel(locale === 'ar' ? 'تصفية حسب الحالة' : 'Filter op status');
      await statusSelect.selectOption('open');
      await expect.poll(() => queries.at(-1)).toContain('status=open');
      await expect(shiftRow).toBeVisible();
      await page.getByRole('button', { name: locale === 'ar' ? 'التالي' : 'Volgende' }).click();
      await expect.poll(() => queries.at(-1)).toContain('page=2');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }
}

for (const locale of ['nl', 'ar']) {
  test(`${locale} publishing the last shift on a page returns to the last available page`, async ({ page }) => {
    let published = false;
    const queries: URL[] = [];
    await page.route('**/api/admin/shifts?*', async (route) => {
      const url = new URL(route.request().url());
      queries.push(url);
      const currentPage = Number(url.searchParams.get('page'));
      const total = published ? 20 : 21;
      const shifts = currentPage === 2 && !published
        ? [shift('draft')]
        : currentPage === 1
          ? [{ ...shift('draft'), id: 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a2', title: 'Remaining draft' }]
          : [];
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          shifts,
          pagination: { page: currentPage, limit: 20, total, totalPages: Math.ceil(total / 20) },
          stats: stats(),
        }),
      });
    });
    await page.route('**/api/auth/csrf', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
    }));
    await page.route(`**/api/admin/shifts/${shiftId}/publish`, async route => {
      published = true;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ shift: shift('open'), message: 'Shift published successfully' }),
      });
    });

    await page.goto(locale === 'ar' ? '/ar/admin/shifts' : '/admin/shifts');
    const filteredPage = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/admin/shifts'
        && url.searchParams.get('status') === 'draft'
        && url.searchParams.get('page') === '1';
    });
    await page.getByLabel(locale === 'ar' ? 'تصفية حسب الحالة' : 'Filter op status').selectOption('draft');
    expect((await filteredPage).status()).toBe(200);
    await expect(page.getByRole('button', { name: locale === 'ar' ? 'التالي' : 'Volgende' })).toBeEnabled();
    await page.getByRole('button', { name: locale === 'ar' ? 'التالي' : 'Volgende' }).click();
    await expect.poll(() => queries.at(-1)?.searchParams.get('page')).toBe('2');
    await page.getByRole('button', { name: locale === 'ar' ? 'نشر' : 'Publiceren' }).click();

    await expect.poll(() => queries.at(-1)?.searchParams.get('page')).toBe('1');
    await expect(page.getByText('Remaining draft')).toBeVisible();
    await expect(page.getByRole('button', { name: locale === 'ar' ? 'التالي' : 'Volgende' })).toHaveCount(0);
  });

  test(`${locale} admin can create a draft with Dutch winter-time conversion`, async ({ page }) => {
    let submittedBody: Record<string, unknown> | null = null;
    await page.route('**/api/auth/csrf', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
    }));
    await page.route('**/api/admin/shifts?*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          shifts: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          stats: stats(),
        }),
      });
    });
    await page.route('**/api/admin/shifts', async (route) => {
      submittedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          shift: { id: shiftId, status: 'draft' },
          message: 'Shift created successfully',
        }),
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(locale === 'ar' ? '/ar/admin/shifts/create' : '/admin/shifts/create');
    await page.getByRole('button', { name: locale === 'ar' ? 'قائمة' : 'Menu' }).click();
    await expect(page.getByRole('link', {
      name: locale === 'ar' ? 'إدارة الموظفين' : 'Werknemers',
    })).toBeVisible();
    await page.keyboard.press('Escape');
    const titleField = page.getByLabel(locale === 'ar' ? 'المسمى الوظيفي *' : 'Functietitel *');
    await page.getByLabel(locale === 'ar' ? 'نوع العمل *' : 'Type werk *').fill('Traffic control');
    await page.getByLabel(locale === 'ar' ? 'الموقع *' : 'Locatie *').fill('Amsterdam');
    await page.getByLabel(locale === 'ar' ? 'التاريخ *' : 'Datum *').fill('2099-01-15');
    await page.getByLabel(locale === 'ar' ? 'وقت البداية *' : 'Starttijd *').fill('09:00');
    await page.getByLabel(locale === 'ar' ? 'وقت النهاية *' : 'Eindtijd *').fill('17:00');
    await titleField.fill('Future traffic control');
    await expect(titleField).toHaveValue('Future traffic control');
    const createdResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/admin/shifts'
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: locale === 'ar' ? 'حفظ' : 'Opslaan' }).click();
    const response = await createdResponse;
    expect(response.status()).toBe(201);
    expect(await response.finished()).toBeNull();
    expect(await response.json()).toMatchObject({ shift: { id: shiftId, status: 'draft' } });
    expect(submittedBody).toMatchObject({
      title: 'Future traffic control',
      startAt: '2099-01-15T08:00:00.000Z',
      endAt: '2099-01-15T16:00:00.000Z',
    });
    expect(submittedBody).not.toHaveProperty('status');
    await expect(page).toHaveURL(locale === 'ar' ? /\/ar\/admin\/shifts$/ : /\/nl\/admin\/shifts$/);
  });
}

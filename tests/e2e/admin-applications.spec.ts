import { expect, test, type Page } from '@playwright/test';
import type { AdminApplication, ApplicationStatus } from '@/shared/admin-applications';

const shiftId = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
const employeeId = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a2';
const labels = {
  nl: {
    title: 'Sollicitaties beheren', filter: 'Filter op status', review: 'Beoordelen',
    approve: 'Goedkeuren', reject: 'Afwijzen', next: 'Volgende', previous: 'Vorige',
    pending: 'In afwachting', accepted: 'Geaccepteerd', rejected: 'Afgewezen', cancelled: 'Geannuleerd',
    empty: 'Geen sollicitaties gevonden voor dit filter.', retry: 'Opnieuw proberen',
    loadError: 'Sollicitaties konden niet worden geladen. Probeer het opnieuw.',
  },
  ar: {
    title: 'إدارة طلبات التوظيف', filter: 'تصفية حسب الحالة', review: 'مراجعة',
    approve: 'قبول', reject: 'رفض', next: 'التالي', previous: 'السابق',
    pending: 'قيد الانتظار', accepted: 'مقبول', rejected: 'مرفوض', cancelled: 'ملغى',
    empty: 'لا توجد طلبات لهذا المرشح.', retry: 'إعادة المحاولة',
    loadError: 'تعذر تحميل الطلبات. حاول مرة أخرى.',
  },
};

function application(index: number, status: ApplicationStatus = 'pending'): AdminApplication {
  return {
    id: `c2df4e6f-72a7-4e7a-9de1-${String(index).padStart(12, '0')}`,
    shiftId, employeeId, status, rejectionReason: null, appliedAt: '2026-11-01T10:00:00.000Z',
    employee: { fullName: 'Test Applicant', email: 'applicant@workforce.test', phone: null },
    shift: {
      title: 'Traffic control application fixture', startAt: '2099-01-15T08:00:00.000Z',
      endAt: '2099-01-15T16:00:00.000Z', location: 'Amsterdam',
      status: 'open', requiredWorkers: 2, assignedCount: 0,
    },
  };
}

async function setup(page: Page, applications: AdminApplication[]) {
  const queries: URL[] = [];
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    user: { id: employeeId, fullName: 'Test Admin', email: 'admin@workforce.test', role: 'administrator', preferredLanguage: 'nl' },
  } }));
  await page.route('**/api/auth/csrf', route => route.fulfill({ json: { csrfToken: 'signed-test-token' } }));
  await page.route('**/api/admin/applications?*', route => {
    const url = new URL(route.request().url());
    queries.push(url);
    const filtered = applications.filter(item => !url.searchParams.get('status') || item.status === url.searchParams.get('status'));
    const currentPage = Number(url.searchParams.get('page'));
    return route.fulfill({ json: {
      applications: filtered.slice((currentPage - 1) * 20, currentPage * 20),
      pagination: { page: currentPage, limit: 20, total: filtered.length, totalPages: Math.ceil(filtered.length / 20) },
    } });
  });
  return queries;
}

for (const locale of ['nl', 'ar'] as const) {
  const text = labels[locale];
  const path = locale === 'ar' ? '/ar/admin/applications' : '/admin/applications';
  for (const width of [1280, 768, 390]) {
    test(`${locale} applications preserve history, filters and pagination at ${width}px`, async ({ page }, testInfo) => {
      const attempts = Array.from({ length: 24 }, (_, i) => application(i + 1,
        (['pending', 'accepted', 'rejected', 'cancelled'] as const)[i % 4]));
      const queries = await setup(page, attempts);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(text.title);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      const rows = page.locator('main li').filter({ hasText: 'Traffic control application fixture' });
      await expect(rows).toHaveCount(6);
      for (const status of ['accepted', 'rejected', 'cancelled', 'pending'] as const) {
        await page.getByLabel(text.filter).selectOption(status);
        await expect.poll(() => queries.at(-1)?.searchParams.get('status')).toBe(status);
        await expect(rows).toHaveCount(6);
        await expect(rows.first().getByText(text[status], { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: text.review, exact: true })).toHaveCount(status === 'pending' ? 6 : 0);
      }
      await page.getByLabel(text.filter).selectOption('');
      await expect(rows).toHaveCount(20);
      await expect.poll(() => queries.at(-1)?.searchParams.has('status')).toBe(false);
      await page.getByRole('button', { name: text.next, exact: true }).click();
      await expect(rows).toHaveCount(4);
      await expect.poll(() => queries.at(-1)?.searchParams.get('page')).toBe('2');
      await page.getByRole('button', { name: text.previous, exact: true }).click();
      await expect(rows).toHaveCount(20);
      if (width < 1024) {
        await page.getByRole('button', { name: locale === 'ar' ? 'قائمة' : 'Menu' }).click();
      }
      await expect(page.getByRole('link', { name: locale === 'ar' ? 'طلبات التوظيف' : 'Sollicitaties', exact: true })).toBeVisible();
      if (width < 1024) await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (testInfo.project.name === 'chromium' && ((locale === 'nl' && width === 1280) || (locale === 'ar' && width === 390))) {
        await page.screenshot({ path: testInfo.outputPath('applications.png') });
      }
    });
  }

  test(`${locale} approval and rejection refresh status and capacity and block duplicate clicks`, async ({ page }) => {
    const attempts = [application(1), application(2)];
    await setup(page, attempts);
    let writes = 0;
    let release: (() => void) | undefined;
    await page.route('**/api/admin/applications/*/review', async route => {
      writes++;
      expect(route.request().headers()['x-csrf-token']).toBe('signed-test-token');
      const body = route.request().postDataJSON();
      if (writes === 1) await new Promise<void>(resolve => { release = resolve; });
      const attempt = attempts.find(item => route.request().url().includes(item.id));
      if (!attempt) throw new Error('Missing fixture');
      attempt.status = body.status;
      attempt.rejectionReason = body.rejectionReason ?? null;
      if (body.status === 'accepted') attempts.forEach(item => { item.shift.assignedCount = 1; });
      await route.fulfill({ json: { success: true, code: 'APPLICATION_REVIEWED', replayed: false } });
    });
    await page.goto(path);
    await page.getByRole('button', { name: text.review, exact: true }).first().click();
    const approve = page.getByRole('button', { name: text.approve, exact: true });
    await approve.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect.poll(() => writes).toBe(1);
    await expect(page.getByRole('button', { name: text.reject, exact: true })).toBeDisabled();
    release?.();
    await expect(page.getByRole('status').filter({ hasText: locale === 'ar' ? 'تم قبول الطلب وحفظ التكليف.' : 'Sollicitatie goedgekeurd. De indeling is opgeslagen.' })).toBeVisible();
    await expect(page.getByText(locale === 'ar' ? 'المعينون: 1 / 2' : 'Ingedeeld: 1 / 2')).toBeVisible();
    await page.getByRole('button', { name: text.review, exact: true }).click();
    await page.getByLabel(locale === 'ar' ? 'سبب الرفض (اختياري)' : 'Reden voor afwijzing (optioneel)').fill('Not this time');
    await page.getByRole('button', { name: text.reject, exact: true }).click();
    await expect(page.getByText(text.empty)).toBeVisible();
    await page.getByLabel(text.filter).selectOption('');
    await expect(page.getByRole('main').getByRole('list').getByText(text.accepted, { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByRole('list').getByText(text.rejected, { exact: true })).toBeVisible();
    await expect(page.getByText('Not this time', { exact: false })).toBeVisible();
    expect(writes).toBe(2);
  });

  test(`${locale} loading, empty and network errors are recoverable`, async ({ page }) => {
    await setup(page, []);
    let fail = true;
    let release: (() => void) | undefined;
    await page.route('**/api/admin/applications?*', async route => {
      if (fail) {
        await new Promise<void>(resolve => { release = resolve; });
        return route.abort('failed');
      }
      await route.fallback();
    });
    await page.goto(path);
    await expect(page.getByRole('status')).toHaveText(locale === 'ar' ? 'جارٍ تحميل الطلبات…' : 'Sollicitaties laden…');
    await expect.poll(() => typeof release).toBe('function');
    release?.();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(text.loadError);
    fail = false;
    await page.getByRole('button', { name: text.retry }).click();
    await expect(page.getByText(text.empty)).toBeVisible();
  });

  test(`${locale} network review failure never claims success and refreshes unknown outcome`, async ({ page }) => {
    const queries = await setup(page, [application(1)]);
    await page.route('**/api/admin/applications/*/review', route => route.abort('failed'));
    await page.goto(path);
    await page.getByRole('button', { name: text.review, exact: true }).click();
    const reads = queries.length;
    await page.getByRole('button', { name: text.approve, exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(locale === 'ar' ? 'تعذر تأكيد القرار' : 'De beoordeling kon niet worden bevestigd');
    await expect.poll(() => queries.length).toBeGreaterThan(reads);
    await expect(page.getByRole('button', { name: text.review, exact: true })).toBeVisible();
  });
}

for (const code of ['APPLICATION_DECISION_CONFLICT', 'SHIFT_UNAVAILABLE', 'CAPACITY_REACHED', 'ACTIVE_ASSIGNMENT_EXISTS', 'APPLICATION_NOT_FOUND']) {
  test(`stale decision ${code} displays localized feedback and refreshes without success`, async ({ page }) => {
    const attempts = [application(1)];
    const queries = await setup(page, attempts);
    await page.route('**/api/admin/applications/*/review', route => {
      if (code === 'APPLICATION_DECISION_CONFLICT') attempts[0].status = 'cancelled';
      else if (code === 'APPLICATION_NOT_FOUND') attempts.length = 0;
      else { attempts[0].shift.status = 'filled'; attempts[0].shift.assignedCount = 2; }
      return route.fulfill({ status: code === 'APPLICATION_NOT_FOUND' ? 404 : 409, json: { error: 'server text', code } });
    });
    await page.goto('/admin/applications');
    await page.getByRole('button', { name: 'Beoordelen', exact: true }).click();
    const reads = queries.length;
    await page.getByRole('button', { name: 'Goedkeuren', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('De gegevens worden vernieuwd.');
    await expect(page.getByRole('main').getByRole('alert')).not.toContainText('server text');
    await expect.poll(() => queries.length).toBeGreaterThan(reads);
    if (['APPLICATION_DECISION_CONFLICT', 'APPLICATION_NOT_FOUND'].includes(code)) {
      await expect(page.getByText(labels.nl.empty)).toBeVisible();
    } else {
      await expect(page.getByText('Beschikbare plaatsen: 0')).toBeVisible();
    }
    await expect(page.getByText('Sollicitatie goedgekeurd. De indeling is opgeslagen.')).toHaveCount(0);
  });
}

test('identical decision replay is shown without inventing a second assignment', async ({ page }) => {
  const attempts = [application(1)];
  await setup(page, attempts);
  await page.route('**/api/admin/applications/*/review', route => {
    attempts[0].status = 'accepted';
    attempts[0].shift.assignedCount = 1;
    return route.fulfill({ json: { success: true, code: 'APPLICATION_REVIEWED', replayed: true } });
  });
  await page.goto('/admin/applications');
  await page.getByRole('button', { name: 'Beoordelen', exact: true }).click();
  await page.getByRole('button', { name: 'Goedkeuren', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Deze beoordeling was al opgeslagen. De gegevens zijn vernieuwd.' })).toBeVisible();
  await page.getByLabel('Filter op status').selectOption('accepted');
  await expect(page.getByText('Ingedeeld: 1 / 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Beoordelen', exact: true })).toHaveCount(0);
});

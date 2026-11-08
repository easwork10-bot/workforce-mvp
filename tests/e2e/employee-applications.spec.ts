import { expect } from '@playwright/test';
import { employeeTest as test } from './authenticated-test';

const applicationId = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';

for (const locale of ['nl', 'ar'] as const) {
  test(`${locale} employee refreshes application history after an uncertain cancellation`, async ({ page }) => {
    let status: 'pending' | 'cancelled' = 'pending';
    const reads: string[] = [];
    await page.route('**/api/auth/me', route => route.fulfill({ json: {
      user: {
        id: 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a2',
        fullName: 'Test Employee',
        email: 'employee@workforce.test',
        role: 'employee',
        preferredLanguage: locale,
      },
    } }));
    await page.route('**/api/employee/applications?*', route => {
      reads.push(new URL(route.request().url()).search);
      return route.fulfill({ json: {
        applications: [{
          id: applicationId,
          shiftId: 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a3',
          status,
          appliedAt: '2026-11-01T10:00:00.000Z',
          shift: {
            title: 'Traffic control fixture',
            startAt: '2099-01-15T08:00:00.000Z',
            endAt: '2099-01-15T16:00:00.000Z',
            location: 'Amsterdam',
          },
        }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      } });
    });
    await page.route('**/api/auth/csrf', route => route.fulfill({ json: { csrfToken: 'test-csrf-token' } }));
    await page.route(`**/api/employee/applications/${applicationId}/cancel`, async route => {
      status = 'cancelled';
      await route.abort('failed');
    });

    await page.goto(locale === 'ar' ? '/ar/employee/applications' : '/employee/applications');
    const cancelLabel = locale === 'ar' ? 'إلغاء الطلب' : 'Sollicitatie annuleren';
    const cancelledLabel = locale === 'ar' ? 'ملغي' : 'Geannuleerd';
    const networkMessage = locale === 'ar'
      ? 'تعذر الاتصال بالخادم. تحقق من اتصالك وحاول مجدداً.'
      : 'De server is niet bereikbaar. Controleer je verbinding en probeer opnieuw.';
    await expect(page.getByRole('button', { name: cancelLabel })).toBeVisible();
    const readsBeforeCancellation = reads.length;
    await page.getByRole('button', { name: cancelLabel }).click();

    await expect.poll(() => reads.length).toBeGreaterThan(readsBeforeCancellation);
    await expect(page.getByText(cancelledLabel, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: cancelLabel })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(networkMessage);
  });
}

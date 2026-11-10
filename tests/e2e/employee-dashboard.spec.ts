import { expect } from '@playwright/test';
import { employeeTest as test } from './authenticated-test';
import nl from '@/locales/nl.json';
import ar from '@/locales/ar.json';
const id = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
for (const locale of ['nl', 'ar'] as const) {
  const text = locale === 'nl' ? nl : ar;
  test(`${locale} dashboard loads real summary shape, retries errors and preserves locale`, async ({ page }) => {
    let failure = true;
    let release: (() => void) | undefined;
    await page.route('**/api/employee/schedule?*', route => route.fulfill({ json: {
      assignments: [], pagination: { page: Number(new URL(route.request().url()).searchParams.get('page')), limit: 20, total: 0, totalPages: 0 },
    } }));
    await page.route('**/api/employee/dashboard', async route => {
      if (failure) {
        await new Promise<void>(resolve => { release = resolve; });
        return route.fulfill({ status: 503, json: {} });
      }
      return route.fulfill({ json: {
        month: '2027-03', timeZone: 'Europe/Amsterdam', pendingApplications: 12, acceptedThisMonth: 7, workedHoursThisMonth: 5.5,
        recentApplications: ['pending', 'rejected', 'cancelled'].map((status, index) => ({
          id: id.slice(0, -1) + index, status, appliedAt: '2027-03-01T10:00:00Z',
          shift: { title: 'Real application ' + index, startAt: '2027-03-10T09:00:00Z', endAt: '2027-03-10T17:00:00Z', location: 'Amsterdam' },
        })),
      } });
    });
    await page.goto('/' + locale + '/employee');
    await expect(page.getByTestId('dashboard-pending')).toHaveText('—');
    await expect.poll(() => Boolean(release)).toBe(true);
    release!();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(text.employeeSchedule.unavailable);
    failure = false;
    await page.getByRole('button', { name: text.employeeSchedule.retry, exact: true }).click();
    const formatted = await page.evaluate(language => [12, 7, 5.5].map(value => new Intl.NumberFormat(language).format(value)), locale === 'ar' ? 'ar' : 'nl-NL');
    await expect(page.getByTestId('dashboard-pending')).toHaveText(formatted[0]);
    await expect(page.getByTestId('dashboard-accepted')).toHaveText(formatted[1]);
    await expect(page.getByTestId('dashboard-hours')).toHaveText(formatted[2]);
    const applications = page.getByRole('list', { name: text.employeeDashboard.recentApplications, exact: true });
    await expect(applications.getByRole('listitem')).toHaveCount(3);
    for (const status of ['pending', 'rejected', 'cancelled'] as const) {
      await expect(applications.getByText(text.employeeDashboard.statuses[status], { exact: true })).toBeVisible();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('link', { name: text.employeeDashboard.browse + ' ' + text.employeeDashboard.browseDescription })).toHaveAttribute('href', '/' + locale + '/employee/shifts');
  });
}

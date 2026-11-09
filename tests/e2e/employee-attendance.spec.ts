import { expect } from '@playwright/test';
import { employeeTest as test } from './authenticated-test';
import nl from '@/locales/nl.json';
import ar from '@/locales/ar.json';

const id = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
for (const locale of ['nl', 'ar'] as const) {
  const t = (locale === 'nl' ? nl : ar).employeeAttendance;
  const s = (locale === 'nl' ? nl : ar).employeeSchedule;
  test(`${locale} attendance handles loading, retry, pagination, date navigation and lost action responses`, async ({ page }) => {
    let fail = true;
    let checkedIn = false;
    let posts = 0;
    let releaseAction: (() => void) | undefined;
    const queries: URL[] = [];
    await page.route('**/api/employee/schedule?*', async route => {
      const url = new URL(route.request().url());
      queries.push(url);
      if (fail) return route.fulfill({ status: 503, json: {} });
      const index = Number(url.searchParams.get('page'));
      await route.fulfill({ json: {
        assignments: [{ id, status: 'confirmed', shift: {
          id, title: `Attendance ${index}`, location: 'Amsterdam', status: 'filled', timeZone: 'Europe/Amsterdam',
          startAt: '2027-01-01T22:00:00.000Z', endAt: '2027-01-02T02:00:00.000Z',
        }, attendance: checkedIn ? { id, attendanceStatus: 'checked_in', checkInAt: '2027-01-01T22:05:00.000Z', checkOutAt: null } : null }],
        pagination: { page: index, limit: 20, total: 21, totalPages: 2 },
      } });
    });
    await page.goto(`/${locale}/attendance/check-in?date=2027-01-02`);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(s.unavailable);
    fail = false;
    await page.getByRole('button', { name: s.retry, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Attendance 1' })).toBeVisible();
    expect(queries.at(-1)?.searchParams.get('dateFrom')).toBe('2027-01-02');
    expect(queries.at(-1)?.searchParams.get('dateTo')).toBe('2027-01-02');
    await page.getByRole('button', { name: s.next, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Attendance 2' })).toBeVisible();
    await page.getByLabel(t.date).fill('2027-01-03');
    await expect(page.getByRole('heading', { name: 'Attendance 1' })).toBeVisible();
    expect(queries.at(-1)?.searchParams.get('dateFrom')).toBe('2027-01-03');
    await page.route('**/api/employee/attendance/check-in', async route => {
      posts++;
      expect(route.request().postDataJSON()).toEqual({ shiftAssignmentId: id });
      expect(route.request().headers()['x-csrf-token']).toBeTruthy();
      await new Promise<void>(resolve => { releaseAction = resolve; });
      checkedIn = true;
      await route.abort('failed');
    });
    await page.getByRole('button', { name: t.checkIn, exact: true }).click();
    await expect(page.getByRole('button', { name: t.checkIn, exact: true })).toBeDisabled();
    await expect(page.getByLabel(t.date)).toBeDisabled();
    await expect.poll(() => Boolean(releaseAction)).toBe(true);
    releaseAction!();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(t.actionError);
    await expect(page.getByRole('button', { name: t.checkIn, exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: t.checkOut, exact: true })).toBeEnabled();
    expect(posts).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

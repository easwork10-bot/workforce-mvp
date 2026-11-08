import { expect, type Page } from '@playwright/test';
import { employeeTest as test } from './authenticated-test';
import { dutchLocalDateTimeToIso } from '@/frontend/features/admin-shifts/dutchDateTime';
import { moveScheduleAnchor, scheduleRange } from '@/frontend/features/employee-schedule/scheduleCalendar';
import { dateKeyInTimeZone, DEFAULT_WORKSITE_TIME_ZONE } from '@/shared/worksite-time';
import type { EmployeeScheduleItem } from '@/shared/employee-schedule';
import nl from '@/locales/nl.json';
import ar from '@/locales/ar.json';

test.use({ timezoneId: 'Pacific/Honolulu' });

const today = dateKeyInTimeZone(new Date(), DEFAULT_WORKSITE_TIME_ZONE);
const week = scheduleRange(today, 'week');
const mondayStart = dutchLocalDateTimeToIso(week.days[0], '23:30');
const tuesdayEnd = dutchLocalDateTimeToIso(week.days[1], '01:30');
const todayStart = dutchLocalDateTimeToIso(today, '09:00');
const todayEnd = dutchLocalDateTimeToIso(today, '10:00');

function assignment(index: number, startAt = mondayStart, endAt = tuesdayEnd): EmployeeScheduleItem {
  const id = `c2df4e6f-72a7-4e7a-9de1-${String(index + 1).padStart(12, '0')}`;
  const statuses = ['assigned', 'confirmed', 'cancelled', 'completed'] as const;
  return {
    id,
    status: statuses[index % statuses.length],
    shift: {
      id, title: `Schedule fixture ${index}`, location: 'Amsterdam',
      startAt, endAt, timeZone: 'Europe/Amsterdam', status: 'filled',
    },
    attendance: index === 0 ? {
      id, checkInAt: startAt, checkOutAt: endAt, attendanceStatus: 'checked_out',
    } : null,
  };
}

async function setup(page: Page, records: EmployeeScheduleItem[]) {
  const queries: URL[] = [];
  await page.route('**/api/employee/schedule?*', route => {
    const url = new URL(route.request().url());
    queries.push(url);
    const from = url.searchParams.get('dateFrom');
    const to = url.searchParams.get('dateTo');
    if (!from || !to) throw new Error('The schedule must request both calendar boundaries.');
    const filtered = records.filter(item => {
      const first = dateKeyInTimeZone(new Date(item.shift.startAt), item.shift.timeZone);
      const last = dateKeyInTimeZone(new Date(Date.parse(item.shift.endAt) - 1), item.shift.timeZone);
      return first <= to && last >= from;
    });
    const currentPage = Number(url.searchParams.get('page'));
    return route.fulfill({ json: {
      assignments: filtered.slice((currentPage - 1) * 20, currentPage * 20),
      pagination: { page: currentPage, limit: 20, total: filtered.length, totalPages: Math.ceil(filtered.length / 20) },
    } });
  });
  return queries;
}

for (const locale of ['nl', 'ar'] as const) {
  const text = (locale === 'ar' ? ar : nl).employeeSchedule;
  const path = `/${locale}/employee/schedule`;

  test(`${locale} renders worksite dates, statuses, attendance, and week/month navigation responsively`, async ({ page }) => {
    const overnight = assignment(0);
    const current = assignment(1, todayStart, todayEnd);
    const queries = await setup(page, [overnight, current]);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(text.title);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByRole('heading', { name: overnight.shift.title, exact: true })).toHaveCount(2);
    const row = page.getByRole('main').getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: overnight.shift.title, exact: true }) }).first();
    await expect(row.getByText(`${text.assignmentStatus}: ${text.assignmentStatuses.assigned}`, { exact: true })).toBeVisible();
    await expect(row.getByText(`${text.shiftStatus}: ${text.shiftStatuses.filled}`, { exact: true })).toBeVisible();
    await expect(row.getByText(`${text.attendance}: ${text.attendanceStatuses.checked_out}`, { exact: true })).toBeVisible();
    await expect(row.getByText('Amsterdam', { exact: true })).toBeVisible();
    const formatted = await page.evaluate(({ values, language }) => {
      const formatter = new Intl.DateTimeFormat(language, {
        timeZone: 'Europe/Amsterdam', calendar: 'gregory', dateStyle: 'medium', timeStyle: 'short',
      });
      return values.map(value => formatter.format(new Date(value)));
    }, { values: [mondayStart, tuesdayEnd], language: locale === 'ar' ? 'ar' : 'nl-NL' });
    await expect(row.locator(`time[datetime="${mondayStart}"]`).first()).toHaveText(formatted[0]);
    await expect(row.locator(`time[datetime="${tuesdayEnd}"]`).first()).toHaveText(formatted[1]);
    expect(queries[0].searchParams.get('dateFrom')).toBe(week.from);
    expect(queries[0].searchParams.get('dateTo')).toBe(week.to);

    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }

    await page.getByRole('button', { name: text.nextWeek }).click();
    await expect(page.getByRole('status').filter({ hasText: text.empty })).toBeVisible();
    await page.getByRole('button', { name: text.previousWeek }).click();
    await expect(page.getByRole('heading', { name: overnight.shift.title, exact: true })).toHaveCount(2);
    await page.getByRole('button', { name: text.month, exact: true }).click();
    await expect(page.getByRole('button', { name: text.month, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: current.shift.title, exact: true })).toBeVisible();
    const month = scheduleRange(today, 'month');
    expect(queries.at(-1)?.searchParams.get('dateFrom')).toBe(month.from);
    expect(queries.at(-1)?.searchParams.get('dateTo')).toBe(month.to);
    await page.getByRole('button', { name: text.nextMonth }).click();
    await expect(page.getByRole('status').filter({ hasText: text.empty })).toBeVisible();
    await page.getByRole('button', { name: text.previousMonth }).click();
    await expect(page.getByRole('heading', { name: current.shift.title, exact: true })).toBeVisible();
  });

  test(`${locale} keeps all assignments accessible through server-side pagination`, async ({ page }) => {
    const start = dutchLocalDateTimeToIso(week.days[0], '09:00');
    const end = dutchLocalDateTimeToIso(week.days[0], '10:00');
    const queries = await setup(page, Array.from({ length: 24 }, (_, index) => assignment(index, start, end)));
    await page.goto(path);
    const items = page.getByRole('main').getByRole('listitem');
    await expect(items).toHaveCount(20);
    await expect(page.getByRole('navigation', { name: text.pagination })).toBeVisible();
    await expect(page.getByRole('button', { name: text.previous, exact: true })).toBeDisabled();
    await page.getByRole('button', { name: text.next, exact: true }).click();
    await expect(items).toHaveCount(4);
    await expect(page.getByRole('button', { name: text.next, exact: true })).toBeDisabled();
    expect(queries.at(-1)?.searchParams.get('page')).toBe('2');
    await page.getByRole('button', { name: text.previous, exact: true }).click();
    await expect(items).toHaveCount(20);
    expect(queries.at(-1)?.searchParams.get('page')).toBe('1');
  });

  test(`${locale} dashboard uses all schedule pages instead of example shifts or a fabricated count`, async ({ page }) => {
    const sundayStart = dutchLocalDateTimeToIso(week.days[6], '23:00');
    const nextMonday = moveScheduleAnchor(week.days[0], 'week', 1);
    const sundayEnd = dutchLocalDateTimeToIso(nextMonday, '00:00');
    const records: EmployeeScheduleItem[] = [
      ...Array.from({ length: 21 }, (_, index) => ({
        ...assignment(index, sundayStart, sundayEnd), status: 'cancelled' as const,
      })),
      { ...assignment(21, sundayStart, sundayEnd), status: 'assigned' },
      { ...assignment(22, sundayStart, sundayEnd), status: 'confirmed' },
    ];
    const queries = await setup(page, records);
    await page.goto(`/${locale}/employee`);
    const list = page.getByRole('list', { name: text.upcomingTitle });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByText('Schedule fixture 21', { exact: true })).toBeVisible();
    await expect(list.getByText('Schedule fixture 22', { exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: text.upcomingCount.replace('{count}', '2') })).toHaveText('2');
    expect(queries.some(query => query.searchParams.get('page') === '2')).toBe(true);
    expect(queries[0].searchParams.get('dateFrom')).toBe(today);
    expect(queries[0].searchParams.get('dateTo')).toBe(week.to);
    const link = page.getByRole('link', { name: text.viewAll, exact: true });
    await expect(link).toHaveAttribute('href', path);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  });

  test(`${locale} dashboard reports schedule errors rather than an invented zero`, async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/employee/schedule?*', route => {
      attempts += 1;
      return attempts === 1
        ? route.fulfill({ status: 503, json: { error: 'unavailable' } })
        : route.fulfill({ json: {
          assignments: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        } });
    });
    await page.goto(`/${locale}/employee`);
    await expect(page.getByRole('alert').filter({ hasText: text.unavailable })).toHaveText(text.unavailable);
    await page.getByRole('button', { name: text.retry }).click();
    await expect(page.getByText(text.emptyUpcoming, { exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: text.upcomingCount.replace('{count}', '0') })).toHaveText('0');
  });

  test(`${locale} shows loading and localized errors, then retries successfully`, async ({ page }) => {
    let release!: () => void;
    const firstResponse = new Promise<void>(resolve => { release = resolve; });
    let attempt = 0;
    await page.route('**/api/employee/schedule?*', async route => {
      attempt += 1;
      if (attempt === 1) await firstResponse;
      if (attempt <= 4) {
        const status = [401, 403, 503, 500][attempt - 1];
        await route.fulfill({ status, json: { error: 'Do not display this server detail' } });
      } else if (attempt === 5) {
        await route.fulfill({ json: { assignments: 'invalid' } });
      } else if (attempt === 6) {
        await route.abort('failed');
      } else {
        await route.fulfill({ json: {
          assignments: [assignment(0)],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        } });
      }
    });
    await page.goto(path);
    await expect(page.getByRole('status').filter({ hasText: text.loading })).toBeVisible();
    release();
    for (const message of [text.unauthorized, text.forbidden, text.unavailable, text.loadError, text.loadError, text.loadError]) {
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(message);
      await page.getByRole('button', { name: text.retry }).click();
    }
    await expect(page.getByRole('heading', { name: 'Schedule fixture 0', exact: true })).toHaveCount(2);
    expect(attempt).toBe(7);
  });

  test(`${locale} ignores a delayed response after changing weeks`, async ({ page }) => {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    let delivered!: () => void;
    const firstDelivered = new Promise<void>(resolve => { delivered = resolve; });
    let calls = 0;
    await page.route('**/api/employee/schedule?*', async route => {
      calls += 1;
      if (calls === 1) {
        await delayed;
        await route.fulfill({ json: {
          assignments: [assignment(0)],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        } });
        delivered();
      } else {
        await route.fulfill({ json: {
          assignments: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        } });
      }
    });
    await page.goto(path);
    await expect(page.getByRole('status').filter({ hasText: text.loading })).toBeVisible();
    await page.getByRole('button', { name: text.nextWeek }).click();
    await expect(page.getByRole('status').filter({ hasText: text.empty })).toBeVisible();
    release();
    await firstDelivered;
    await expect(page.getByRole('heading', { name: 'Schedule fixture 0', exact: true })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: text.empty })).toBeVisible();
  });
}

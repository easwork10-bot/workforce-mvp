import { expect, test, type Page } from '@playwright/test';
import { assignmentStatuses, type AdminAssignment } from '@/shared/admin-assignments';
import nl from '@/locales/nl.json';
import ar from '@/locales/ar.json';

const id = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
function assignment(index: number): AdminAssignment {
  return {
    id: `c2df4e6f-72a7-4e7a-9de1-${String(index + 1).padStart(12, '0')}`,
    shiftId: id, employeeId: id, assignedBy: id, applicationId: null, confirmedAt: null,
    assignedAt: '2026-11-01T10:00:00.000Z', status: assignmentStatuses[index % 4],
    employee: { id, fullName: 'API Employee' },
    shift: {
      id, title: 'Assignment overview fixture', location: 'Amsterdam',
      startAt: '2026-11-02T22:00:00.000Z', endAt: '2026-11-03T06:00:00.000Z',
    },
  };
}

async function setup(page: Page, records: AdminAssignment[]) {
  const queries: URL[] = [];
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    user: { id, fullName: 'Test Admin', email: 'admin@workforce.test', role: 'administrator', preferredLanguage: 'nl' },
  } }));
  await page.route('**/api/admin/assignments?*', route => {
    expect(route.request().method()).toBe('GET');
    const url = new URL(route.request().url());
    queries.push(url);
    const filtered = records.filter(item => !url.searchParams.get('status') || item.status === url.searchParams.get('status'));
    const currentPage = Number(url.searchParams.get('page'));
    return route.fulfill({ json: {
      assignments: filtered.slice((currentPage - 1) * 20, currentPage * 20),
      pagination: { page: currentPage, limit: 20, total: filtered.length, totalPages: Math.ceil(filtered.length / 20) },
    } });
  });
  return queries;
}

for (const locale of ['nl', 'ar'] as const) {
  const messages = locale === 'ar' ? ar : nl;
  const text = messages.adminAssignmentManagement;
  const path = locale === 'ar' ? '/ar/admin/assignments' : '/nl/admin/assignments';

  test(`${locale} dashboard links to the real assignments overview`, async ({ page }) => {
    await setup(page, [assignment(0)]);
    await page.route('**/api/admin/shifts?*', route => route.fulfill({ json: {
      shifts: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 0 },
      stats: { total: 0, draft: 0, open: 0, filled: 0, cancelled: 0, completed: 0 },
    } }));
    await page.goto(locale === 'ar' ? '/ar/admin' : '/admin');
    const link = page.getByRole('link', { name: messages.admin.assignments, exact: true });
    await expect(link).toHaveAttribute('href', path);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('list', { name: text.list, exact: true }).getByRole('listitem')).toHaveCount(1);
  });

  for (const width of [390, 768, 1280]) {
    test(`${locale} assignments data, history, filtering, pagination and navigation at ${width}px`, async ({ page }, testInfo) => {
      const queries = await setup(page, Array.from({ length: 24 }, (_, index) => assignment(index)));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(text.title);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      const list = page.getByRole('list', { name: text.list, exact: true });
      await expect(list.getByRole('listitem')).toHaveCount(20);
      await expect(list.getByText('API Employee', { exact: true }).first()).toBeVisible();
      await expect(list.getByText('Amsterdam', { exact: true }).first()).toBeVisible();
      const timestamps = [assignment(0).shift.startAt, assignment(0).shift.endAt, assignment(0).assignedAt];
      const formattedDates = await page.evaluate(({ values, language }) => {
        const formatter = new Intl.DateTimeFormat(language, {
          timeZone: 'Europe/Amsterdam', dateStyle: 'medium', timeStyle: 'short',
        });
        return values.map(value => formatter.format(new Date(value)));
      }, { values: timestamps, language: locale === 'ar' ? 'ar' : 'nl-NL' });
      for (const [index, timestamp] of timestamps.entries()) {
        await expect(list.locator(`time[datetime="${timestamp}"]`).first()).toHaveText(formattedDates[index]);
      }
      await expect(page.getByRole('button', { name: text.previous, exact: true })).toBeDisabled();
      await page.getByRole('button', { name: text.next, exact: true }).click();
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await expect(page.getByRole('button', { name: text.next, exact: true })).toBeDisabled();
      await expect.poll(() => queries.at(-1)?.searchParams.get('page')).toBe('2');
      for (const status of assignmentStatuses) {
        await page.getByLabel(text.filter).selectOption(status);
        await expect.poll(() => queries.at(-1)?.searchParams.get('status')).toBe(status);
        await expect.poll(() => queries.at(-1)?.searchParams.get('page')).toBe('1');
        await expect(list.getByRole('listitem')).toHaveCount(6);
        await expect(list.getByRole('listitem').first().getByText(text.status[status], { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: text.previous, exact: true })).toBeDisabled();
      }
      await page.getByLabel(text.filter).selectOption('');
      await expect(list.getByRole('listitem')).toHaveCount(20);
      await expect.poll(() => queries.at(-1)?.searchParams.has('status')).toBe(false);
      await page.getByRole('button', { name: text.next, exact: true }).click();
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await page.getByRole('button', { name: text.previous, exact: true }).click();
      await expect(list.getByRole('listitem')).toHaveCount(20);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('assignments.png'), fullPage: false });
      if (width < 1024) await page.getByRole('button', { name: messages.common.menu, exact: true }).click();
      await expect(page.getByRole('link', { name: messages.navigation.admin.assignments, exact: true })).toHaveAttribute('aria-current', 'page');
      if (width < 1024) {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
        await expect(page.getByRole('button', { name: messages.common.menu, exact: true })).toBeFocused();
      }
      const filter = page.getByLabel(text.filter);
      await filter.focus();
      await expect(filter).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: text.refresh, exact: true })).toBeFocused();
    });
  }

  test(`${locale} shows loading and ignores a stale filter response`, async ({ page }) => {
    await setup(page, []);
    let release: (() => void) | undefined;
    let delivered: (() => void) | undefined;
    const staleDelivered = new Promise<void>(resolve => { delivered = resolve; });
    await page.route('**/api/admin/assignments?*', async route => {
      const status = new URL(route.request().url()).searchParams.get('status');
      if (!status) await new Promise<void>(resolve => { release = resolve; });
      const record = { ...assignment(0), status: status === 'cancelled' ? 'cancelled' as const : 'assigned' as const };
      await route.fulfill({ json: {
        assignments: [record], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      } });
      if (!status) delivered?.();
    });
    await page.goto(path);
    await expect(page.getByRole('status', { name: '' }).filter({ hasText: text.loading })).toBeVisible();
    await expect(page.getByRole('button', { name: text.refresh, exact: true })).toBeDisabled();
    await page.getByLabel(text.filter).selectOption('cancelled');
    const list = page.getByRole('list', { name: text.list, exact: true });
    await expect(list.getByText(text.status.cancelled, { exact: true })).toBeVisible();
    release?.();
    await staleDelivered;
    await expect(page.getByLabel(text.filter)).toHaveValue('cancelled');
    await expect(list.getByText(text.status.cancelled, { exact: true })).toBeVisible();
  });

  test(`${locale} handles empty pages and returns to the last page after records disappear`, async ({ page }) => {
    const records = Array.from({ length: 21 }, (_, index) => assignment(index));
    const queries = await setup(page, records);
    await page.goto(path);
    const list = page.getByRole('list', { name: text.list, exact: true });
    await expect(list.getByRole('listitem')).toHaveCount(20);
    await page.getByRole('button', { name: text.next, exact: true }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    records.splice(1);
    await page.getByRole('button', { name: text.refresh, exact: true }).click();
    await expect.poll(() => queries.at(-1)?.searchParams.get('page')).toBe('1');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    records.splice(0);
    await page.getByRole('button', { name: text.refresh, exact: true }).click();
    await expect(page.getByText(text.empty, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: text.previous, exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: text.next, exact: true })).toBeDisabled();
  });

  test(`${locale} HTTP, network and malformed-data errors support retry without stale rows`, async ({ page }) => {
    await setup(page, [assignment(0)]);
    await page.goto(path);
    const list = page.getByRole('list', { name: text.list, exact: true });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    for (const [status, message] of [[401, text.unauthorized], [403, text.forbidden], [503, text.unavailable], [500, text.loadError]] as const) {
      await page.route('**/api/admin/assignments?*', route => route.fulfill({ status, body: 'Untranslated error' }));
      await page.getByRole('button', { name: text.refresh, exact: true }).click();
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(message);
      await expect(list).toHaveCount(0);
      await page.unroute('**/api/admin/assignments?*');
      await setup(page, [assignment(0)]);
      await page.getByRole('button', { name: text.retry, exact: true }).click();
      await expect(list.getByRole('listitem')).toHaveCount(1);
    }
    for (const failure of ['network', 'malformed']) {
      await page.route('**/api/admin/assignments?*', route => failure === 'network'
        ? route.abort('failed') : route.fulfill({ json: { assignments: [], pagination: {} } }));
      await page.getByRole('button', { name: text.refresh, exact: true }).click();
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(text.loadError);
      await page.unroute('**/api/admin/assignments?*');
      await setup(page, [assignment(0)]);
      await page.getByRole('button', { name: text.retry, exact: true }).click();
      await expect(list.getByRole('listitem')).toHaveCount(1);
    }
  });

  for (const width of [390, 768, 1280]) {
    test(`${locale} cancellation confirmation, single flight, history and focus at ${width}px`, async ({ page }, testInfo) => {
      const records = Array.from({ length: 4 }, (_, index) => assignment(index));
      const queries = await setup(page, records);
      let csrfRequests = 0;
      let posts = 0;
      let release: (() => void) | undefined;
      const gate = new Promise<void>(resolve => { release = resolve; });
      await page.route('**/api/auth/csrf', route => {
        csrfRequests++;
        return route.fulfill({ json: { csrfToken: 'cancellation-csrf-token' } });
      });
      await page.route('**/api/admin/assignments/*/cancel', async route => {
        posts++;
        expect(route.request().method()).toBe('POST');
        expect(route.request().headers()['x-csrf-token']).toBe('cancellation-csrf-token');
        expect(new URL(route.request().url()).pathname).toBe(`/api/admin/assignments/${records[0].id}/cancel`);
        await gate;
        records[0].status = 'cancelled';
        await route.fulfill({ json: { success: true, code: 'ASSIGNMENT_CANCELLED', replayed: false } });
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const list = page.getByRole('list', { name: text.list, exact: true });
      const cancel = list.getByRole('button', { name: text.cancel, exact: true }).first();
      await expect(list.getByRole('button', { name: text.cancel, exact: true })).toHaveCount(2);
      for (const dismiss of ['button', 'escape']) {
        await cancel.click();
        const dialog = page.getByRole('dialog', { name: text.cancelTitle });
        await expect(dialog).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
        await expect(dialog).toContainText('API Employee');
        await expect(dialog).toContainText(records[0].shift.title);
        await expect(dialog).toContainText(text.cancelRules);
        await expect(dialog.getByRole('button', { name: text.keep, exact: true })).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(dialog.getByRole('button', { name: text.confirmCancel, exact: true })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(dialog.getByRole('button', { name: text.keep, exact: true })).toBeFocused();
        if (dismiss === 'button') await dialog.getByRole('button', { name: text.keep, exact: true }).click();
        else await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(cancel).toBeFocused();
        expect(posts).toBe(0);
        expect(csrfRequests).toBe(0);
      }
      await cancel.click();
      const dialog = page.getByRole('dialog', { name: text.cancelTitle });
      await page.screenshot({ path: testInfo.outputPath('cancellation-confirmation.png') });
      const before = queries.length;
      let refreshRequested = false;
      let releaseRefresh: (() => void) | undefined;
      const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
      await page.route('**/api/admin/assignments?*', async route => {
        refreshRequested = true;
        await refreshGate;
        await route.fallback();
      });
      try {
        await dialog.getByRole('button', { name: text.confirmCancel, exact: true }).evaluate(button => {
          (button as HTMLButtonElement).click();
          (button as HTMLButtonElement).click();
        });
        await expect.poll(() => posts).toBe(1);
        await expect(page.getByLabel(text.filter)).toBeDisabled();
        for (const name of [text.refresh, text.previous, text.next]) {
          await expect(page.getByRole('button', { name, exact: true, includeHidden: true })).toBeDisabled();
        }
        await expect(dialog.getByRole('button', { name: text.keep, exact: true })).toBeDisabled();
        await expect(dialog.getByRole('button', { name: text.cancelling, exact: true })).toBeDisabled();
        await page.keyboard.press('Escape');
        await page.mouse.click(1, 1);
        await expect(dialog).toBeVisible();
        expect(queries).toHaveLength(before);
        release?.();
        await expect.poll(() => refreshRequested).toBe(true);
        await expect(dialog).toBeHidden();
        await expect(page.getByLabel(text.filter)).toBeDisabled();
        await expect(page.getByRole('button', { name: text.refresh, exact: true })).toBeDisabled();
        await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      } finally {
        release?.();
        releaseRefresh?.();
      }
      await expect(dialog).toBeHidden();
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await expect(list.getByRole('listitem').first().getByText(text.status.cancelled, { exact: true })).toBeVisible();
      await expect(list.getByRole('button', { name: text.cancel, exact: true })).toHaveCount(1);
      await expect(page.getByRole('main').getByRole('status').filter({ hasText: text.cancelled })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      await expect(page.getByLabel(text.filter)).toBeEnabled();
      expect(posts).toBe(1);
      expect(csrfRequests).toBe(1);
      expect(queries.length).toBeGreaterThan(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }

  test(`${locale} cancellation refreshes after all conflicts, auth failures and uncertain responses`, async ({ page }) => {
    const records = [assignment(0)];
    const queries = await setup(page, records);
    await page.route('**/api/auth/csrf', route => route.fulfill({ json: { csrfToken: 'token' } }));
    await page.goto(path);
    const main = page.getByRole('main');
    const outcomes = [
      [404, 'ASSIGNMENT_NOT_FOUND', text.errors.ASSIGNMENT_NOT_FOUND],
      [409, 'ASSIGNMENT_STATE_CONFLICT', text.errors.ASSIGNMENT_STATE_CONFLICT],
      [409, 'SHIFT_STARTED', text.errors.SHIFT_STARTED],
      [409, 'ATTENDANCE_EXISTS', text.errors.ATTENDANCE_EXISTS],
      [400, 'INVALID_REQUEST', text.errors.INVALID_REQUEST],
      [500, 'INTERNAL_ERROR', text.errors.INTERNAL_ERROR],
      [401, undefined, text.unauthorized], [403, undefined, text.forbidden], [503, undefined, text.unavailable],
      [200, 'malformed', text.cancelError], [0, 'network', text.cancelError],
    ] as const;
    for (const [status, code, message] of outcomes) {
      await page.route('**/api/admin/assignments/*/cancel', route => status === 0
        ? route.abort('failed')
        : route.fulfill({ status, json: status === 200 ? { success: true } : { code, error: 'Do not display this raw error' } }));
      const before = queries.length;
      await main.getByRole('button', { name: text.cancel, exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: text.confirmCancel, exact: true }).click();
      await expect(main.getByRole('alert')).toHaveText(message);
      await expect(main.getByRole('button', { name: text.cancel, exact: true })).toBeEnabled();
      expect(queries.length).toBeGreaterThan(before);
      await expect(main.getByText('Do not display this raw error')).toHaveCount(0);
    }
    // A lost response can follow a committed mutation; do not report success.
    await page.route('**/api/admin/assignments/*/cancel', route => {
      records[0].status = 'cancelled';
      return route.abort('failed');
    });
    await main.getByRole('button', { name: text.cancel, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: text.confirmCancel, exact: true }).click();
    await expect(main.getByRole('alert')).toHaveText(text.cancelError);
    await expect(main.getByRole('listitem').getByText(text.status.cancelled, { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: text.cancel, exact: true })).toHaveCount(0);
  });

  test(`${locale} CSRF failure refreshes without posting and replay survives refresh failure`, async ({ page }) => {
    const records = [assignment(1)];
    const queries = await setup(page, records);
    let posts = 0;
    await page.route('**/api/auth/csrf', route => route.fulfill({ status: 403, body: 'CSRF unavailable' }));
    await page.route('**/api/admin/assignments/*/cancel', route => {
      posts++;
      records[0].status = 'cancelled';
      return route.fulfill({ json: { success: true, code: 'ASSIGNMENT_CANCELLED', replayed: true } });
    });
    await page.goto(path);
    const main = page.getByRole('main');
    const before = queries.length;
    await main.getByRole('button', { name: text.cancel, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: text.confirmCancel, exact: true }).click();
    await expect(main.getByRole('alert')).toHaveText(text.forbidden);
    await expect(main.getByRole('button', { name: text.cancel, exact: true })).toBeEnabled();
    expect(posts).toBe(0);
    expect(queries.length).toBeGreaterThan(before);
    await page.route('**/api/auth/csrf', route => route.fulfill({ json: { csrfToken: 'token' } }));
    await page.route('**/api/admin/assignments?*', route => route.fulfill({ status: 500, body: 'Refresh failed' }));
    await main.getByRole('button', { name: text.cancel, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: text.confirmCancel, exact: true }).click();
    await expect(main.getByRole('status').filter({ hasText: text.cancelReplayed })).toBeVisible();
    await expect(main.getByRole('alert')).toHaveText(text.loadError);
    await expect(main.getByRole('button', { name: text.retry, exact: true })).toBeEnabled();
    await expect(main.getByRole('list')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    expect(posts).toBe(1);
    await page.unroute('**/api/admin/assignments?*');
    await setup(page, records);
    await main.getByRole('button', { name: text.retry, exact: true }).click();
    await expect(main.getByRole('listitem').getByText(text.status.cancelled, { exact: true })).toBeVisible();
  });

  test(`${locale} cancellation under assigned filter recovers invalidated pagination`, async ({ page }) => {
    const records = Array.from({ length: 21 }, (_, index) => ({ ...assignment(index), status: 'assigned' as const }));
    const queries = await setup(page, records);
    await page.route('**/api/auth/csrf', route => route.fulfill({ json: { csrfToken: 'token' } }));
    await page.route('**/api/admin/assignments/*/cancel', route => {
      records.splice(20, 1);
      return route.fulfill({ json: { success: true, code: 'ASSIGNMENT_CANCELLED', replayed: false } });
    });
    await page.goto(path);
    await page.getByLabel(text.filter).selectOption('assigned');
    await expect(page.getByRole('listitem')).toHaveCount(20);
    await page.getByRole('button', { name: text.next, exact: true }).click();
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await page.getByRole('button', { name: text.cancel, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: text.confirmCancel, exact: true }).click();
    await expect(page.getByRole('listitem')).toHaveCount(20);
    await expect(page.getByLabel(text.filter)).toHaveValue('assigned');
    await expect(page.getByLabel(text.filter)).toBeEnabled();
    expect(queries.at(-1)?.searchParams.get('page')).toBe('1');
    await expect(page.getByRole('button', { name: text.next, exact: true })).toBeDisabled();
  });
}

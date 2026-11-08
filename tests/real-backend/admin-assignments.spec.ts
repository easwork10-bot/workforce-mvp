import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import argon2 from 'argon2';
import { Client } from 'pg';
import { createClient } from 'redis';
import { decodeJwt, importPKCS8, SignJWT } from 'jose';
import { verifyTestDatabaseTarget } from '../support/database/testDatabaseSafety';
import { adminAssignmentPageSchema, assignmentStatuses } from '../../src/shared/admin-assignments';
import nl from '../../src/locales/nl.json';
import ar from '../../src/locales/ar.json';

type ApprovedAssignment = {
  id: string; shift_id: string; employee_id: string; application_id: string; assigned_by: string;
  status: string; assigned_at: Date; full_name: string; title: string; location: string;
  start_at: Date; end_at: Date;
};

test.describe.serial('real authenticated assignment lifecycle', () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const redis = createClient({ url: process.env.REDIS_URL });
  const profileIds: string[] = [];
  const shiftIds: string[] = [];
  const sessionKeys: string[] = [];
  const historyIds: string[] = [];
  let context: BrowserContext | undefined;
  let page: Page;
  let employeeContext: BrowserContext | undefined;
  let anonymousContext: BrowserContext | undefined;
  let admin: Awaited<ReturnType<typeof identity>>;
  let employee: Awaited<ReturnType<typeof identity>>;
  let adminLogin: Awaited<ReturnType<typeof login>>;
  let employeeLogin: Awaited<ReturnType<typeof login>>;
  let approved: ApprovedAssignment;

  const password = `Disposable-${randomUUID()}!`;

  async function identity(role: 'administrator' | 'employee') {
    const id = randomUUID();
    const email = `real-browser-${id}@workforce.test`;
    const fullName = `Real database ${role} ${test.info().project.name}`;
    const hash = await argon2.hash(password, {
      type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 2, hashLength: 32,
    });
    await db.query('INSERT INTO profiles (id, full_name, email, password_hash) VALUES ($1, $2, $3, $4)', [id, fullName, email, hash]);
    profileIds.push(id);
    await db.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, role]);
    return { id, email, fullName, role };
  }

  async function login(target: BrowserContext, user: Awaited<ReturnType<typeof identity>>) {
    // Keep functional setup logins independent of the disposable IP throttle window.
    await redis.del('ratelimit:127.0.0.1:login');
    const response = await target.request.post('/api/auth/login', { data: { email: user.email, password } });
    expect(response.status()).toBe(200);
    expect((await response.json()).user).toMatchObject({ id: user.id, role: user.role, fullName: user.fullName });
    const cookies = await target.cookies();
    const access = cookies.find(cookie => cookie.name === 'access_token');
    const refresh = cookies.find(cookie => cookie.name === 'refresh_token');
    expect(access?.secure).toBe(true);
    expect(access?.httpOnly).toBe(true);
    if (!access || !refresh) throw new Error('Real login did not establish both authentication cookies.');
    const jti = decodeJwt(access.value).jti;
    if (!jti) throw new Error('Real login JWT has no session ID.');
    const refreshHash = createHash('sha256').update(refresh.value).digest('hex');
    sessionKeys.push(`session:${jti}`, `refresh:${user.id}:${refreshHash}`);
    expect(await redis.hGetAll(`session:${jti}`)).toMatchObject({ userId: user.id, role: user.role });
    const csrf = await target.request.get('/api/auth/csrf');
    expect(csrf.status()).toBe(200);
    return { csrf: (await csrf.json()).csrfToken as string, jti };
  }

  async function post(api: APIRequestContext, url: string, csrf: string, data: unknown, status = 200) {
    const response = await api.post(url, { headers: { 'x-csrf-token': csrf }, data });
    expect(response.status(), `${url}: ${await response.text()}`).toBe(status);
    return response.json();
  }

  async function navigate(target: Page, path: string) {
    const pending = target.waitForResponse(response => response.url().includes('/api/admin/assignments?'));
    await target.goto(path);
    const response = await pending;
    const body: unknown = await response.json();
    return { response, body };
  }

  async function change(target: Page, action: () => Promise<unknown>) {
    const pending = target.waitForResponse(response => response.url().includes('/api/admin/assignments?'));
    await action();
    const response = await pending;
    expect(response.status()).toBe(200);
    return adminAssignmentPageSchema.parse(await response.json());
  }

  async function formattedDate(value: Date, locale: 'nl' | 'ar') {
    // WebKit and Node ICU differ in Dutch date/time punctuation.
    return page.evaluate(({ timestamp, language }) => new Intl.DateTimeFormat(language, {
      timeZone: 'Europe/Amsterdam', dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(timestamp)), { timestamp: value.toISOString(), language: locale === 'ar' ? 'ar' : 'nl-NL' });
  }

  test.beforeAll(async ({ browser }) => {
    await verifyTestDatabaseTarget(process.env.DATABASE_URL, process.env.WORKFORCE_TEST_DB_SERVER_ADDRESS,
      undefined, process.env.WORKFORCE_TEST_DB_SERVER_PORT);
    await db.connect();
    await redis.connect();
    const existing = await db.query('SELECT count(*)::int AS total FROM profiles');
    expect(existing.rows[0].total).toBe(0);
    admin = await identity('administrator');
    employee = await identity('employee');
    context = await browser.newContext({ baseURL: 'https://localhost:3197', ignoreHTTPSErrors: true });
    page = await context.newPage();
    adminLogin = await login(context, admin);
    employeeContext = await browser.newContext({ baseURL: 'https://localhost:3197', ignoreHTTPSErrors: true });
    employeeLogin = await login(employeeContext, employee);
  });

  test('real login form opens the localized administrator dashboard', async ({ browser }) => {
    const target = await browser.newContext({ baseURL: 'https://localhost:3197', ignoreHTTPSErrors: true });
    try {
      const loginPage = await target.newPage();
      await loginPage.goto('/ar/admin');
      await expect(loginPage).toHaveURL(/\/ar\/auth\/login$/);
      await loginPage.getByLabel(ar.auth.login.email).fill(admin.email);
      await loginPage.getByLabel(ar.auth.login.password, { exact: true }).fill(password);
      await loginPage.getByRole('button', { name: ar.auth.login.submit, exact: true }).last().click();
      await expect(loginPage).toHaveURL(/\/ar\/admin$/);
      await expect(loginPage.getByRole('heading', { level: 1 })).toBeVisible();
      const cookies = await target.cookies();
      const access = cookies.find(cookie => cookie.name === 'access_token');
      const refresh = cookies.find(cookie => cookie.name === 'refresh_token');
      if (!access || !refresh) throw new Error('Real login did not establish both authentication cookies.');
      const jti = decodeJwt(access.value).jti;
      if (!jti) throw new Error('Real login JWT has no session ID.');
      sessionKeys.push(`session:${jti}`, `refresh:${admin.id}:${createHash('sha256').update(refresh.value).digest('hex')}`);
    } finally {
      await target.close();
    }
  });

  test('deactivated accounts cannot use existing Redis sessions for pages or APIs', async () => {
    for (const [user, target, jti, apiPath, pagePath] of [
      [employee, employeeContext!, employeeLogin.jti, '/api/employee/schedule', '/ar/employee/schedule'],
      [admin, context!, adminLogin.jti, '/api/admin/assignments', '/nl/admin/assignments'],
    ] as const) {
      await db.query("UPDATE profiles SET account_status = 'inactive' WHERE id = $1", [user.id]);
      try {
        expect(await redis.exists(`session:${jti}`)).toBe(1);
        expect((await target.request.get(apiPath)).status()).toBe(401);
        expect((await target.request.get('/api/auth/me')).status()).toBe(401);
        const page = await target.newPage();
        try {
          await page.goto(pagePath);
          await expect(page).toHaveURL(new RegExp(`${pagePath.startsWith('/ar') ? '/ar' : '/nl'}/auth/login$`));
        } finally {
          await page.close();
        }
      } finally {
        await db.query("UPDATE profiles SET account_status = 'active' WHERE id = $1", [user.id]);
      }
    }
  });

  test('deactivating an employee revokes their Redis session', async () => {
    try {
      const response = await context!.request.patch(`/api/admin/employees/${employee.id}`, {
        headers: { 'x-csrf-token': adminLogin.csrf },
        data: { accountStatus: 'inactive' },
      });
      expect(response.status()).toBe(200);
      expect(await redis.exists(`session:${employeeLogin.jti}`)).toBe(0);
    } finally {
      await db.query("UPDATE profiles SET account_status = 'active' WHERE id = $1", [employee.id]);
      employeeLogin = await login(employeeContext!, employee);
    }
  });

  test('reactivating an account revokes any session left by a failed deactivation cleanup', async () => {
    try {
      await db.query("UPDATE profiles SET account_status = 'inactive' WHERE id = $1", [employee.id]);
      expect(await redis.exists(`session:${employeeLogin.jti}`)).toBe(1);
      const response = await context!.request.patch(`/api/admin/employees/${employee.id}`, {
        headers: { 'x-csrf-token': adminLogin.csrf },
        data: { accountStatus: 'active' },
      });
      expect(response.status()).toBe(200);
      expect(await redis.exists(`session:${employeeLogin.jti}`)).toBe(0);
      expect((await employeeContext!.request.get('/api/employee/schedule')).status()).toBe(401);
    } finally {
      await db.query("UPDATE profiles SET account_status = 'active' WHERE id = $1", [employee.id]);
      employeeLogin = await login(employeeContext!, employee);
    }
  });

  for (const locale of ['nl', 'ar'] as const) {
      test(`${locale} protected pages reject anonymous and wrong-role requests`, async ({ browser }) => {
        const anonymous = await browser.newContext({ baseURL: 'https://localhost:3197', ignoreHTTPSErrors: true });
        try {
          for (const path of ['/admin', '/admin/shifts', '/admin/shifts/create', '/admin/applications',
            '/admin/assignments', '/employee', '/employee/shifts', '/employee/applications',
            '/employee/schedule', '/attendance/check-in']) {
            const response = await anonymous.request.get(`/${locale}${path}`, { maxRedirects: 0 });
            expect(response.status(), path).toBe(307);
            expect(response.headers().location).toBe(`/${locale}/auth/login`);
          }
          const external = await anonymous.request.get(`/${locale}/admin?next=https%3A%2F%2Fexample.com`, { maxRedirects: 0 });
          expect(external.status()).toBe(307);
          expect(external.headers().location).toBe(`/${locale}/auth/login`);
          for (const path of ['/admin', '/admin/shifts', '/admin/shifts/create', '/admin/applications', '/admin/assignments']) {
            const response = await employeeContext!.request.get(`/${locale}${path}`, { maxRedirects: 0 });
            expect(response.status(), path).toBe(404);
            expect(await response.text()).not.toContain('Real database administrator');
          }
          for (const path of ['/employee', '/employee/shifts', '/employee/applications', '/employee/schedule', '/attendance/check-in']) {
            const response = await context!.request.get(`/${locale}${path}`, { maxRedirects: 0 });
            expect(response.status(), path).toBe(404);
            expect(await response.text()).not.toContain('Real database employee');
          }
          expect((await context!.request.get(`/${locale}/admin`, { maxRedirects: 0 })).status()).toBe(200);
          expect((await employeeContext!.request.get(`/${locale}/employee`, { maxRedirects: 0 })).status()).toBe(200);
        } finally {
          await anonymous.close();
        }
      });
    }

    test('expired JWT and revoked Redis session cannot render a protected page', async ({ browser }) => {
      const target = await browser.newContext({ baseURL: 'https://localhost:3197', ignoreHTTPSErrors: true });
      try {
        const loginResult = await login(target, employee);
        if (!process.env.JWT_PRIVATE_KEY_B64) throw new Error('Missing isolated test signing key.');
        const key = await importPKCS8(Buffer.from(process.env.JWT_PRIVATE_KEY_B64, 'base64').toString('utf8'), 'RS256');
        const expired = await new SignJWT({ role: 'employee', ipHash: 'test' })
          .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setSubject(employee.id).setJti(loginResult.jti)
          .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(key);
        const original = (await target.cookies()).find(cookie => cookie.name === 'access_token');
        if (!original) throw new Error('Missing access cookie.');
        await target.addCookies([{ name: 'access_token', value: expired, url: 'https://localhost:3197', secure: true, httpOnly: true }]);
        let response = await target.request.get('/ar/employee/schedule', { maxRedirects: 0 });
        expect(response.status()).toBe(307);
        expect(response.headers().location).toBe('/ar/auth/login');
        await target.addCookies([original]);
        await redis.del(`session:${loginResult.jti}`);
        response = await target.request.get('/nl/employee/schedule', { maxRedirects: 0 });
        expect(response.status()).toBe(307);
        expect(response.headers().location).toBe('/nl/auth/login');
        expect((await target.request.get('/api/employee/schedule')).status()).toBe(401);
      } finally {
        await target.close();
      }
    });

    test('create and publish a shift, apply as employee, approve with real CSRF and verify database writes', async () => {
      const created = await post(context!.request, '/api/admin/shifts', adminLogin.csrf, {
        title: 'Real backend traffic control', workType: 'traffic-control', location: 'Amsterdam Noord',
        startAt: '2099-01-15T22:00:00.000Z', endAt: '2099-01-16T06:00:00.000Z', requiredWorkers: 1,
      }, 201);
      shiftIds.push(created.shift.id);
      expect(created.shift.status).toBe('draft');
      await post(context!.request, `/api/admin/shifts/${created.shift.id}/publish`, adminLogin.csrf, {});
      const applied = await post(employeeContext!.request, `/api/employee/shifts/${created.shift.id}/apply`, employeeLogin.csrf, {}, 201);
      const denied = await context!.request.post(`/api/admin/applications/${applied.applicationId}/review`, { data: { status: 'accepted' } });
      expect(denied.status()).toBe(403);
      await post(context!.request, `/api/admin/applications/${applied.applicationId}/review`, adminLogin.csrf, { status: 'accepted' });
      const result = await db.query<ApprovedAssignment>(`
        SELECT a.*, s.title, s.location, s.start_at, s.end_at, s.status AS shift_status,
          p.full_name, ap.status AS application_status
        FROM shift_assignments a JOIN shifts s ON s.id = a.shift_id
        JOIN profiles p ON p.id = a.employee_id
        JOIN shift_applications ap ON ap.id = a.application_id WHERE a.application_id = $1
      `, [applied.applicationId]);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row).toMatchObject({
        status: 'assigned', employee_id: employee.id, assigned_by: admin.id,
        full_name: employee.fullName, shift_status: 'filled', application_status: 'accepted',
      });
      approved = row;
    });

    test('real browser response, rendered details and dates match the approved assignment in PostgreSQL', async () => {
      const { response, body } = await navigate(page, '/nl/admin/assignments');
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('private, no-store');
      const data = adminAssignmentPageSchema.parse(body);
      expect(data.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
      expect(data.assignments).toEqual([{
        id: approved.id, shiftId: approved.shift_id, employeeId: approved.employee_id,
        applicationId: approved.application_id, status: approved.status, assignedBy: approved.assigned_by,
        assignedAt: approved.assigned_at.toISOString(), confirmedAt: null,
        employee: { id: employee.id, fullName: approved.full_name },
        shift: {
          id: approved.shift_id, title: approved.title, location: approved.location,
          startAt: approved.start_at.toISOString(), endAt: approved.end_at.toISOString(),
        },
      }]);
      const row = page.getByRole('list', { name: nl.adminAssignmentManagement.list, exact: true }).getByRole('listitem');
      await expect(row).toHaveCount(1);
      await expect(row.getByRole('heading', { level: 2 })).toHaveText(approved.full_name);
      await expect(row.getByRole('heading', { level: 3 })).toHaveText(approved.title);
      await expect(row.getByText(approved.location, { exact: true })).toBeVisible();
      for (const value of [approved.assigned_at, approved.start_at, approved.end_at]) {
        await expect(row.locator(`time[datetime="${value.toISOString()}"]`)).toHaveText(await formattedDate(value, 'nl'));
      }
    });

    test('seed isolated confirmed and terminal history fixtures, without inventing a completion business flow', async () => {
      const second = await db.query(`
        INSERT INTO shifts (title, work_type, location, start_at, end_at, required_workers, status, created_by)
        VALUES ('History fixture shift', 'traffic-control', 'Rotterdam', '2099-02-01T08:00Z', '2099-02-01T16:00Z', 1, 'filled', $1)
        RETURNING id
      `, [admin.id]);
      shiftIds.push(second.rows[0].id);
      for (let index = 0; index < 23; index++) {
        const status = index === 0 ? 'confirmed' : index % 2 === 0 ? 'completed' : 'cancelled';
        const assignmentId = randomUUID();
        await db.query(`
          INSERT INTO shift_assignments (id, shift_id, employee_id, assigned_by, status, assigned_at, confirmed_at)
          VALUES ($1, $2, $3, $4, $5, '2026-11-01T10:00Z', $6)
        `, [assignmentId, index === 0 ? second.rows[0].id : approved.shift_id, employee.id, admin.id, status,
          status === 'confirmed' || status === 'completed' ? '2026-11-01T11:00Z' : null]);
        historyIds.push(assignmentId);
      }
      const counts = await db.query('SELECT status, count(*)::int AS total FROM shift_assignments GROUP BY status');
      expect(Object.fromEntries(counts.rows.map(row => [row.status, row.total])))
        .toEqual({ assigned: 1, confirmed: 1, cancelled: 11, completed: 11 });
    });

    for (const locale of ['nl', 'ar'] as const) {
      test(`${locale} real server filtering, counts, pagination, history and 390/768/1280px layouts`, async ({}, testInfo) => {
        const text = (locale === 'ar' ? ar : nl).adminAssignmentManagement;
        const { response, body } = await navigate(page, locale === 'ar' ? '/ar/admin/assignments' : '/admin/assignments');
        expect(response.status()).toBe(200);
        expect(adminAssignmentPageSchema.parse(body).pagination).toEqual({ page: 1, limit: 20, total: 24, totalPages: 2 });
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(text.title);
        const list = page.getByRole('list', { name: text.list, exact: true });
        await expect(list.getByRole('listitem')).toHaveCount(20);
        const firstIds = adminAssignmentPageSchema.parse(body).assignments.map(item => item.id);
        const second = await change(page, () => page.getByRole('button', { name: text.next, exact: true }).click());
        expect(second.pagination).toEqual({ page: 2, limit: 20, total: 24, totalPages: 2 });
        await expect(list.getByRole('listitem')).toHaveCount(4);
        expect(new Set([...firstIds, ...second.assignments.map(item => item.id)]).size).toBe(24);
        await expect(page.getByRole('button', { name: text.next, exact: true })).toBeDisabled();
        for (const status of assignmentStatuses) {
          const filtered = await change(page, () => page.getByLabel(text.filter).selectOption(status));
          const count = status === 'cancelled' || status === 'completed' ? 11 : 1;
          expect(filtered.pagination).toEqual({ page: 1, limit: 20, total: count, totalPages: 1 });
          expect(filtered.assignments.every(item => item.status === status)).toBe(true);
          await expect(list.getByRole('listitem')).toHaveCount(count);
          await expect(list.getByRole('listitem').first().getByText(text.status[status], { exact: true })).toBeVisible();
        }
        const all = await change(page, () => page.getByLabel(text.filter).selectOption(''));
        expect(all.pagination.total).toBe(24);
        await expect(list.getByRole('listitem')).toHaveCount(20);
        await expect(list.locator(`time[datetime="${approved.start_at.toISOString()}"]`).first())
          .toHaveText(await formattedDate(approved.start_at, locale));
        for (const width of [390, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          await page.screenshot({ path: testInfo.outputPath(`${locale}-${width}.png`) });
        }
      });
    }

    test('unauthenticated and employee browsers cannot read protected assignment data', async ({ browser }) => {
      anonymousContext = await browser.newContext({ baseURL: 'https://localhost:3197', ignoreHTTPSErrors: true });
      for (const [target, status] of [
        [anonymousContext, 401],
        [employeeContext!, 403],
      ] as const) {
        const direct = await target.request.get('/api/admin/assignments');
        expect(direct.status()).toBe(status);
        expect(await direct.json()).not.toHaveProperty('assignments');
        const otherPage = await target.newPage();
        await otherPage.goto('/nl/admin/assignments');
        if (status === 401) await expect(otherPage).toHaveURL(/\/nl\/auth\/login$/);
        else await expect(otherPage.getByRole('heading', { name: '404' })).toBeVisible();
        await expect(otherPage.getByText(employee.fullName, { exact: true })).toHaveCount(0);
        await otherPage.close();
      }
    });

    test('real UI cancellation fetches CSRF, changes rendered status, retains application and reopens capacity', async () => {
      const text = ar.adminAssignmentManagement;
      await change(page, () => page.getByLabel(text.filter).selectOption('assigned'));
      await page.getByRole('button', { name: text.cancel, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: text.cancelTitle });
      await expect(dialog).toContainText(employee.fullName);
      await expect(dialog).toContainText(approved.title);
      await expect(dialog).toContainText(text.cancelRules);
      await expect(dialog.getByRole('button', { name: text.keep, exact: true })).toBeFocused();
      const csrf = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/csrf');
      const cancelledResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/admin/assignments/${approved.id}/cancel`);
      const empty = await change(page, () => dialog.getByRole('button', { name: text.confirmCancel, exact: true }).click());
      expect((await csrf).status()).toBe(200);
      const response = await cancelledResponse;
      expect(response.status()).toBe(200);
      expect(response.request().headers()['x-csrf-token']).toBeTruthy();
      expect(await response.json()).toEqual({ success: true, code: 'ASSIGNMENT_CANCELLED', replayed: false });
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('main').getByRole('status').filter({ hasText: text.cancelled })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      const state = await db.query(`
        SELECT a.status, ap.status AS application_status, s.status AS shift_status
        FROM shift_assignments a JOIN shift_applications ap ON ap.id = a.application_id
        JOIN shifts s ON s.id = a.shift_id WHERE a.id = $1
      `, [approved.id]);
      expect(state.rows[0]).toEqual({ status: 'cancelled', application_status: 'accepted', shift_status: 'open' });
      expect(empty.pagination.total).toBe(0);
      await expect(page.getByText(text.empty, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: text.previous, exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: text.next, exact: true })).toBeDisabled();
      const notice = await db.query('SELECT count(*)::int AS total FROM notifications WHERE idempotency_key = $1',
        [`assignment-cancellation:v1:${approved.id}`]);
      expect(notice.rows[0].total).toBe(1);
      const all = await change(page, () => page.getByLabel(text.filter).selectOption(''));
      expect(all.assignments.find(item => item.id === approved.id)?.status).toBe('cancelled');
      const cancelled = await change(page, () => page.getByLabel(text.filter).selectOption('cancelled'));
      expect(cancelled.assignments.find(item => item.id === approved.id)?.status).toBe('cancelled');
      await expect(page.getByRole('list', { name: text.list, exact: true }).getByRole('listitem')).toHaveCount(12);
    });

    test('record removal invalidates page 2 and refresh returns to page 1, then shows a truly empty database', async () => {
      const text = ar.adminAssignmentManagement;
      await change(page, () => page.getByLabel(text.filter).selectOption(''));
      await change(page, () => page.getByRole('button', { name: text.next, exact: true }).click());
      await db.query('DELETE FROM shift_assignments WHERE id = ANY($1::uuid[])', [historyIds]);
      const returned = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/admin/assignments' && url.searchParams.get('page') === '1';
      });
      await page.getByRole('button', { name: text.refresh, exact: true }).click();
      const data = adminAssignmentPageSchema.parse(await (await returned).json());
      expect(data.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
      await expect(page.getByRole('list', { name: text.list, exact: true }).getByRole('listitem')).toHaveCount(1);
      await db.query('DELETE FROM shift_assignments WHERE id = $1', [approved.id]);
      const empty = await change(page, () => page.getByRole('button', { name: text.refresh, exact: true }).click());
      expect(empty.assignments).toEqual([]);
      expect(empty.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
      await expect(page.getByText(text.empty, { exact: true })).toBeVisible();
    });

    test('employee logout uses real CSRF and removes the Redis session while preserving Arabic', async () => {
      const employeePage = await employeeContext!.newPage();
      await employeePage.goto('/ar/employee');
      const logout = employeePage.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/logout');
      await employeePage.getByRole('button', { name: ar.navigation.logout, exact: true }).first().click();
      const response = await logout;
      expect(response.status()).toBe(200);
      expect(response.request().headers()['x-csrf-token']).toBeTruthy();
      await expect(employeePage).toHaveURL(/\/ar\/auth\/login$/);
      expect(await redis.exists(`session:${employeeLogin.jti}`)).toBe(0);
      expect((await employeeContext!.request.get('/api/auth/me')).status()).toBe(401);
      await employeePage.close();
    });

    test('revoking the real Redis session removes administrator access without a false empty success', async () => {
      await redis.del(`session:${adminLogin.jti}`);
      const pending = page.waitForResponse(response => response.url().includes('/api/admin/assignments?'));
      await page.getByRole('button', { name: ar.adminAssignmentManagement.refresh, exact: true }).click();
      expect((await pending).status()).toBe(401);
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(ar.adminAssignmentManagement.unauthorized);
    });

    test('replacing administrator role revokes sessions and requires employee reauthentication', async ({ browser }) => {
      const roleChangeContext = await browser.newContext({
        baseURL: 'https://localhost:3197',
        ignoreHTTPSErrors: true,
      });
      const reauthenticationContext = await browser.newContext({
        baseURL: 'https://localhost:3197',
        ignoreHTTPSErrors: true,
      });
      try {
        const roleChangeLogin = await login(roleChangeContext, admin);
        const roleChangeResponse = await roleChangeContext.request.patch(
          `/api/admin/employees/${admin.id}`,
          {
            headers: { 'x-csrf-token': roleChangeLogin.csrf },
            data: { role: 'employee' },
          },
        );
        expect(roleChangeResponse.status(), await roleChangeResponse.text()).toBe(200);

        expect(await redis.exists(`session:${roleChangeLogin.jti}`)).toBe(0);
        expect((await roleChangeContext.request.get('/api/admin/assignments')).status()).toBe(401);
        const oldSessionPage = await roleChangeContext.newPage();
        await oldSessionPage.goto('/nl/admin');
        await expect(oldSessionPage).toHaveURL(/\/nl\/auth\/login$/);
        await oldSessionPage.close();

        await login(reauthenticationContext, { ...admin, role: 'employee' });
        expect((await reauthenticationContext.request.get('/api/admin/assignments')).status()).toBe(403);
        const employeePage = await reauthenticationContext.newPage();
        await employeePage.goto('/nl/admin');
        await expect(employeePage.getByRole('heading', { name: '404' })).toBeVisible();
        await employeePage.close();
      } finally {
        await roleChangeContext.close();
        await reauthenticationContext.close();
      }
    });
  test.afterAll(async () => {
    await context?.close();
    await employeeContext?.close();
    await anonymousContext?.close();
    if (profileIds.length) {
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [profileIds]);
      await db.query('DELETE FROM notifications WHERE recipient_id = ANY($1::uuid[])', [profileIds]);
    }
    if (shiftIds.length) await db.query('DELETE FROM shifts WHERE id = ANY($1::uuid[])', [shiftIds]);
    if (profileIds.length) await db.query('DELETE FROM profiles WHERE id = ANY($1::uuid[])', [profileIds]);
    if (sessionKeys.length) {
      await redis.del(sessionKeys);
      expect(await redis.exists(sessionKeys)).toBe(0);
    }
    if (redis.isOpen) await redis.quit();
    await db.end();
  });
});

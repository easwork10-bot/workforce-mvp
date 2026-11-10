import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import argon2 from 'argon2';
import { decodeJwt } from 'jose';
import { Client } from 'pg';
import { createClient } from 'redis';
import { dutchLocalDateTimeToIso } from '../../src/frontend/features/admin-shifts/dutchDateTime';
import { moveScheduleAnchor, scheduleRange } from '../../src/frontend/features/employee-schedule/scheduleCalendar';
import { employeeSchedulePageSchema } from '../../src/shared/employee-schedule';
import { verifyTestDatabaseTarget } from '../support/database/testDatabaseSafety';
import nl from '../../src/locales/nl.json';
import ar from '../../src/locales/ar.json';

test.describe.serial('real authenticated employee schedule', () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const redis = createClient({ url: process.env.REDIS_URL });
  const profileIds: string[] = [];
  const shiftIds: string[] = [];
  const sessionKeys: string[] = [];
  const password = `Disposable-${randomUUID()}!`;
  let dbConnected = false;
  let adminContext: BrowserContext;
  let employeeContext: BrowserContext;
  let otherContext: BrowserContext;
  let page: Page;
  let admin: Awaited<ReturnType<typeof identity>>;
  let employee: Awaited<ReturnType<typeof identity>>;
  let other: Awaited<ReturnType<typeof identity>>;
  let adminLogin: Awaited<ReturnType<typeof login>>;
  let employeeLogin: Awaited<ReturnType<typeof login>>;
  let targetWeek: string;
  let startAt: string;
  let endAt: string;
  let approvedId: string;
  let otherAssignmentId: string;
  let attendanceId: string;

  async function identity(role: 'administrator' | 'employee') {
    const id = randomUUID();
    const email = `schedule-browser-${id}@workforce.test`;
    const hash = await argon2.hash(password, {
      type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 2, hashLength: 32,
    });
    await db.query('INSERT INTO profiles (id, full_name, email, password_hash) VALUES ($1, $2, $3, $4)',
      [id, `Schedule ${role}`, email, hash]);
    profileIds.push(id);
    await db.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, role]);
    return { id, email, role };
  }

  async function login(context: BrowserContext, user: Awaited<ReturnType<typeof identity>>) {
    await redis.del('ratelimit:127.0.0.1:login');
    const response = await context.request.post('/api/auth/login', { data: { email: user.email, password } });
    expect(response.status()).toBe(200);
    expect((await response.json()).user).toMatchObject({ id: user.id, role: user.role });
    const cookies = await context.cookies();
    const access = cookies.find(cookie => cookie.name === 'access_token');
    const refresh = cookies.find(cookie => cookie.name === 'refresh_token');
    if (!access || !refresh) throw new Error('Real login did not establish both authentication cookies.');
    expect(access.secure).toBe(true);
    expect(access.httpOnly).toBe(true);
    const jti = decodeJwt(access.value).jti;
    if (!jti) throw new Error('Real login JWT has no session ID.');
    sessionKeys.push(`session:${jti}`, `refresh:${user.id}:${createHash('sha256').update(refresh.value).digest('hex')}`);
    expect(await redis.hGetAll(`session:${jti}`)).toMatchObject({ userId: user.id, role: user.role });
    const csrf = await context.request.get('/api/auth/csrf');
    expect(csrf.status()).toBe(200);
    return { jti, csrf: (await csrf.json()).csrfToken as string };
  }

  async function post(api: APIRequestContext, url: string, csrf: string, data: unknown, status = 200) {
    const response = await api.post(url, { headers: { 'x-csrf-token': csrf }, data });
    expect(response.status(), `${url}: ${await response.text()}`).toBe(status);
    return response.json();
  }

  async function navigate(path: string) {
    const pending = page.waitForResponse(response => response.url().includes('/api/employee/schedule?'));
    await page.goto(path);
    return pending;
  }

  test.beforeAll(async ({ browser }) => {
    await verifyTestDatabaseTarget(process.env.DATABASE_URL, process.env.WORKFORCE_TEST_DB_SERVER_ADDRESS,
      undefined, process.env.WORKFORCE_TEST_DB_SERVER_PORT);
    await db.connect();
    dbConnected = true;
    await redis.connect();
    admin = await identity('administrator');
    employee = await identity('employee');
    other = await identity('employee');
    adminContext = await browser.newContext({ baseURL: 'https://localhost:3197', ignoreHTTPSErrors: true });
    employeeContext = await browser.newContext({
      baseURL: 'https://localhost:3197', ignoreHTTPSErrors: true, timezoneId: 'Pacific/Honolulu',
    });
    otherContext = await browser.newContext({ baseURL: 'https://localhost:3197', ignoreHTTPSErrors: true });
    adminLogin = await login(adminContext, admin);
    employeeLogin = await login(employeeContext, employee);
    await login(otherContext, other);
    page = await employeeContext.newPage();
  });

  test('starts with an empty authenticated schedule and determines the next worksite week', async () => {
    const response = await navigate('/nl/employee/schedule');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(employeeSchedulePageSchema.parse(await response.json()).assignments).toEqual([]);
    await expect(page.getByRole('status').filter({ hasText: nl.employeeSchedule.empty })).toBeVisible();
    const currentFrom = new URL(response.url()).searchParams.get('dateFrom');
    if (!currentFrom) throw new Error('The schedule did not request its calendar range.');
    targetWeek = moveScheduleAnchor(currentFrom, 'week', 1);
    const days = scheduleRange(targetWeek, 'week').days;
    startAt = dutchLocalDateTimeToIso(days[0], '23:30');
    endAt = dutchLocalDateTimeToIso(days[1], '01:30');
  });

  test('creates, publishes, applies, and approves a real shift, then adds isolated attendance and history fixtures', async () => {
    const created = await post(adminContext.request, '/api/admin/shifts', adminLogin.csrf, {
      title: 'Real employee overnight shift', workType: 'traffic-control', location: 'Amsterdam Noord',
      startAt, endAt, requiredWorkers: 1,
    }, 201);
    shiftIds.push(created.shift.id);
    await post(adminContext.request, `/api/admin/shifts/${created.shift.id}/publish`, adminLogin.csrf, {});
    const applied = await post(employeeContext.request, `/api/employee/shifts/${created.shift.id}/apply`,
      employeeLogin.csrf, {}, 201);
    await post(adminContext.request, `/api/admin/applications/${applied.applicationId}/review`,
      adminLogin.csrf, { status: 'accepted' });
    const approved = await db.query(
      'SELECT id, employee_id, status FROM shift_assignments WHERE application_id = $1', [applied.applicationId],
    );
    expect(approved.rows).toHaveLength(1);
    expect(approved.rows[0]).toMatchObject({ employee_id: employee.id, status: 'assigned' });
    approvedId = approved.rows[0].id;

    attendanceId = randomUUID();
    await db.query(`
      INSERT INTO attendance_records (id, shift_assignment_id, check_in_at, check_out_at, attendance_status)
      VALUES ($1, $2, $3, $4, 'checked_out')
    `, [attendanceId, approvedId, startAt, endAt]);
    for (const status of ['cancelled', 'completed']) {
      await db.query(`
        INSERT INTO shift_assignments (shift_id, employee_id, assigned_by, status)
        VALUES ($1, $2, $3, $4)
      `, [created.shift.id, employee.id, admin.id, status]);
    }

    const confirmedStart = dutchLocalDateTimeToIso(targetWeek, '09:00');
    const confirmedEnd = dutchLocalDateTimeToIso(targetWeek, '10:00');
    const confirmedShift = await db.query(`
      INSERT INTO shifts (title, work_type, location, start_at, end_at, required_workers, status, created_by)
      VALUES ('Real confirmed fixture', 'traffic-control', 'Utrecht', $1, $2, 1, 'filled', $3) RETURNING id
    `, [confirmedStart, confirmedEnd, admin.id]);
    shiftIds.push(confirmedShift.rows[0].id);
    await db.query(`
      INSERT INTO shift_assignments (shift_id, employee_id, assigned_by, status, confirmed_at)
      VALUES ($1, $2, $3, 'confirmed', now())
    `, [confirmedShift.rows[0].id, employee.id, admin.id]);

    const currentWeek = moveScheduleAnchor(targetWeek, 'week', -1);
    const sunday = scheduleRange(currentWeek, 'week').days[6];
    const currentShift = await db.query(`
      INSERT INTO shifts (title, work_type, location, start_at, end_at, required_workers, status, created_by)
      VALUES ('Real current-week shift', 'traffic-control', 'Amsterdam', $1, $2, 1, 'filled', $3) RETURNING id
    `, [dutchLocalDateTimeToIso(sunday, '23:00'), dutchLocalDateTimeToIso(targetWeek, '00:00'), admin.id]);
    shiftIds.push(currentShift.rows[0].id);
    await db.query(`
      INSERT INTO shift_assignments (shift_id, employee_id, assigned_by, status)
      VALUES ($1, $2, $3, 'assigned')
    `, [currentShift.rows[0].id, employee.id, admin.id]);

    const otherShift = await db.query(`
      INSERT INTO shifts (title, work_type, location, start_at, end_at, required_workers, status, created_by)
      VALUES ('Other employee private shift', 'traffic-control', 'Rotterdam', $1, $2, 1, 'filled', $3) RETURNING id
    `, [startAt, endAt, admin.id]);
    shiftIds.push(otherShift.rows[0].id);
    const otherAssignment = await db.query(`
      INSERT INTO shift_assignments (shift_id, employee_id, assigned_by, status)
      VALUES ($1, $2, $3, 'assigned') RETURNING id
    `, [otherShift.rows[0].id, other.id, admin.id]);
    otherAssignmentId = otherAssignment.rows[0].id;
  });

  test('shows the real current-week schedule and count on the employee dashboard', async () => {
    const dashboard = await employeeContext.newPage();
    try {
      const pending = dashboard.waitForResponse(response => response.url().includes('/api/employee/schedule?'));
      await dashboard.goto('/nl/employee');
      const response = await pending;
      expect(response.status()).toBe(200);
      expect(employeeSchedulePageSchema.parse(await response.json()).assignments)
        .toHaveLength(1);
      const text = nl.employeeSchedule;
      const list = dashboard.getByRole('list', { name: text.upcomingTitle });
      await expect(list.getByRole('listitem')).toHaveCount(1);
      await expect(list.getByText('Real current-week shift', { exact: true })).toBeVisible();
      await expect(dashboard.getByRole('status', { name: text.upcomingCount.replace('{count}', '1') })).toHaveText('1');
      await expect(dashboard.getByText('Traffic Controller - Amsterdam', { exact: true })).toHaveCount(0);
      const link = dashboard.locator('a[href="/nl/employee/schedule"]').filter({ hasText: text.viewAll });
      await expect(link).toBeVisible();
      await link.click();
      await expect(dashboard).toHaveURL(/\/nl\/employee\/schedule$/);
    } finally {
      await dashboard.close();
    }
  });

  for (const locale of ['nl', 'ar'] as const) {
    test(`${locale} displays the real schedule, attendance, history and worksite time at mobile and desktop widths`, async () => {
      const text = (locale === 'ar' ? ar : nl).employeeSchedule;
      expect((await navigate(`/${locale}/employee/schedule`)).status()).toBe(200);
      const pending = page.waitForResponse(response => response.url().includes('/api/employee/schedule?')
        && new URL(response.url()).searchParams.get('dateFrom') === targetWeek);
      await page.getByRole('button', { name: text.nextWeek }).click();
      const response = await pending;
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('private, no-store');
      const body = await response.json();
      expect(body.assignments).toHaveLength(4);
      expect(body.assignments.every((item: { employeeId: string }) => item.employeeId === employee.id)).toBe(true);
      const result = employeeSchedulePageSchema.parse(body);
      expect(result.assignments.map(item => item.status).sort()).toEqual(['assigned', 'cancelled', 'completed', 'confirmed']);
      expect(result.assignments.find(item => item.id === approvedId)).toMatchObject({
        status: 'assigned',
        shift: { title: 'Real employee overnight shift', startAt, endAt, timeZone: 'Europe/Amsterdam', status: 'filled' },
        attendance: { id: attendanceId, checkInAt: startAt, checkOutAt: endAt, attendanceStatus: 'checked_out' },
      });
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(text.title);
      await expect(page.getByRole('heading', { name: 'Real employee overnight shift', exact: true })).toHaveCount(6);
      const row = page.getByRole('main').getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: 'Real employee overnight shift', exact: true }) })
        .filter({ hasText: `${text.assignmentStatus}: ${text.assignmentStatuses.assigned}` }).first();
      await expect(row.getByText(`${text.attendance}: ${text.attendanceStatuses.checked_out}`, { exact: true })).toBeVisible();
      const formatted = await page.evaluate(({ values, language }) => {
        const options = { calendar: 'gregory' as const, dateStyle: 'medium' as const, timeStyle: 'short' as const };
        const amsterdam = new Intl.DateTimeFormat(language, { ...options, timeZone: 'Europe/Amsterdam' });
        const riyadh = new Intl.DateTimeFormat(language, { ...options, timeZone: 'Asia/Riyadh' });
        return { actual: values.map(value => amsterdam.format(new Date(value))), riyadh: riyadh.format(new Date(values[0])) };
      }, { values: [startAt, endAt], language: locale === 'ar' ? 'ar' : 'nl-NL' });
      expect(formatted.actual[0]).not.toBe(formatted.riyadh);
      await expect(row.locator(`time[datetime="${startAt}"]`).first()).toHaveText(formatted.actual[0]);
      await expect(row.locator(`time[datetime="${endAt}"]`).first()).toHaveText(formatted.actual[1]);
      for (const width of [390, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }
      await page.getByRole('button', { name: text.month, exact: true }).click();
      await expect(page.getByRole('button', { name: text.month, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('heading', { name: 'Real employee overnight shift', exact: true }).first()).toBeVisible();
    });
  }

  test('prevents another employee or administrator from reading the employee’s assignments', async () => {
    const query = `?dateFrom=${targetWeek}&dateTo=${scheduleRange(targetWeek, 'week').to}&employeeId=${employee.id}`;
    const response = await otherContext.request.get(`/api/employee/schedule${query}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.assignments.map((item: { id: string }) => item.id)).toEqual([otherAssignmentId]);
    expect(body.assignments[0].employeeId).toBe(other.id);
    expect((await adminContext.request.get(`/api/employee/schedule${query}`)).status()).toBe(403);
    const otherPage = await otherContext.newPage();
    try {
      await otherPage.goto('/nl/employee/schedule');
      await otherPage.getByRole('button', { name: nl.employeeSchedule.nextWeek }).click();
      await expect(otherPage.getByRole('heading', { name: 'Other employee private shift', exact: true })).toHaveCount(2);
      await expect(otherPage.getByRole('heading', { name: 'Real employee overnight shift', exact: true })).toHaveCount(0);
    } finally {
      await otherPage.close();
    }
  });

  test('reports a revoked Redis session instead of showing an empty schedule', async () => {
    await redis.del(`session:${employeeLogin.jti}`);
    const pending = page.waitForResponse(response => response.url().includes('/api/employee/schedule?'));
    await page.getByRole('button', { name: ar.employeeSchedule.nextMonth }).click();
    expect((await pending).status()).toBe(401);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(ar.employeeSchedule.unauthorized);
    expect((await employeeContext.request.get('/api/employee/schedule')).status()).toBe(401);
  });

  test.afterAll(async () => {
    await adminContext?.close();
    await employeeContext?.close();
    await otherContext?.close();
    if (dbConnected) {
      if (profileIds.length) {
        await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [profileIds]);
        await db.query('DELETE FROM notifications WHERE recipient_id = ANY($1::uuid[])', [profileIds]);
      }
      if (shiftIds.length) await db.query('DELETE FROM shifts WHERE id = ANY($1::uuid[])', [shiftIds]);
      if (profileIds.length) await db.query('DELETE FROM profiles WHERE id = ANY($1::uuid[])', [profileIds]);
      await db.end();
    }
    if (redis.isOpen) {
      if (sessionKeys.length) {
        await redis.del(sessionKeys);
        expect(await redis.exists(sessionKeys)).toBe(0);
      }
      await redis.del('ratelimit:127.0.0.1:login');
      await redis.quit();
    }
  });
});

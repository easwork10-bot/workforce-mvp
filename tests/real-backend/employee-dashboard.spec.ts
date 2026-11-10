import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import argon2 from 'argon2';
import { decodeJwt } from 'jose';
import { Client } from 'pg';
import { createClient } from 'redis';
import { dutchLocalDateTimeToIso } from '../../src/frontend/features/admin-shifts/dutchDateTime';
import { dateKeyInTimeZone, DEFAULT_WORKSITE_TIME_ZONE } from '../../src/shared/worksite-time';
import { verifyTestDatabaseTarget } from '../support/database/testDatabaseSafety';
import nl from '../../src/locales/nl.json';
import ar from '../../src/locales/ar.json';

test.describe.serial('staffing workflow and real dashboard', () => {
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
  let assignmentId: string;
  let shiftId: string;

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
    const pending = page.waitForResponse(response => response.url().includes('/api/employee/dashboard'));
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

  test('shows genuine empty dashboard values', async () => {
    await navigate('/nl/employee');
    await expect(page.getByTestId('dashboard-pending')).toHaveText('0');
    await expect(page.getByTestId('dashboard-accepted')).toHaveText('0');
    await expect(page.getByTestId('dashboard-hours')).toHaveText('0');
    await expect(page.getByText(nl.employeeDashboard.emptyApplications, { exact: true })).toBeVisible();
  });

  test('creates and publishes a shift, applies, approves, attends, and updates the dashboard', async () => {
    const date = dateKeyInTimeZone(new Date(Date.now() + 86400000), DEFAULT_WORKSITE_TIME_ZONE);
    const created = await post(adminContext.request, '/api/admin/shifts', adminLogin.csrf, {
      title: 'Full staffing workflow', workType: 'cleaning', location: 'Amsterdam',
      startAt: dutchLocalDateTimeToIso(date, '09:00'), endAt: dutchLocalDateTimeToIso(date, '17:00'), requiredWorkers: 1,
    }, 201);
    shiftId = created.shift.id;
    shiftIds.push(shiftId);
    await post(adminContext.request, '/api/admin/shifts/' + shiftId + '/publish', adminLogin.csrf, {});
    const available = await employeeContext.request.get('/api/employee/shifts/' + shiftId);
    expect(available.status()).toBe(200);
    const application = await post(employeeContext.request, '/api/employee/shifts/' + shiftId + '/apply', employeeLogin.csrf, {}, 201);
    await navigate('/nl/employee');
    await expect(page.getByTestId('dashboard-pending')).toHaveText('1');
    const applications = page.getByRole('list', { name: nl.employeeDashboard.recentApplications, exact: true });
    await expect(applications.getByText('Full staffing workflow', { exact: true })).toBeVisible();
    await expect(applications.getByText(nl.employeeDashboard.statuses.pending, { exact: true })).toBeVisible();
    await post(adminContext.request, '/api/admin/applications/' + application.applicationId + '/review', adminLogin.csrf, { status: 'accepted' });
    await navigate('/nl/employee');
    await expect(page.getByTestId('dashboard-pending')).toHaveText('0');
    await expect(page.getByTestId('dashboard-accepted')).toHaveText('1');
    await expect(applications.getByText(nl.employeeDashboard.statuses.accepted, { exact: true })).toBeVisible();
    const schedule = await employeeContext.request.get('/api/employee/schedule?shiftId=' + shiftId);
    expect(schedule.status()).toBe(200);
    const assigned = (await schedule.json()).assignments;
    expect(assigned).toHaveLength(1);
    expect(assigned[0]).toMatchObject({ status: 'assigned', shift: { id: shiftId } });
    assignmentId = assigned[0].id;
    await page.goto('/nl/attendance/check-in?date=' + date);
    await page.getByRole('button', { name: nl.employeeAttendance.checkIn, exact: true }).click();
    await expect(page.getByRole('button', { name: nl.employeeAttendance.checkOut, exact: true })).toBeEnabled();
    await page.getByRole('button', { name: nl.employeeAttendance.checkOut, exact: true }).click();
    await expect(page.getByRole('main').getByRole('status').filter({ hasText: nl.employeeAttendance.checkOutSuccess })).toBeVisible();
    const overview = await adminContext.request.get('/api/admin/attendance?assignmentId=' + assignmentId);
    expect(overview.status()).toBe(200);
    const records = (await overview.json()).records;
    expect(records).toHaveLength(1);
    expect(records[0].attendanceStatus).toBe('checked_out');
    expect(Date.parse(records[0].checkOutAt)).toBeGreaterThanOrEqual(Date.parse(records[0].checkInAt));
    const dashboard = await employeeContext.request.get('/api/employee/dashboard');
    expect(dashboard.status()).toBe(200);
    expect(dashboard.headers()['cache-control']).toBe('private, no-store');
    const hours = (Date.parse(records[0].checkOutAt) - Date.parse(records[0].checkInAt)) / 3600000;
    expect((await dashboard.json()).workedHoursThisMonth).toBeCloseTo(hours, 6);
    await navigate('/nl/employee');
    const formattedHours = await page.evaluate(value =>
      new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(value), hours);
    await expect(page.getByTestId('dashboard-hours')).toHaveText(formattedHours);
    const adminDashboard = await adminContext.newPage();
    try {
      await adminDashboard.goto('/nl/admin');
      await expect(adminDashboard.getByText('Full staffing workflow', { exact: true })).toBeVisible();
      await expect(adminDashboard.getByTestId('admin-dashboard-stat-total')).toHaveText('1');
      await expect(adminDashboard.getByTestId('admin-dashboard-stat-open')).toHaveText('0');
      await expect(adminDashboard.getByTestId('admin-dashboard-stat-filled')).toHaveText('1');
    } finally {
      await adminDashboard.close();
    }
  });

  test('keeps employee data private and supports Arabic mobile navigation', async () => {
    const otherDashboard = await otherContext.request.get('/api/employee/dashboard?employeeId=' + employee.id);
    expect(otherDashboard.status()).toBe(200);
    expect(await otherDashboard.json()).toMatchObject({ pendingApplications: 0, acceptedThisMonth: 0, workedHoursThisMonth: 0, recentApplications: [] });
    expect((await adminContext.request.get('/api/employee/dashboard')).status()).toBe(403);
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate('/ar/employee');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('dashboard-accepted')).toHaveText(await page.evaluate(() => new Intl.NumberFormat('ar').format(1)));
    await expect(page.getByRole('list', { name: ar.employeeDashboard.recentApplications }).getByText(ar.employeeDashboard.statuses.accepted, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: ar.employeeDashboard.attendance + ' ' + ar.employeeDashboard.attendanceDescription })).toHaveAttribute('href', '/ar/attendance/check-in');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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

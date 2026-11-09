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

test.describe.serial('real employee attendance', () => {
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


  test('shows an empty real attendance page, then loads an owned assignment', async () => {
    await navigate('/nl/attendance/check-in');
    await expect(page.getByRole('status')).toHaveText(nl.employeeAttendance.empty);
    const date = dateKeyInTimeZone(new Date(), DEFAULT_WORKSITE_TIME_ZONE);
    const result = await db.query(`
      INSERT INTO shifts (title, work_type, location, start_at, end_at, required_workers, status, created_by)
      VALUES ('Attendance delivery shift', 'cleaning', 'Amsterdam', $1, $2, 1, 'filled', $3) RETURNING id
    `, [dutchLocalDateTimeToIso(date, '00:00'), dutchLocalDateTimeToIso(date, '23:59'), admin.id]);
    shiftId = result.rows[0].id;
    shiftIds.push(shiftId);
    const assigned = await db.query(`
      INSERT INTO shift_assignments (shift_id, employee_id, assigned_by, status)
      VALUES ($1, $2, $3, 'assigned') RETURNING id
    `, [shiftId, employee.id, admin.id]);
    assignmentId = assigned.rows[0].id;
    await page.getByRole('button', { name: nl.employeeAttendance.refresh, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Attendance delivery shift' })).toBeVisible();
    await expect(page.getByRole('button', { name: nl.employeeAttendance.checkOut, exact: true })).toBeDisabled();
    await navigate('/nl/employee/schedule');
    await page.getByRole('link', { name: nl.employeeSchedule.attendance, exact: true }).click();
    await expect(page.getByLabel(nl.employeeAttendance.date)).toHaveValue(date);
    await expect(page.getByRole('heading', { name: 'Attendance delivery shift' })).toBeVisible();
  });

  test('rejects unauthorized, foreign-owner, CSRF, and invalid checkout requests', async ({ browser }) => {
    const anonymous = await browser.newContext({ baseURL: 'https://localhost:3197', ignoreHTTPSErrors: true });
    try {
      const anonymousCsrf = (await (await anonymous.request.get('/api/auth/csrf')).json()).csrfToken;
      for (const action of ['check-in', 'check-out']) {
        const path = '/api/employee/attendance/' + action;
        expect((await anonymous.request.post(path, { headers: { 'x-csrf-token': anonymousCsrf }, data: { shiftAssignmentId: assignmentId } })).status()).toBe(401);
        const token = (await (await otherContext.request.get('/api/auth/csrf')).json()).csrfToken;
        await post(otherContext.request, path, token, { shiftAssignmentId: assignmentId }, 400);
        await post(adminContext.request, path, adminLogin.csrf, { shiftAssignmentId: assignmentId }, 403);
      }
      expect((await employeeContext.request.post('/api/employee/attendance/check-in', { data: { shiftAssignmentId: assignmentId } })).status()).toBe(403);
      await post(employeeContext.request, '/api/employee/attendance/check-out', employeeLogin.csrf, { shiftAssignmentId: assignmentId }, 400);
      expect((await db.query('SELECT * FROM attendance_records WHERE shift_assignment_id = $1', [assignmentId])).rows).toHaveLength(0);
    } finally { await anonymous.close(); }
  });

  test('persists check-in and checkout through the UI and across reloads in both locales', async () => {
    await page.getByRole('button', { name: nl.employeeAttendance.checkIn, exact: true }).click();
    await expect(page.getByRole('main').getByRole('status').filter({ hasText: nl.employeeAttendance.checkInSuccess })).toHaveText(nl.employeeAttendance.checkInSuccess);
    await expect(page.getByRole('button', { name: nl.employeeAttendance.checkOut, exact: true })).toBeEnabled();
    const checkedIn = await db.query('SELECT * FROM attendance_records WHERE shift_assignment_id = $1', [assignmentId]);
    expect(checkedIn.rows).toHaveLength(1);
    expect(checkedIn.rows[0]).toMatchObject({ attendance_status: 'checked_in', check_in_latitude: null, check_out_at: null });
    expect(checkedIn.rows[0].check_in_at).toBeInstanceOf(Date);
    expect((await db.query('SELECT status FROM shift_assignments WHERE id = $1', [assignmentId])).rows[0].status).toBe('confirmed');
    await post(employeeContext.request, '/api/employee/attendance/check-in', employeeLogin.csrf, { shiftAssignmentId: assignmentId }, 400);
    await page.reload();
    await expect(page.getByRole('button', { name: nl.employeeAttendance.checkIn, exact: true })).toBeDisabled();
    await navigate('/ar/attendance/check-in');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: ar.employeeAttendance.checkOut, exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: ar.employeeAttendance.checkOut, exact: true }).click();
    await expect(page.getByRole('main').getByRole('status').filter({ hasText: ar.employeeAttendance.checkOutSuccess })).toHaveText(ar.employeeAttendance.checkOutSuccess);
    await expect(page.getByRole('button', { name: ar.employeeAttendance.checkOut, exact: true })).toBeDisabled();
    const checkedOut = (await db.query('SELECT * FROM attendance_records WHERE shift_assignment_id = $1', [assignmentId])).rows;
    expect(checkedOut).toHaveLength(1);
    expect(checkedOut[0].attendance_status).toBe('checked_out');
    expect(checkedOut[0].check_in_at).toEqual(checkedIn.rows[0].check_in_at);
    expect(checkedOut[0].check_out_at.getTime()).toBeGreaterThanOrEqual(checkedIn.rows[0].check_in_at.getTime());
    await post(employeeContext.request, '/api/employee/attendance/check-out', employeeLogin.csrf, { shiftAssignmentId: assignmentId }, 400);
    await page.reload();
    await expect(page.getByText(ar.employeeSchedule.attendance + ': ' + ar.employeeSchedule.attendanceStatuses.checked_out, { exact: true })).toBeVisible();
  });

  test('preserves repeated sessions, rejects late duplicates, and serializes simultaneous actions', async () => {
    const request = (action: string) => employeeContext.request.post('/api/employee/attendance/' + action, {
      headers: { 'x-csrf-token': employeeLogin.csrf }, data: { shiftAssignmentId: assignmentId },
    });
    const results = await Promise.all([request('check-in'), request('check-in')]);
    expect(results.map(result => result.status()).sort()).toEqual([200, 400]);
    await db.query("UPDATE attendance_records SET attendance_status = 'late' WHERE shift_assignment_id = $1 AND attendance_status = 'checked_in'", [assignmentId]);
    expect((await request('check-in')).status()).toBe(400);
    const checkouts = await Promise.all([request('check-out'), request('check-out')]);
    expect(checkouts.map(result => result.status()).sort()).toEqual([200, 400]);
    expect((await db.query('SELECT * FROM attendance_records WHERE shift_assignment_id = $1', [assignmentId])).rows).toHaveLength(2);
  });

  test('enforces assignment restrictions and shows localized invalid-action feedback after a stale view', async () => {
    await navigate('/nl/attendance/check-in');
    await expect(page.getByRole('button', { name: nl.employeeAttendance.checkIn, exact: true })).toBeEnabled();
    await db.query("UPDATE shift_assignments SET status = 'cancelled' WHERE id = $1", [assignmentId]);
    await page.getByRole('button', { name: nl.employeeAttendance.checkIn, exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(nl.employeeAttendance.invalidAction);
    await expect(page.getByRole('button', { name: nl.employeeAttendance.checkIn, exact: true })).toBeDisabled();
    for (const status of ['cancelled', 'completed']) {
      await db.query('UPDATE shift_assignments SET status = $1 WHERE id = $2', [status, assignmentId]);
      await post(employeeContext.request, '/api/employee/attendance/check-in', employeeLogin.csrf, { shiftAssignmentId: assignmentId }, 400);
    }
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

import { expect } from '@playwright/test';
import { employeeTest as test } from './authenticated-test';

for (const locale of ['nl', 'ar'] as const) {
  test(`${locale} login links to localized registration with a translated label`, async ({ page }) => {
    await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: 'Unauthenticated' } }));
    await page.goto(`/${locale}/auth/login`);
    const registration = page.locator('p').getByRole('link', { name: locale === 'ar' ? 'التسجيل' : 'Registreren', exact: true });
    await expect(registration).toHaveAttribute('href', `/${locale}/auth/register`);
    await registration.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/auth/register$`));
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
  });

  test(`${locale} login preserves the locale in the dashboard redirect`, async ({ page }) => {
    await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: 'Unauthenticated' } }));
    await page.route('**/api/auth/login', route => route.fulfill({ json: { user: { role: 'employee' } } }));
    await page.goto(`/${locale}/auth/login`);
    await page.getByLabel(locale === 'ar' ? 'البريد الإلكتروني' : 'E-mailadres').fill('employee@workforce.test');
    await page.getByLabel(locale === 'ar' ? 'كلمة المرور' : 'Wachtwoord', { exact: true }).fill('password123');
    await page.getByRole('button', { name: locale === 'ar' ? 'تسجيل الدخول' : 'Inloggen', exact: true }).last().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/employee$`));
  });

  test(`${locale} logout sends CSRF and stays in the current locale`, async ({ page }) => {
    let loggedIn = true;
    await page.route('**/api/auth/me', route => route.fulfill({ json: loggedIn ? {
      user: { id: 'employee', fullName: 'Employee', email: 'employee@workforce.test', role: 'employee', preferredLanguage: locale },
    } : { user: null }, status: loggedIn ? 200 : 401 }));
    await page.route('**/api/auth/csrf', route => route.fulfill({ json: { csrfToken: 'test-csrf' } }));
    let csrf: string | undefined;
    await page.route('**/api/auth/logout', route => {
      csrf = route.request().headers()['x-csrf-token'];
      loggedIn = false;
      return route.fulfill({ json: { success: true } });
    });

    await page.goto(`/${locale}/employee`);
    await page.getByRole('button', { name: locale === 'ar' ? 'تسجيل الخروج' : 'Uitloggen' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/auth/login$`));
    expect(csrf).toBe('test-csrf');
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
  });

  test(`${locale} failed logout stays on the page and reports the error`, async ({ page }) => {
    await page.route('**/api/auth/me', route => route.fulfill({ json: {
      user: { id: 'employee', fullName: 'Employee', email: 'employee@workforce.test', role: 'employee', preferredLanguage: locale },
    } }));
    await page.route('**/api/auth/csrf', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
    let logoutCalls = 0;
    await page.route('**/api/auth/logout', route => { logoutCalls++; return route.abort(); });
    await page.goto(`/${locale}/employee`);
    await page.getByRole('button', { name: locale === 'ar' ? 'تسجيل الخروج' : 'Uitloggen' }).first().click();
    await expect(page.locator('header').first().getByRole('alert')).toHaveText(locale === 'ar'
      ? 'تعذر تسجيل الخروج. حاول مرة أخرى.'
      : 'Uitloggen is mislukt. Probeer het opnieuw.');
    await expect(page).toHaveURL(new RegExp(`/${locale}/employee$`));
    expect(logoutCalls).toBe(0);
  });
}

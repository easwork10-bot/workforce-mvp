import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { findFrontendBoundaryViolations } from '../scripts/check-frontend-boundaries.mjs';

const projectRoot = process.cwd();

describe('frontend foundation architecture', () => {
  it('keeps the frontend dependency graph inside browser-safe frontend and shared modules', async () => {
    await expect(findFrontendBoundaryViolations(path.join(projectRoot, 'src/frontend'))).resolves.toEqual([]);
  });

  it.each([
    '@/backend/db',
    '@/backend/auth/tokens',
    '@/backend/security/csrf',
    '@/backend/services/attendance',
    '@/backend/jobs/shiftReminders',
    '@/backend/validation/auth',
  ])(
    'detects an intentional frontend-to-server import violation for %s',
    async (moduleSpecifier) => {
      const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'frontend-boundary-probe-'));
      try {
        await writeFile(
          path.join(temporaryRoot, 'probe.ts'),
          `import { value } from '${moduleSpecifier}';\nvoid value;\n`,
          'utf8'
        );

        await expect(findFrontendBoundaryViolations(temporaryRoot)).resolves.toEqual([
          expect.stringContaining(`imports outside the frontend/shared boundary: ${moduleSpecifier}`),
        ]);
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  );

  it('keeps localized framework route shells and frontend component entry points', async () => {
    const requiredRoutes = [
      'src/app/[locale]/layout.tsx',
      'src/app/[locale]/page.tsx',
      'src/app/[locale]/auth/login/page.tsx',
      'src/app/[locale]/auth/register/page.tsx',
      'src/app/[locale]/employee/shifts/page.tsx',
      'src/app/api/auth/login/route.ts',
      'src/app/api/auth/register/route.ts',
      'src/app/api/auth/logout/route.ts',
      'src/app/api/auth/me/route.ts',
    ];
    await Promise.all(requiredRoutes.map((file) => readFile(path.join(projectRoot, file), 'utf8')));

    const layout = await readFile(path.join(projectRoot, 'src/app/[locale]/layout.tsx'), 'utf8');
    expect(layout).toContain("dir={locale === 'ar' ? 'rtl' : 'ltr'}");
    expect(layout).toContain("{ locale: 'nl' }, { locale: 'ar' }");

    const [sessionProvider, button, card, navigation] = await Promise.all([
      readFile(path.join(projectRoot, 'src/frontend/components/session-provider.tsx'), 'utf8'),
      readFile(path.join(projectRoot, 'src/frontend/ui/button.tsx'), 'utf8'),
      readFile(path.join(projectRoot, 'src/frontend/ui/card.tsx'), 'utf8'),
      readFile(path.join(projectRoot, 'src/frontend/components/navigation.tsx'), 'utf8'),
    ]);
    expect(sessionProvider).toContain('export function SessionProvider');
    expect(button).toContain('export { Button, buttonVariants }');
    expect(card).toContain('export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }');
    expect(navigation).toContain('useSession');
  });
});

import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { verifyAccessToken } from '@/backend/auth/tokens';
import { getSession } from '@/backend/auth/session';

type Role = 'administrator' | 'supervisor' | 'employee';

export async function requirePageRole(locale: string, role: Role): Promise<void> {
  if (locale !== 'nl' && locale !== 'ar') notFound();

  const token = (await cookies()).get('access_token')?.value;
  const payload = token ? await verifyAccessToken(token) : null;
  const session = payload ? await getSession(payload.jti) : null;
  if (!session) redirect(`/${locale}/auth/login`);
  if (session.role !== role) notFound();
}

import { requirePageRole } from '@/backend/security/requirePageRole';
import CheckIn from './CheckIn';
import { dateKeyInTimeZone, DEFAULT_WORKSITE_TIME_ZONE } from '@/shared/worksite-time';
import { z } from 'zod';

export default async function CheckInPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  await requirePageRole((await params).locale, 'employee');
  const date = z.string().date().safeParse((await searchParams).date);
  return <CheckIn initialDate={date.success ? date.data : dateKeyInTimeZone(new Date(), DEFAULT_WORKSITE_TIME_ZONE)} />;
}

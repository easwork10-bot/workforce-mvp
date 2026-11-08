import { requirePageRole } from '@/backend/security/requirePageRole';
import { dateKeyInTimeZone, DEFAULT_WORKSITE_TIME_ZONE } from '@/shared/worksite-time';
import Schedule from './Schedule';

export default async function SchedulePage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageRole((await params).locale, 'employee');
  return <Schedule initialDate={dateKeyInTimeZone(new Date(), DEFAULT_WORKSITE_TIME_ZONE)} />;
}

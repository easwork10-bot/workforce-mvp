import { requirePageRole } from '@/backend/security/requirePageRole';
import Schedule from './Schedule';

export default async function SchedulePage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageRole((await params).locale, 'employee');
  return <Schedule />;
}

import { requirePageRole } from '@/backend/security/requirePageRole';
import Schedule from './Schedule';

export default async function SchedulePage({ params }: { params: { locale: string } }) {
  await requirePageRole(params.locale, 'employee');
  return <Schedule />;
}

import { requirePageRole } from '@/backend/security/requirePageRole';
import CheckIn from './CheckIn';

export default async function CheckInPage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageRole((await params).locale, 'employee');
  return <CheckIn />;
}

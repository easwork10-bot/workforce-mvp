import { requirePageRole } from '@/backend/security/requirePageRole';
import CheckIn from './CheckIn';

export default async function CheckInPage({ params }: { params: { locale: string } }) {
  await requirePageRole(params.locale, 'employee');
  return <CheckIn />;
}

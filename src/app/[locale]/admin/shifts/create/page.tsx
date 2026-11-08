import { requirePageRole } from '@/backend/security/requirePageRole';
import CreateShift from './CreateShift';

export default async function CreateShiftPage({ params }: { params: { locale: string } }) {
  await requirePageRole(params.locale, 'administrator');
  return <CreateShift />;
}

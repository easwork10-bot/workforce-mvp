import { requirePageRole } from '@/backend/security/requirePageRole';
import CreateShift from './CreateShift';

export default async function CreateShiftPage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageRole((await params).locale, 'administrator');
  return <CreateShift />;
}

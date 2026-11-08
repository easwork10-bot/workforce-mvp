import AdminShiftList from '@/frontend/features/admin-shifts/AdminShiftList';
import { requirePageRole } from '@/backend/security/requirePageRole';

export default async function AdminShiftsPage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageRole((await params).locale, 'administrator');
  return <AdminShiftList />;
}

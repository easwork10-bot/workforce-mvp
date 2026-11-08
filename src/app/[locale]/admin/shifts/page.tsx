import AdminShiftList from '@/frontend/features/admin-shifts/AdminShiftList';
import { requirePageRole } from '@/backend/security/requirePageRole';

export default async function AdminShiftsPage({ params }: { params: { locale: string } }) {
  await requirePageRole(params.locale, 'administrator');
  return <AdminShiftList />;
}

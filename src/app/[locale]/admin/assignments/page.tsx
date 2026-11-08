import AdminAssignmentList from '@/frontend/features/admin-assignments/AdminAssignmentList';
import { requirePageRole } from '@/backend/security/requirePageRole';

export default async function AdminAssignmentsPage({ params }: { params: { locale: string } }) {
  await requirePageRole(params.locale, 'administrator');
  return <AdminAssignmentList />;
}

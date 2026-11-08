import AdminAssignmentList from '@/frontend/features/admin-assignments/AdminAssignmentList';
import { requirePageRole } from '@/backend/security/requirePageRole';

export default async function AdminAssignmentsPage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageRole((await params).locale, 'administrator');
  return <AdminAssignmentList />;
}

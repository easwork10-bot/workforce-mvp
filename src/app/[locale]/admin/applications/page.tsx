import AdminApplicationList from '@/frontend/features/admin-applications/AdminApplicationList';
import { requirePageRole } from '@/backend/security/requirePageRole';

export default async function AdminApplicationsPage({ params }: { params: { locale: string } }) {
  await requirePageRole(params.locale, 'administrator');
  return <AdminApplicationList />;
}

import AdminApplicationList from '@/frontend/features/admin-applications/AdminApplicationList';
import { requirePageRole } from '@/backend/security/requirePageRole';

export default async function AdminApplicationsPage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageRole((await params).locale, 'administrator');
  return <AdminApplicationList />;
}

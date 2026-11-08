import { requirePageRole } from '@/backend/security/requirePageRole';
import AdminDashboard from './AdminDashboard';

export default async function AdminPage({ params }: { params: { locale: string } }) {
  await requirePageRole(params.locale, 'administrator');
  return <AdminDashboard />;
}

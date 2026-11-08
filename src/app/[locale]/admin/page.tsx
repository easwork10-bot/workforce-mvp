import { requirePageRole } from '@/backend/security/requirePageRole';
import AdminDashboard from './AdminDashboard';

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageRole((await params).locale, 'administrator');
  return <AdminDashboard />;
}

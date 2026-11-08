import { requirePageRole } from '@/backend/security/requirePageRole';
import EmployeeApplicationsPage from './EmployeeApplicationsPage';

export default async function ApplicationsPage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageRole((await params).locale, 'employee');
  return <EmployeeApplicationsPage />;
}

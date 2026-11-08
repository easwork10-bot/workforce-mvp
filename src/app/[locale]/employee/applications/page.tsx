import { requirePageRole } from '@/backend/security/requirePageRole';
import EmployeeApplicationsPage from './EmployeeApplicationsPage';

export default async function ApplicationsPage({ params }: { params: { locale: string } }) {
  await requirePageRole(params.locale, 'employee');
  return <EmployeeApplicationsPage />;
}

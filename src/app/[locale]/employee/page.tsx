import { requirePageRole } from '@/backend/security/requirePageRole';
import EmployeeDashboard from './EmployeeDashboard';

export default async function EmployeePage({ params }: { params: { locale: string } }) {
  await requirePageRole(params.locale, 'employee');
  return <EmployeeDashboard />;
}

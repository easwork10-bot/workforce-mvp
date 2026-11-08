import { requirePageRole } from '@/backend/security/requirePageRole';
import EmployeeDashboard from './EmployeeDashboard';

export default async function EmployeePage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageRole((await params).locale, 'employee');
  return <EmployeeDashboard />;
}

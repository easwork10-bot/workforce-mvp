import EmployeeShiftBrowser from '@/frontend/features/employee-shifts/EmployeeShiftBrowser';
import { requirePageRole } from '@/backend/security/requirePageRole';

export default async function EmployeeShiftsPage({ params }: { params: { locale: string } }) {
  await requirePageRole(params.locale, 'employee');
  return <EmployeeShiftBrowser />;
}
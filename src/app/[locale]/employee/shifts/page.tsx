import EmployeeShiftBrowser from '@/frontend/features/employee-shifts/EmployeeShiftBrowser';
import { requirePageRole } from '@/backend/security/requirePageRole';

export default async function EmployeeShiftsPage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageRole((await params).locale, 'employee');
  return <EmployeeShiftBrowser />;
}
import { employeeDashboardSchema, type EmployeeDashboardSummary } from '@/shared/employee-dashboard';
import { EmployeeScheduleApiError } from '@/frontend/features/employee-schedule/employeeScheduleApi';

export async function fetchEmployeeDashboard(signal?: AbortSignal): Promise<EmployeeDashboardSummary> {
  const response = await fetch('/api/employee/dashboard', {
    credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new EmployeeScheduleApiError(response.status);
  const parsed = employeeDashboardSchema.safeParse(await response.json());
  if (!parsed.success) throw new EmployeeScheduleApiError(undefined, 'INVALID_RESPONSE');
  return parsed.data;
}

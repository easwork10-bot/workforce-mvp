import { employeeSchedulePageSchema, type EmployeeSchedulePage } from '@/shared/employee-schedule';

export class EmployeeScheduleApiError extends Error {
  constructor(readonly status?: number, readonly code?: string) {
    super(code ?? 'SCHEDULE_REQUEST_FAILED');
    this.name = 'EmployeeScheduleApiError';
  }
}

export type EmployeeScheduleErrorKind = 'unauthorized' | 'forbidden' | 'unavailable' | 'loadError';

export function employeeScheduleErrorKind(error: unknown): EmployeeScheduleErrorKind {
  if (error instanceof EmployeeScheduleApiError) {
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403) return 'forbidden';
    if (error.status === 503) return 'unavailable';
  }
  return 'loadError';
}

export async function fetchEmployeeSchedule(
  dateFrom: string,
  dateTo: string,
  page: number,
  signal?: AbortSignal,
): Promise<EmployeeSchedulePage> {
  const query = new URLSearchParams({ dateFrom, dateTo, page: String(page), limit: '20' });
  const response = await fetch(`/api/employee/schedule?${query}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new EmployeeScheduleApiError(response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof SyntaxError) throw new EmployeeScheduleApiError(response.status, 'INVALID_RESPONSE');
    throw error;
  }
  const parsed = employeeSchedulePageSchema.safeParse(body);
  if (!parsed.success || parsed.data.pagination.page !== page || parsed.data.pagination.limit !== 20) {
    throw new EmployeeScheduleApiError(response.status, 'INVALID_RESPONSE');
  }
  return parsed.data;
}

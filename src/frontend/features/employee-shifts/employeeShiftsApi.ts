export type EmployeeShift = {
  id: string;
  title: string;
  workType: string;
  clientOrProject: string | null;
  location: string;
  startAt: string;
  endAt: string;
  requiredWorkers: number;
  compensationType: 'hourly' | 'fixed' | 'daily';
  compensationAmount: string | null;
  description: string | null;
  applicationCount: number;
  assignedCount: number;
  hasApplied: boolean;
};

export type EmployeeShiftPage = {
  shifts: EmployeeShift[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type EmployeeShiftApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid'
  | 'server'
  | 'network'
  | 'csrf';

export class EmployeeShiftApiError extends Error {
  constructor(
    readonly kind: EmployeeShiftApiErrorKind,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'EmployeeShiftApiError';
  }
}

const PAGE_SIZE = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEmployeeShift(value: unknown): value is EmployeeShift {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.workType === 'string'
    && (typeof value.clientOrProject === 'string' || value.clientOrProject === null)
    && typeof value.location === 'string'
    && typeof value.startAt === 'string'
    && typeof value.endAt === 'string'
    && typeof value.requiredWorkers === 'number'
    && ['hourly', 'fixed', 'daily'].includes(String(value.compensationType))
    && (typeof value.compensationAmount === 'string' || value.compensationAmount === null)
    && (typeof value.description === 'string' || value.description === null)
    && typeof value.applicationCount === 'number'
    && typeof value.assignedCount === 'number'
    && typeof value.hasApplied === 'boolean';
}

function isEmployeeShiftPage(value: unknown): value is EmployeeShiftPage {
  if (!isRecord(value) || !Array.isArray(value.shifts) || !isRecord(value.pagination)) {
    return false;
  }

  const pagination = value.pagination;
  return value.shifts.every(isEmployeeShift)
    && typeof pagination.page === 'number'
    && typeof pagination.limit === 'number'
    && typeof pagination.total === 'number'
    && typeof pagination.totalPages === 'number';
}

function errorKindForStatus(status: number): EmployeeShiftApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status >= 400 && status < 500) return 'invalid';
  return 'server';
}

async function readResponse(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string'
      ? body.error
      : `Request failed with status ${response.status}`;
    throw new EmployeeShiftApiError(errorKindForStatus(response.status), message, response.status);
  }

  return body;
}

async function request(url: string, init: RequestInit): Promise<unknown> {
  try {
    return await readResponse(await fetch(url, init));
  } catch (error) {
    if (error instanceof EmployeeShiftApiError) throw error;
    throw new EmployeeShiftApiError('network', 'Unable to reach the server.');
  }
}

export async function fetchEmployeeShifts(
  page: number,
  signal?: AbortSignal
): Promise<EmployeeShiftPage> {
  const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  const body = await request(`/api/employee/shifts?${query}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: { Accept: 'application/json' },
  });

  if (!isEmployeeShiftPage(body)) {
    throw new EmployeeShiftApiError('server', 'The shifts response was invalid.');
  }

  return body;
}

async function fetchCsrfToken(): Promise<string> {
  let body: unknown;
  try {
    body = await request('/api/auth/csrf', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error instanceof EmployeeShiftApiError) {
      throw new EmployeeShiftApiError('csrf', error.message, error.status);
    }
    throw error;
  }

  if (!isRecord(body) || typeof body.csrfToken !== 'string' || body.csrfToken.length === 0) {
    throw new EmployeeShiftApiError('csrf', 'The CSRF token response was invalid.');
  }

  return body.csrfToken;
}

export async function applyForEmployeeShift(shiftId: string): Promise<void> {
  const csrfToken = await fetchCsrfToken();
  const body = await request(`/api/employee/shifts/${encodeURIComponent(shiftId)}/apply`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'x-csrf-token': csrfToken,
    },
  });

  if (!isRecord(body) || typeof body.message !== 'string' || typeof body.applicationId !== 'string') {
    throw new EmployeeShiftApiError('server', 'The application response was invalid.');
  }
}

export type EmployeeApplicationStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export type EmployeeApplication = {
  id: string;
  shiftId: string;
  status: EmployeeApplicationStatus;
  appliedAt: string;
  shift: {
    title: string;
    startAt: string;
    endAt: string;
    location: string;
  };
};

export type EmployeeApplicationPage = {
  applications: EmployeeApplication[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type EmployeeApplicationsApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid'
  | 'server'
  | 'network';

export class EmployeeApplicationsApiError extends Error {
  constructor(
    readonly kind: EmployeeApplicationsApiErrorKind,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'EmployeeApplicationsApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isEmployeeApplication(value: unknown): value is EmployeeApplication {
  if (!isRecord(value) || !isRecord(value.shift)) return false;

  return typeof value.id === 'string'
    && typeof value.shiftId === 'string'
    && ['pending', 'accepted', 'rejected', 'cancelled'].includes(String(value.status))
    && isDateString(value.appliedAt)
    && typeof value.shift.title === 'string'
    && isDateString(value.shift.startAt)
    && isDateString(value.shift.endAt)
    && typeof value.shift.location === 'string';
}

function isEmployeeApplicationPage(value: unknown): value is EmployeeApplicationPage {
  if (!isRecord(value) || !Array.isArray(value.applications) || !isRecord(value.pagination)) {
    return false;
  }

  const { page, limit, total, totalPages } = value.pagination;
  return value.applications.every(isEmployeeApplication)
    && Number.isInteger(page) && Number(page) > 0
    && Number.isInteger(limit) && Number(limit) > 0 && Number(limit) <= 100
    && Number.isInteger(total) && Number(total) >= 0
    && Number.isInteger(totalPages) && Number(totalPages) >= 0;
}

function errorKindForStatus(status: number): EmployeeApplicationsApiErrorKind {
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
    throw new EmployeeApplicationsApiError(errorKindForStatus(response.status), message, response.status);
  }

  return body;
}

export async function fetchEmployeeApplications(
  page: number,
  limit: number,
  signal?: AbortSignal
): Promise<EmployeeApplicationPage> {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new EmployeeApplicationsApiError('invalid', 'Invalid application pagination.');
  }

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  let body: unknown;
  try {
    const response = await fetch(`/api/employee/applications?${query}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: { Accept: 'application/json' },
    });
    body = await readResponse(response);
  } catch (error) {
    if (error instanceof EmployeeApplicationsApiError) throw error;
    if (signal?.aborted) throw error;
    throw new EmployeeApplicationsApiError('network', 'Unable to reach the server.');
  }

  if (!isEmployeeApplicationPage(body)) {
    throw new EmployeeApplicationsApiError('server', 'The applications response was invalid.');
  }

  return body;
}

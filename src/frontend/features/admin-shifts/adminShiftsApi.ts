import type {
  AdminShift,
  AdminShiftInput,
  AdminShiftPage,
  AdminShiftQuery,
  ShiftStatus,
} from '@/shared/admin-shifts';

export type {
  AdminShift,
  AdminShiftInput,
  AdminShiftPage,
  AdminShiftQuery,
} from '@/shared/admin-shifts';

export class AdminShiftApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AdminShiftApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readFieldErrors(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined;
  const errors: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(value)) {
    if (Array.isArray(messages) && messages.every((message) => typeof message === 'string')) {
      errors[field] = messages;
    }
  }
  return errors;
}

const statuses = new Set<ShiftStatus>(['draft', 'open', 'filled', 'cancelled', 'completed']);

function isAdminShift(value: unknown): value is AdminShift {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.workType === 'string'
    && (typeof value.clientOrProject === 'string' || value.clientOrProject === null)
    && typeof value.location === 'string'
    && typeof value.startAt === 'string'
    && typeof value.endAt === 'string'
    && typeof value.requiredWorkers === 'number'
    && typeof value.applicationCount === 'number'
    && typeof value.assignedCount === 'number'
    && typeof value.status === 'string'
    && statuses.has(value.status as ShiftStatus);
}

function isAdminShiftPage(value: unknown): value is AdminShiftPage {
  if (
    !isRecord(value)
    || !Array.isArray(value.shifts)
    || !value.shifts.every(isAdminShift)
    || !isRecord(value.pagination)
    || typeof value.pagination.page !== 'number'
    || typeof value.pagination.limit !== 'number'
    || typeof value.pagination.total !== 'number'
    || typeof value.pagination.totalPages !== 'number'
    || !isRecord(value.stats)
  ) {
    return false;
  }
  const stats = value.stats;
  return ['total', 'draft', 'open', 'filled', 'cancelled', 'completed']
    .every((key) => typeof stats[key] === 'number');
}

async function readJson(response: Response): Promise<unknown> {
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
    const details = isRecord(body) ? readFieldErrors(body.details) : undefined;
    throw new AdminShiftApiError(message, response.status, details);
  }
  return body;
}

async function fetchCsrfToken(): Promise<string> {
  const body = await readJson(await fetch('/api/auth/csrf', {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  }));
  if (!isRecord(body) || typeof body.csrfToken !== 'string' || body.csrfToken.length === 0) {
    throw new AdminShiftApiError('The security token response was invalid.');
  }
  return body.csrfToken;
}

async function postJson(url: string, body?: unknown): Promise<unknown> {
  const csrfToken = await fetchCsrfToken();
  return readJson(await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

export async function fetchAdminShifts({
  page = 1,
  limit = 20,
  status,
  sortBy = 'startAt',
  sortOrder = 'asc',
}: AdminShiftQuery = {}, signal?: AbortSignal): Promise<AdminShiftPage> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sortBy,
    sortOrder,
  });
  if (status) query.set('status', status);

  const body = await readJson(await fetch(`/api/admin/shifts?${query}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: { Accept: 'application/json' },
  }));
  if (!isAdminShiftPage(body)) {
    throw new AdminShiftApiError('The shifts response was invalid.');
  }
  return body;
}

export async function createAdminShift(input: AdminShiftInput): Promise<void> {
  const body = await postJson('/api/admin/shifts', input);
  if (!isRecord(body) || !isRecord(body.shift)
    || typeof body.shift.id !== 'string'
    || body.shift.status !== 'draft') {
    throw new AdminShiftApiError('The created shift response was invalid.');
  }
}

export async function publishAdminShift(id: string): Promise<void> {
  const body = await postJson(`/api/admin/shifts/${encodeURIComponent(id)}/publish`);
  if (!isRecord(body) || !isRecord(body.shift)
    || typeof body.shift.id !== 'string'
    || body.shift.status !== 'open') {
    throw new AdminShiftApiError('The published shift response was invalid.');
  }
}

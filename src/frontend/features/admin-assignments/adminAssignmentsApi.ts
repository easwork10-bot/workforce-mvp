import { z } from 'zod';
import { adminAssignmentPageSchema, type AssignmentStatus } from '@/shared/admin-assignments';

export class AdminAssignmentApiError extends Error {
  constructor(readonly status?: number, readonly code?: string) {
    super(code ?? 'ASSIGNMENT_REQUEST_FAILED');
    this.name = 'AdminAssignmentApiError';
  }
}

export async function fetchAdminAssignments(
  page: number,
  status?: AssignmentStatus,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (status) query.set('status', status);
  const response = await fetch(`/api/admin/assignments?${query}`, {
    credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new AdminAssignmentApiError(response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminAssignmentApiError(response.status, 'INVALID_RESPONSE');
  }
  const parsed = adminAssignmentPageSchema.safeParse(body);
  if (!parsed.success) throw new AdminAssignmentApiError(response.status, 'INVALID_RESPONSE');
  return parsed.data;
}

async function readCancellationResponse(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminAssignmentApiError(response.status, 'INVALID_RESPONSE');
  }
  if (!response.ok) {
    const error = z.object({ code: z.string().optional() }).safeParse(body);
    throw new AdminAssignmentApiError(response.status, error.success ? error.data.code : undefined);
  }
  return body;
}

export async function cancelAdminAssignment(id: string): Promise<{ replayed: boolean }> {
  const tokenBody = await readCancellationResponse(await fetch('/api/auth/csrf', {
    credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
  }));
  const token = z.object({ csrfToken: z.string().min(1) }).safeParse(tokenBody);
  if (!token.success) throw new AdminAssignmentApiError(undefined, 'INVALID_RESPONSE');
  const body = await readCancellationResponse(await fetch(`/api/admin/assignments/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', credentials: 'same-origin',
    headers: { Accept: 'application/json', 'x-csrf-token': token.data.csrfToken },
  }));
  const result = z.object({
    success: z.literal(true), code: z.literal('ASSIGNMENT_CANCELLED'), replayed: z.boolean(),
  }).safeParse(body);
  if (!result.success) throw new AdminAssignmentApiError(undefined, 'INVALID_RESPONSE');
  return result.data;
}

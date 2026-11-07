import { z } from 'zod';
import { adminApplicationPageSchema, type ApplicationStatus } from '@/shared/admin-applications';

export class AdminApplicationApiError extends Error {
  constructor(readonly status?: number, readonly code?: string) {
    super(code ?? 'APPLICATION_REQUEST_FAILED');
    this.name = 'AdminApplicationApiError';
  }
}

async function readResponse(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminApplicationApiError(response.status);
  }
  if (!response.ok) {
    const error = z.object({ code: z.string().optional() }).safeParse(body);
    throw new AdminApplicationApiError(response.status, error.success ? error.data.code : undefined);
  }
  return body;
}

export async function fetchAdminApplications(
  page: number,
  status?: ApplicationStatus,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (status) query.set('status', status);
  const body = await readResponse(await fetch(`/api/admin/applications?${query}`, {
    credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' },
  }));
  const parsed = adminApplicationPageSchema.safeParse(body);
  if (!parsed.success) throw new AdminApplicationApiError(undefined, 'INVALID_RESPONSE');
  return parsed.data;
}

export async function reviewAdminApplication(
  id: string, status: 'accepted' | 'rejected', rejectionReason?: string,
): Promise<{ replayed: boolean }> {
  const tokenBody = await readResponse(await fetch('/api/auth/csrf', {
    credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
  }));
  const token = z.object({ csrfToken: z.string().min(1) }).safeParse(tokenBody);
  if (!token.success) throw new AdminApplicationApiError(undefined, 'INVALID_RESPONSE');
  const body = await readResponse(await fetch(`/api/admin/applications/${encodeURIComponent(id)}/review`, {
    method: 'POST', credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-csrf-token': token.data.csrfToken },
    body: JSON.stringify({ status, ...(status === 'rejected' && rejectionReason ? { rejectionReason } : {}) }),
  }));
  const result = z.object({
    success: z.literal(true), code: z.literal('APPLICATION_REVIEWED'), replayed: z.boolean(),
  }).safeParse(body);
  if (!result.success) throw new AdminApplicationApiError(undefined, 'INVALID_RESPONSE');
  return result.data;
}

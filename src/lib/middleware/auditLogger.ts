import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { logAuditEvent, sanitizeAuditValues, type AuditMetadata } from '@/lib/db/queries/audit';
import { getClientIp, type AuthenticatedRequest } from './requireAuth';

type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';
type AuditValue = Record<string, unknown> | null;

export type AuditLogOptions = {
  action: AuditAction;
  entityType: string;
  entityId: (req: AuthenticatedRequest, response: NextResponse) => string | null;
  oldValues?: (req: AuthenticatedRequest, response: NextResponse) => AuditValue;
  newValues?: (req: AuthenticatedRequest, response: NextResponse) => AuditValue;
};

export function getAuditMetadata(req: NextRequest): AuditMetadata {
  return {
    ipAddress: createHash('sha256').update(getClientIp(req)).digest('hex').slice(0, 16),
    userAgent: req.headers.get('user-agent'),
  };
}

/**
 * Post-response logging is not atomic with the wrapped handler's mutation.
 * Use logAuditEvent with the business transaction when audit persistence is required.
 */
export function auditLog<T extends unknown[]>(
  handler: (req: AuthenticatedRequest, ...args: T) => Promise<NextResponse>,
  options: AuditLogOptions
) {
  return async (req: AuthenticatedRequest, ...args: T): Promise<NextResponse> => {
    const response = await handler(req, ...args);
    if (response.status < 200 || response.status >= 300) return response;

    if (!req.auth?.userId) {
      console.error('[Audit] Refusing to write audit event without authenticated actor');
      return NextResponse.json({ error: 'Authenticated actor required for audit logging' }, { status: 500 });
    }

    try {
      await logAuditEvent({
        actorId: req.auth.userId,
        action: options.action,
        entityType: options.entityType,
        entityId: options.entityId(req, response),
        oldValues: sanitizeAuditValues(options.oldValues?.(req, response) ?? null),
        newValues: sanitizeAuditValues(options.newValues?.(req, response) ?? null),
        ...getAuditMetadata(req),
      });
      return response;
    } catch (error) {
      console.error('[Audit] Failed to persist audit event after successful handler', error);
      return NextResponse.json({
        error: 'Action completed but audit record could not be saved',
      }, { status: 500 });
    }
  };
}

import 'server-only';
import { db } from '..';
import { auditLogs } from '../schema';
import { and, count, desc, eq } from 'drizzle-orm';
import type { AuditLog, NewAuditLog } from '../schema';

type AuditExecutor = Pick<typeof db, 'insert' | 'select'>;

export type AuditLogFilters = {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  page?: number;
  limit?: number;
};

export type AuditMetadata = {
  ipAddress: string | null;
  userAgent: string | null;
};

export function sanitizeAuditValues(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  const sanitize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sanitize);
    if (!entry || typeof entry !== 'object') return entry;

    return Object.fromEntries(Object.entries(entry).map(([key, nestedValue]) => [
      key,
      /password|token|cookie|secret|authorization|credential/i.test(key)
        ? '[REDACTED]'
        : sanitize(nestedValue),
    ]));
  };

  return sanitize(value);
}

export async function logAuditEvent(
  input: Omit<NewAuditLog, 'id' | 'createdAt'>,
  executor: AuditExecutor = db
): Promise<void> {
  await executor.insert(auditLogs).values({
    ...input,
    oldValues: sanitizeAuditValues(input.oldValues),
    newValues: sanitizeAuditValues(input.newValues),
  });
}

export async function getAuditLogs({
  actorId,
  entityType,
  entityId,
  page = 1,
  limit = 20,
}: AuditLogFilters = {}): Promise<{ data: AuditLog[]; total: number }> {
  const conditions = [];

  if (actorId) conditions.push(eq(auditLogs.actorId, actorId));
  if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
  if (entityId) conditions.push(eq(auditLogs.entityId, entityId));

  const whereClause = conditions.length ? and(...conditions) : undefined;
  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLogs)
    .where(whereClause);

  const data = await db
    .select()
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit)
    .offset((page - 1) * limit);

  return { data, total };
}

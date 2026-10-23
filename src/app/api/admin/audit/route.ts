import { NextRequest, NextResponse } from 'next/server';
import { getAuditLogs, sanitizeAuditValues } from '@/backend/db/queries/audit';
import { withCsrfAndAuth } from '@/backend/security/csrf';
import { auditLogQuerySchema } from '@/backend/validation/audit';

async function getAuditLogHandler(req: NextRequest): Promise<NextResponse> {
  try {
    const query = Object.fromEntries(new URL(req.url).searchParams.entries());
    const validation = auditLogQuerySchema.safeParse(query);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { actorId, entityType, entityId, page, limit } = validation.data;
    const { data, total } = await getAuditLogs({ actorId, entityType, entityId, page, limit });

    return NextResponse.json({
      logs: data.map((log) => ({
        ...log,
        oldValues: sanitizeAuditValues(log.oldValues),
        newValues: sanitizeAuditValues(log.newValues),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[Admin Audit GET] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 });
  }
}

export const GET = withCsrfAndAuth(getAuditLogHandler, ['administrator', 'supervisor']);

# Phase 5: Notifications & Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement notification API endpoints, audit logging middleware, and background job for upcoming shift reminders.

**Architecture:** Three independent subsystems — (1) Notifications API for CRUD on the existing `notifications` table, (2) Audit logging that auto-captures mutations via a wrapper pattern, (3) A lightweight background job using `node-cron` that creates reminder notifications for upcoming shifts. Each subsystem can be tested independently.

**Tech Stack:** Next.js 14 API routes, TypeScript, Drizzle ORM, Zod validation, `node-cron` for scheduled jobs, `withCsrfAndAuth` wrapper for auth+CSRF, `requireRole` for role-based access.

**Spec:** `/home/as/projects/workforce-mvp/docs/superpowers/plans/2026-10-18-workforce-mvp-migration.md` — Section 10, Phase 5

## Global Constraints

- All API routes must use `withCsrfAndAuth` wrapper with appropriate role guards
- No breaking changes to existing frontend component APIs
- RBAC roles: `administrator`, `supervisor`, `employee` — explicitly enforced at every API route
- All database access must use parameterized queries (Drizzle)
- Audit logging must be non-blocking (fire-and-forget) to avoid impacting request latency
- Notifications must be created on shift application status changes (accept/reject)

## Review Focus

1. **Authorization boundary bypass** — Notification endpoints must only return notifications for the authenticated user (unless admin); audit query endpoints must be admin/supervisor only
2. **Audit log completeness** — Every mutation (insert/update/delete) on core entities must be logged; missing audit entries create compliance gaps
3. **Background job reliability** — Reminder job must handle failures gracefully without crashing the job; must use existing notification infrastructure
4. **Notification spam** — Job must not create duplicate reminders for already-checked-in shifts; idempotency key pattern needed
5. **CSRF on mutations** — All POST/PATCH/DELETE notification endpoints must be CSRF-protected

---

## Pre-Implementation Status Matrix

| Component | Task | Status | Notes |
|-----------|------|--------|-------|
| Query: notifications | `getNotifications`, `markNotificationRead`, `deleteNotification` | ✅ Exists at `/src/lib/db/queries/notifications.ts` | Only 3 functions; missing `createNotification`, `getUnreadCount` |
| Query: audit | All audit functions | ❌ Missing | `/src/lib/db/queries/audit.ts` does not exist |
| Schema: notifications | `notifications` table | ✅ Exists in schema.ts | Uses `relatedShiftId`, `relatedApplicationId` (not `relatedIds`) |
| Schema: audit_logs | `audit_logs` table | ✅ Exists in schema.ts | Full schema ready |
| API: notifications | POST/GET/PATCH/DELETE `/api/notifications*` | ❌ Missing | No routes exist |
| Audit middleware | Auto-log mutations | ❌ Missing | No logging wrapper exists |
| Background job | Shift reminders | ❌ Missing | No `node-cron` installed, no scheduler code |
| Reminder notifications | `check_in_reminder`, `check_out_reminder` enums | ✅ In schema enum | Never used anywhere |

## File Structure

```
src/
  lib/
    db/
      queries/
        audit.ts                          # CREATE - audit log queries
      queries/
        notifications.ts                  # MODIFY - add create + count functions
    middleware/
      auditLogger.ts                      # CREATE - audit logging wrapper
    jobs/
      shiftReminders.ts                   # CREATE - background job for reminders
  app/
    api/
      notifications/
        route.ts                          # CREATE - GET list, POST create
      notifications/[id]/
        route.ts                          # CREATE - PATCH read, DELETE
      admin/
        audit/
          route.ts                        # CREATE - GET audit logs (admin/supervisor)
tests/
  integration/
    notifications.test.ts                # CREATE - notification API tests
    audit-logging.test.ts                # CREATE - audit log tests
    shift-reminders.test.ts              # CREATE - background job tests
```

## Tasks

### Task 5.1: Notification Query Functions (Expand Existing)

**Files:**
- Modify: `src/lib/db/queries/notifications.ts` — add `createNotification`, `getUnreadCount`
- Test: `tests/integration/notifications.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db`, `notifications` table from schema
- Produces: `createNotification(input: NewNotification): Promise<Notification>`, `getUnreadCount(recipientId: string): Promise<number>`, exported `markAllNotificationsRead(recipientId: string): Promise<number>`

- [ ] **Step 1: Write the failing test for createNotification**

```typescript
it('should create a notification', async () => {
  const result = await createNotification({
    recipientId: 'user-1',
    type: 'shift_created',
    title: 'New shift available',
    message: 'A new shift has been posted',
    relatedShiftId: 'shift-1',
  });
  expect(result.id).toBeDefined();
  expect(result.recipientId).toBe('user-1');
  expect(result.type).toBe('shift_created');
});
```

- [ ] **Step 2: Run test to verify it fails (function not defined)**

- [ ] **Step 3: Implement `createNotification` and `getUnreadCount` in `src/lib/db/queries/notifications.ts`**

Add two functions following the existing file's patterns (Drizzle insert/select). `createNotification` takes a `NewNotification` object and returns the inserted row. `getUnreadCount` counts notifications where `recipientId` matches and `readAt` is null.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/queries/notifications.ts tests/integration/notifications.test.ts
git commit -m "feat(notifications): add createNotification and getUnreadCount query functions"
```

### Task 5.2: Notification API Endpoints

**Files:**
- Create: `src/app/api/notifications/route.ts` — GET list, POST create
- Create: `src/app/api/notifications/[id]/route.ts` — PATCH read, DELETE
- Test: `tests/integration/notifications.test.ts` (extend)

**Interfaces:**
- Consumes: `getNotifications`, `markNotificationRead`, `deleteNotification`, `createNotification`, `getUnreadCount` from notifications queries; `withCsrfAndAuth` from csrf; `requireRole` from requireRole
- Produces: REST endpoints returning `{ data, total }` for list, `{ count }` for unread, `{ success: true }` for mutations

- [ ] **Step 1: Write failing tests for GET /api/notifications**

```typescript
it('should list notifications for authenticated employee', async () => {
  // Mock session as employee
  // GET /api/notifications
  // Expect: 200, array of notifications matching recipientId
});

it('should reject unauthenticated request', async () => {
  // GET /api/notifications with no token
  // Expect: 401
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement GET /api/notifications with `withCsrfAndAuth(handler, ['administrator', 'supervisor', 'employee'])`**

Returns paginated notifications filtered by `recipientId = userId`. Supports `?page` and `?limit` query params.

- [ ] **Step 4: Run tests to verify GET passes**

- [ ] **Step 5: Write failing tests for PATCH /api/notifications/[id] and DELETE**

```typescript
it('should mark notification as read', async () => {
  // PATCH /api/notifications/{id} with valid CSRF
  // Expect: 200, readAt set
});

it('should delete notification', async () => {
  // DELETE /api/notifications/{id} with valid CSRF
  // Expect: 200, success
});

it('should prevent employee from modifying others notifications', async () => {
  // PATCH /api/notifications/{id} where id belongs to another user
  // Expect: 403
});
```

- [ ] **Step 6: Implement PATCH and DELETE handlers in `/api/notifications/[id]/route.ts`**

Both handlers verify `recipientId === userId` before allowing modification. Use `requireCsrf` for CSRF protection since these are state-changing.

- [ ] **Step 7: Run all notification tests, verify they pass**

- [ ] **Step 8: Commit**

```bash
git add src/app/api/notifications/ tests/integration/notifications.test.ts
git commit -m "feat(notifications): add notification CRUD API endpoints"
```

### Task 5.3: Audit Log Query + Middleware

**Files:**
- Create: `src/lib/db/queries/audit.ts` — audit log queries
- Create: `src/lib/middleware/auditLogger.ts` — audit logging wrapper
- Create: `src/app/api/admin/audit/route.ts` — GET audit logs endpoint

**Interfaces:**
- Consumes: `auditLogs` table from schema, `NewAuditLog` type, `db` from `@/lib/db`
- Produces: `logAuditEvent(input: Omit<NewAuditLog, 'id' | 'createdAt'>): Promise<void>`, `getAuditLogs(filters): Promise<{data, total}>`, `auditLog()` wrapper function

- [ ] **Step 1: Write failing test for audit log creation**

```typescript
it('should log audit event for insert', async () => {
  await logAuditEvent({
    actorId: 'admin-1',
    action: 'INSERT',
    entityType: 'shifts',
    entityId: 'shift-1',
    newValues: { title: 'Test Shift' },
    ipAddress: '192.168.1.1',
    userAgent: 'test-agent',
  });
  // Verify audit log was inserted into audit_logs table
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/lib/db/queries/audit.ts`**

```typescript
export async function logAuditEvent(input: Omit<NewAuditLog, 'id' | 'createdAt'>): Promise<void>
export async function getAuditLogs({ actorId, entityType, entityId, page, limit }): Promise<{ data: AuditLog[]; total: number }>
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Write failing test for audit middleware wrapper**

```typescript
it('should log audit event when wrapping a handler', async () => {
  const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
  const wrapped = auditLog(handler, { action: 'INSERT', entityType: 'shifts' });
  // Call wrapped handler
  // Verify handler was called
  // Verify logAuditEvent was called with correct args
});
```

- [ ] **Step 6: Implement `src/lib/middleware/auditLogger.ts`**

Create `auditLog(handler, options)` higher-order function that:
1. Calls the wrapped handler
2. After successful execution, calls `logAuditEvent` with actor from auth result, IP hash from request headers, user agent from request headers

- [ ] **Step 7: Run test to verify it passes**

- [ ] **Step 8: Write failing test for GET /api/admin/audit**

```typescript
it('should list audit logs for admin', async () => {
  // Mock session as administrator
  // GET /api/admin/audit
  // Expect: 200, array of audit logs
});

it('should reject employee access to audit logs', async () => {
  // Mock session as employee
  // GET /api/admin/audit
  // Expect: 403
});
```

- [ ] **Step 9: Implement GET /api/admin/audit**

Uses `withCsrfAndAuth(handler, ['administrator', 'supervisor'])`. Supports query params for filtering by `entityType`, `actorId`. Uses `getAuditLogs` from queries.

- [ ] **Step 10: Run all audit tests, verify they pass**

- [ ] **Step 11: Commit**

```bash
git add src/lib/db/queries/audit.ts src/lib/middleware/auditLogger.ts src/app/api/admin/audit/route.ts tests/integration/audit-logging.test.ts
git commit -m "feat(audit): add audit log queries, middleware, and admin API"
```

### Task 5.4: Background Job — Shift Reminders

**Files:**
- Create: `src/lib/jobs/shiftReminders.ts` — background job with `node-cron`
- Create: `src/app/api/jobs/start/route.ts` — Optional: start job endpoint for development
- Modify: `package.json` — add `node-cron` dependency
- Test: `tests/integration/shift-reminders.test.ts`

**Interfaces:**
- Consumes: `createNotification` from notifications queries, `shifts` and `shiftAssignments` tables from schema, `db` from `@/lib/db`
- Produces: `startShiftReminderJob()`, `stopShiftReminderJob()`, `sendShiftReminders()` (testable function)

- [ ] **Step 1: Write failing test for sendShiftReminders**

```typescript
it('should create reminder notification for upcoming shifts', async () => {
  // Mock DB to return assignments for shifts starting in 24h
  // Call sendShiftReminders()
  // Verify createNotification was called with check_in_reminder type
});

it('should not create duplicate reminders for same shift', async () => {
  // Mock DB with existing notification for the shift
  // Call sendShiftReminders()
  // Verify no new notification created
});

it('should handle errors without crashing', async () => {
  // Mock DB to throw on one assignment
  // Call sendShiftReminders()
  // Verify it does not throw, continues processing
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Add `node-cron` to package.json**

- [ ] **Step 4: Implement `src/lib/jobs/shiftReminders.ts`**

```typescript
export async function sendShiftReminders(): Promise<{ sent: number; errors: number }>
export function startShiftReminderJob(cronExpression?: string): void
export function stopShiftReminderJob(): void
```

Logic:
1. Query `shift_assignments` joined with `shifts` where `shifts.start_at` is within 24 hours and status is `assigned` or `confirmed`
2. Check if a `check_in_reminder` notification already exists for that assignment+recipient (idempotency)
3. For each assignment, call `createNotification` with type `check_in_reminder`
4. Wrap each in try/catch, collect errors, never throw

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Commit**

```bash
git add package.json src/lib/jobs/shiftReminders.ts tests/integration/shift-reminders.test.ts
git commit -m "feat(jobs): add shift reminder background job with node-cron"
```

### Task 5.5: Integration — Notify on Application Status Change

**Files:**
- Modify existing application review endpoint to call `createNotification`
- Test: Extend existing tests

**Interfaces:**
- Consumes: `createNotification` from notifications queries
- Produces: Notifications sent when applications are accepted/rejected

- [ ] **Step 1: Locate the application review handler**

Read `/src/app/api/admin/applications/[id]/review/route.ts` to understand the accept/reject flow.

- [ ] **Step 2: Write failing test for notification on application accept**

```typescript
it('should create notification when application is accepted', async () => {
  // Mock all dependencies
  // Call the review handler with status 'accepted'
  // Verify createNotification was called with application_accepted type
});
```

- [ ] **Step 3: Run test to verify it fails**

- [ ] **Step 4: Add `createNotification` calls in the application review handler**

After updating application status, call `createNotification` with:
- `type: 'application_accepted'` or `'application_rejected'`
- `recipientId: application.employeeId`
- `title: 'Application Accepted'` or `'Application Rejected'`
- `message: description`
- `relatedApplicationId: application.id`

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/applications/[id]/review/route.ts
git commit -m "feat(notifications): create notification on application status change"
```

### Task 5.6: Full Phase 5 Verification

- [ ] Run full test suite: `npm run test`
- [ ] Run typecheck: `npm run typecheck`
- [ ] Run lint: `npm run lint`
- [ ] Verify all Phase 5 tests pass
- [ ] Update migration plan checklist in `docs/superpowers/plans/2026-10-18-workforce-mvp-migration.md`

---

## Implementation Notes

### Notifications Table Schema (from existing schema.ts)
```
notifications: {
  id: uuid (PK, defaultRandom)
  recipientId: uuid → profiles.id (not null, cascade)
  type: notification_type enum (not null)
    ['shift_created', 'application_received', 'application_accepted',
     'application_rejected', 'shift_updated', 'shift_cancelled',
     'upcoming_shift', 'check_in_reminder', 'check_out_reminder']
  title: text (not null)
  message: text (nullable)
  relatedShiftId: uuid → shifts.id (set null on delete)
  relatedApplicationId: uuid → shiftApplications.id (set null on delete)
  readAt: timestamp (nullable)
  createdAt: timestamp (default now)
}
```

Note: The migration plan's Section 2 mentions `notifications` table with `related_ids` field, but the actual schema (Section 4 and actual schema.ts) uses `related_shift_id` and `related_application_id` foreign keys. The plan follows the actual implementation in schema.ts.

### Audit Log Schema (from existing schema.ts)
```
audit_logs: {
  id: uuid (PK, defaultRandom)
  actorId: uuid → profiles.id (not null)
  action: text (not null) — e.g., 'INSERT', 'UPDATE', 'DELETE'
  entityType: text (not null) — e.g., 'shifts', 'shift_applications'
  entityId: uuid (nullable)
  oldValues: jsonb (nullable)
  newValues: jsonb (nullable)
  ipAddress: text (nullable)
  userAgent: text (nullable)
  createdAt: timestamp (default now)
}
```

### Existing Patterns to Follow
- API routes use `withCsrfAndAuth(handler, roles)` for combined CSRF + auth + role checking
- Query files import `db` from parent directory: `import { db } from '..'`
- Handlers in route.ts files return `NextResponse.json({ data })` for success
- All mutations on employee endpoints use `requireRole(req, ['employee'])` inside the handler body
- Error responses use `{ error: 'Dutch message' }` (i18n) with appropriate status codes
```

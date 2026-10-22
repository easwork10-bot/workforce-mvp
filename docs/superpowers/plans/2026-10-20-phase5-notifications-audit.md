# Phase 5: Notifications & Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement notification API endpoints, audit logging middleware, and background job for upcoming shift reminders.

**Architecture:** Notification queries and APIs enforce recipient ownership and event idempotency; core business mutations write audit events in the same transaction; an opt-in in-process Node scheduler creates bounded, idempotent shift reminders and records them as system audit events.

**Tech Stack:** Next.js 14 API routes and Node instrumentation, TypeScript, Drizzle ORM, Zod validation, `withCsrfAndAuth`/CSRF and role guards. The reminder scheduler uses native timers rather than `node-cron`.

**Spec:** [2026-10-18-workforce-mvp-migration.md](./2026-10-18-workforce-mvp-migration.md) — Section 10, Phase 5

## Global Constraints

- All API routes must use `withCsrfAndAuth` wrapper with appropriate role guards
- No breaking changes to existing frontend component APIs
- RBAC roles: `administrator`, `supervisor`, `employee` — explicitly enforced at every API route
- All database access must use parameterized queries (Drizzle)
- For business mutations requiring an audit trail, write the audit event through the same database transaction and await it; do not use post-response fire-and-forget logging for these operations. The generic wrapper remains available only where its post-mutation failure semantics are acceptable.
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

**Status (2026-10-21; reverified 2026-10-22): Complete for the local test environment.** The query/idempotency implementation is in place; migrations 0001 and 0002 are applied to local `workforce_test` only. The old resource-tuple indexes are retired there, while the nullable event-key fields, paired-nullability CHECK, and partial recipient/key index remain. The Task 5.6 verification found all four current journal entries (0000–0003) in the local ledger, plus a retained legacy ledger row corresponding to `0000_melodic_spectrum.sql`, which is not in the current journal; no history was changed. No development (`workforce`) or production database was migrated.

For this phase, this detailed plan is authoritative: Task 5.2 is the notification API. The older `2026-10-18-workforce-mvp-migration.md` uses different numbering (notification CRUD is Task 5.1 and audit middleware is Task 5.2); its Phase 5 tasks are not being renumbered here.

**Files:**
- Modify: `src/lib/db/queries/notifications.ts` — add `createNotification`, `getUnreadCount`
- Test: `tests/integration/notifications.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db`, `notifications` table from schema
- Produces: `createNotification(input: NewNotification): Promise<Notification>`, `getUnreadCount(recipientId: string): Promise<number>`, exported `markAllNotificationsRead(recipientId: string): Promise<number>`

- [x] **Step 1: Write the failing test for createNotification**

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

- [x] **Step 2: Run test to verify it fails (function not defined)**

- [x] **Step 3: Implement `createNotification` and `getUnreadCount` in `src/lib/db/queries/notifications.ts`**

Add two functions following the existing file's patterns (Drizzle insert/select). `createNotification` takes a `NewNotification` object and returns the inserted row. `getUnreadCount` counts notifications where `recipientId` matches and `readAt` is null.

- [x] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit** — intentionally not done; commits require separate owner authorization.

```bash
git add src/lib/db/queries/notifications.ts tests/integration/notifications.test.ts
git commit -m "feat(notifications): add createNotification and getUnreadCount query functions"
```

### Task 5.2: Notification API Endpoints

**Status (2026-10-21): Implemented and verified.** `GET` lists only the authenticated user's notifications. `PATCH` accepts only `{ "read": true }`; `DELETE` dismisses only an owned notification. These writes require CSRF, reject malformed IDs/payloads, and return 404 for missing or non-owned IDs. Public `POST` is authenticated and CSRF-protected but intentionally returns 405: only trusted server workflows may create business-event notifications. Internal idempotency fields are omitted from responses. Full suite on local `workforce_test`: 117 passed, 0 failed, 0 skipped; typecheck, lint, build, and diff check passed. No development or production database was migrated.

**Security contract:** all roles may access only their own notifications. `GET` supports `type`, `isRead=true|false|all`, `page`, and `limit` (maximum 100). `PATCH` accepts only `{ "read": true }`; `DELETE` dismisses only an owned notification. Both mutations require CSRF and return 404 for absent or non-owned IDs. Public `POST` is intentionally disabled (405): business-event notifications may only be created by trusted server-side workflows, so clients cannot choose recipients, content, or idempotency keys.

**Files:**
- Create: `src/app/api/notifications/route.ts` — GET list; POST explicitly disabled
- Create: `src/app/api/notifications/[id]/route.ts` — PATCH read, DELETE
- Test: `tests/integration/notification-api.test.ts`

**Interfaces:**
- Consumes: `getNotifications`, recipient-scoped mark-read/dismiss queries; `withCsrfAndAuth` from csrf; `requireRole` from requireRole
- Produces: `{ data, total, page, limit, totalPages }` for list and `{ success: true }` for mark-read/dismiss. POST returns 405 and never creates a notification.

- [ ] **Step 1: Write integration tests for GET, authentication, and ownership**

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

- [ ] **Step 5: Write integration tests for PATCH /api/notifications/[id], DELETE, and CSRF**

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

Both handlers scope the database mutation by `recipientId = authenticated userId`; non-owned IDs return the same 404 as missing IDs. Use `withCsrfAndAuth` for CSRF and role checks.

- [ ] **Step 7: Run all notification tests, verify they pass**

- [ ] **Step 8: Commit** — requires separate owner authorization.

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
- Produces: `logAuditEvent(input, executor?)` (optional transaction executor), `getAuditLogs(filters): Promise<{data, total}>`, `auditLog()` wrapper function

- [x] **Step 1: Write failing test for audit log creation**

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

- [x] **Step 2: Run test to verify it fails**

- [x] **Step 3: Implement `src/lib/db/queries/audit.ts`**

```typescript
export async function logAuditEvent(input: Omit<NewAuditLog, 'id' | 'createdAt'>): Promise<void>
export async function getAuditLogs({ actorId, entityType, entityId, page, limit }): Promise<{ data: AuditLog[]; total: number }>
```

- [x] **Step 4: Run test to verify it passes**

- [x] **Step 5: Write failing test for audit middleware wrapper**

```typescript
it('should log audit event when wrapping a handler', async () => {
  const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
  const wrapped = auditLog(handler, { action: 'INSERT', entityType: 'shifts' });
  // Call wrapped handler
  // Verify handler was called
  // Verify logAuditEvent was called with correct args
});
```

- [x] **Step 6: Implement `src/lib/middleware/auditLogger.ts`**

Create `auditLog(handler, options)` higher-order function that:
1. Calls the wrapped handler
2. After successful execution, calls `logAuditEvent` with actor from auth result, IP hash from request headers, user agent from request headers

- [x] **Step 7: Run test to verify it passes**

- [x] **Step 8: Write failing test for GET /api/admin/audit**

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

- [x] **Step 9: Implement GET /api/admin/audit**

Uses `withCsrfAndAuth(handler, ['administrator', 'supervisor'])`. Supports query params for filtering by `entityType`, `actorId`. Uses `getAuditLogs` from queries.

- [x] **Step 10: Run all audit tests, verify they pass**

**Completion evidence (2026-10-21):** Audit capability, restricted read API, and transactional integration are implemented. Audited workflows include self-registration (profile and role), shift creation/update/deletion (including logged related-row cleanup), employee profile/role/details updates, shift applications and decisions (including assignment and notification side effects), attendance check-in/out and assignment confirmation, and notification creation/read/dismissal where an authenticated actor is available. Application-decision replays and repeated notification-read requests do not create duplicate events. Sensitive field values, rejection reasons, notification bodies, shift descriptions/compensation, and attendance coordinates are excluded from snapshots; API client IPs are hashed and user-agent is retained. The audit endpoint allows administrators/supervisors only and validates, filters, paginates, orders, and sanitizes results. Audit inserts for these workflows share the business transaction. The generic post-handler wrapper remains non-atomic: on audit failure it returns an explicit 500 although a wrapped mutation may already have completed, so it is not used for these transactional workflows. Focused impacted integration tests passed (107); the full suite on local `workforce_test` passed (139 tests, 0 failed, 0 skipped); typecheck, lint, production build, and `git diff --check` passed. All nine integration fixture tables were empty afterward. No schema migration or database change was made for this integration task.

- [ ] **Step 11: Commit** — not authorized; no commit created.

```bash
git add src/lib/db/queries/audit.ts src/lib/middleware/auditLogger.ts src/app/api/admin/audit/route.ts tests/integration/audit-logging.test.ts
git commit -m "feat(audit): add audit log queries, middleware, and admin API"
```

### Task 5.4: Background Job — Shift Reminders

**Status (2026-10-22): Locally implemented and verified for the long-running Docker/Node topology.** Scheduler startup requires production Node runtime and `SHIFT_REMINDER_JOB_ENABLED=true`. Reminders are best-effort: a process restart at/after due skips the occurrence; a running process dispatches/retries only within 60 seconds after due. See the reliability review below for the verified restart, retry, audit, deployment, and test outcomes. No deployment or commit was performed.

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

**Completion evidence (2026-10-22):** Implemented `src/lib/jobs/shiftReminders.ts` as a restart-safe in-process scheduler (no `node-cron`) with `startShiftReminderJob()`, `stopShiftReminderJob()`, `getUpcomingShiftReminderOccurrences()`, and `sendShiftReminders()`. The selector includes only `assigned`/`confirmed` assignments whose shift starts in `(now+24h, now+48h]`, excluding cancelled shifts. Execution sends only when due (`startAt - 24h <= now`) and skips late occurrences. Each reminder revalidates current shift and assignment state inside a transaction and uses the stable idempotency key `shift-reminder:check-in:v1:<assignmentId>:<shiftStartAtISO>` via `createNotificationIdempotent`, preventing duplicates across retries/concurrency and preserving one reminder per occurrence. System-generated notification inserts are audited transactionally with truthful actor attribution (`actor_type='system'`, `actor_id=NULL`).

Added explicit audit actor modeling for system events by making `audit_logs.actor_id` nullable and adding `audit_logs.actor_type` (`user`/`system`) with constraint `audit_logs_actor_type_ck`; migration file: `drizzle/0003_damp_unus.sql`. Existing user-originated writes continue as `actor_type='user'` with non-null actor IDs.

Startup wiring is implemented through Next instrumentation (`src/instrumentation.ts` and `src/instrumentation-node.ts`) so the reminder loop starts only in the Node runtime and stops on `SIGTERM`/`SIGINT`.

Integration coverage added in `tests/integration/shift-reminders.test.ts` for eligibility/ineligibility, 24h boundary behavior, duplicate/concurrent execution, cancellation, shift start-time changes, idempotency-key stability, and transactional rollback on audit failure.

**Reliability review (2026-10-22):** Confirmed the deployment target in this repository is the long-running Node process started by the standalone Docker image (`node server.js`); the worker is enabled only in production when `SHIFT_REMINDER_JOB_ENABLED=true`, and `src/instrumentation.ts` excludes non-Node runtimes and the production-build phase. The repository contains no serverless deployment configuration; serverless hosting is unsupported for this in-process timer, and would require a separate long-running worker service using the same image (not deployed here). On startup/restart, pending occurrences are reconstructed from the database; due or past occurrences are not replayed. An active-process timer may dispatch up to 60 seconds after its due instant to tolerate timer/event-loop delay; it is then considered missed. Transient write/audit failures retry every 5 seconds only within that bounded window. Refresh reconciliation preserves due timers across the exact-boundary 60-second refresh, and shift/assignment state is revalidated under row locks before writing. Notification and system audit inserts are in one transaction; idempotent conflicts create no second audit entry. Shutdown clears refresh and pending timers; any in-flight database transaction is not forcibly cancelled.

### Task 5.5: Integration — Notify on Application Status Change

**Status (2026-10-22): Complete and verified locally.** The dynamic `POST /api/admin/applications/[id]/review` endpoint validates its UUID and strict request body, enforces CSRF and administrator-only authorization, and delegates to the existing transactional `reviewApplication()` query. The collection route retains `GET` and no longer exports the misplaced POST. Route integration coverage imports the handler from its dynamic filesystem path and verifies decisions, notification recipient/type/application reference, replay/conflict, authorization, CSRF, validation, rollback, and capacity behavior. `npm run build` generated `/api/admin/applications/[id]/review` in the Next.js route table. Focused route/application tests passed (52 tests); the full suite passed (155 tests, 0 failures, 0 skips) against identity-asserted local `workforce_test`; typecheck, lint, build and `git diff --check` passed. No migration, commit, push, or deployment was performed.

**Files:**
- Modify existing application review endpoint to call `createNotification`
- Test: Extend existing tests

**Interfaces:**
- Consumes: `createNotification` from notifications queries
- Produces: Notifications sent when applications are accepted/rejected

- [x] **Step 1: Locate the application review handler**

Read `/src/app/api/admin/applications/[id]/review/route.ts` to understand the accept/reject flow.

- [x] **Step 2: Write failing test for notification on application accept**

```typescript
it('should create notification when application is accepted', async () => {
  // Mock all dependencies
  // Call the review handler with status 'accepted'
  // Verify createNotification was called with application_accepted type
});
```

- [x] **Step 3: Run test to verify it fails**

- [x] **Step 4: Wire the dynamic review route to existing transactional notification behavior**

After updating application status, call `createNotification` with:
- `type: 'application_accepted'` or `'application_rejected'`
- `recipientId: application.employeeId`
- `title: 'Application Accepted'` or `'Application Rejected'`
- `message: description`
- `relatedApplicationId: application.id`

- [x] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Commit** — intentionally not done; commits require separate owner authorization.

```bash
git add src/app/api/admin/applications/[id]/review/route.ts
git commit -m "feat(notifications): create notification on application status change"
```

### Task 5.6: Full Phase 5 Verification

**Status (2026-10-22): Complete for local Phase 5 verification only; not a deployment approval.** The database identity was asserted as local `workforce_test`. Its ledger contains all four current journaled migrations (0000–0003) and one retained legacy entry for `0000_melodic_spectrum.sql`; the latter is absent from the current journal and was left untouched. The idempotency columns, paired-nullability constraint, partial unique index, system-audit actor columns, and actor constraint were verified. Focused cross-feature tests passed (114 tests across 8 files); the full suite passed (155 tests across 11 files, 0 failures, 0 skips). Typecheck, lint, production build, and `git diff --check` passed. All 9 public integration-fixture tables were empty after tests. A loopback production-server smoke test reached `POST /api/admin/applications/not-a-uuid/review` with valid CSRF and received the expected `400 Invalid application ID`, without authentication or database mutation. The historical roadmap now has an explicit task crosswalk. No commit, push, deployment, `workforce` change, or production access occurred. This evidence is local-only and does not establish release readiness.

- [x] Assert local `workforce_test` identity; verify current migrations 0000–0003 and expected notification/audit schema without running migrations
- [x] Run focused cross-feature tests (114 passed across 8 files)
- [x] Run full test suite (155 passed, 0 failed, 0 skipped across 11 files)
- [x] Run typecheck, lint, production build, and `git diff --check`
- [x] Confirm all 9 integration fixture tables are empty
- [x] Smoke-test the dynamic review endpoint over loopback HTTP
- [x] Reconcile the historical migration-roadmap checklist using an explicit crosswalk

Local Phase 5 verification is complete. Production readiness remains unverified; do not infer it from these checks. Git commit steps listed under individual tasks remain intentionally undone and require separate owner authorization.

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

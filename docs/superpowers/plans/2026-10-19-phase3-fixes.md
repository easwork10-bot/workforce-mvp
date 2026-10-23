# Phase 3 Critical/High Fixes Implementation Plan

> **Historical plan:** This dated plan is retained as an implementation and decision
> record; its task references and status are not a statement of current completion.
> Consult the current [README](../../../README.md) and
> [architecture](../../../ARCHITECTURE.md) for verified behavior. The original plan
> follows unchanged.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 Critical/High severity issues in Phase 3 employee APIs: shift browsing filter, Redis lock scoping, lock TTL, Redis fail-open behavior, and shift capacity enforcement.

**Architecture:** Targeted fixes to existing query functions in `src/lib/db/queries/` — shifts, applications, and attendance modules. No API route changes required; fixes are in reusable query layer.

**Tech Stack:** Next.js 14, TypeScript, Drizzle ORM, PostgreSQL, Redis (ioredis/redis v4), Zod

**Spec:** Verification report (this conversation) + migration plan `docs/superpowers/plans/2026-10-18-workforce-mvp-migration.md`

## Global Constraints

- No Supabase client packages in production bundle
- Next.js 14 App Router with TypeScript strict mode
- i18n: Dutch (nl) LTR + Arabic (ar) RTL via next-intl
- RBAC roles: `administrator`, `supervisor`, `employee` — enforced at every API route
- All database access via Drizzle ORM parameterized queries
- Redis for sessions, rate limiting, locks, verification state
- Preserve existing API contracts and response structures
- No breaking changes to frontend component APIs

## Review Focus

1. **Race condition on shift applications** — Concurrent applications must not exceed capacity or create duplicates; Redis lock + DB unique index + transaction
2. **Authorization boundary bypass** — Employee endpoints must never expose or modify another employee's records
3. **Redis unavailability handling** — Fail-safe behavior must not silently create inconsistent state
4. **Business rule enforcement** — Shift capacity (`requiredWorkers`) and application status transitions must be validated
5. **Time-window validation (deferred to Phase 4)** — Attendance check-in/out time windows are Phase 4 scope per migration plan; do not implement here

---

### Task 1: Fix Shift Browsing Filter (Critical — Finding #1)

**Files:**
- Modify: `src/lib/db/queries/shifts.ts:247-259`
- Test: `tests/integration/shifts.test.ts` (new)

**Interfaces:**
- Consumes: `getAvailableShiftsForEmployee({ employeeId, workType?, startFrom?, startTo?, page?, limit? })`
- Produces: Same signature; filters exclude only `pending`/`accepted` applications, not `rejected`/`cancelled`

- [ ] **Step 1: Write failing test**

```typescript
// tests/integration/shifts.test.ts
import { getAvailableShiftsForEmployee } from '@/lib/db/queries/shifts';
import { db } from '@/lib/db';
import { shifts, shiftApplications, profiles } from '@/lib/db/schema';

test('Employee can see shift after rejection', async () => {
  // Setup: create employee, shift, rejected application
  const [emp] = await db.insert(profiles).values({ fullName: 'Test', email: 'test@test.com' }).returning();
  const [shift] = await db.insert(shifts).values({ 
    title: 'Test Shift', workType: 'cleaning', location: 'Amsterdam', 
    startAt: new Date('2099-01-01'), endAt: new Date('2099-01-02'), 
    requiredWorkers: 1, createdBy: emp.id, status: 'open' 
  }).returning();
  await db.insert(shiftApplications).values({ shiftId: shift.id, employeeId: emp.id, status: 'rejected' });

  // Query available shifts
  const result = await getAvailableShiftsForEmployee({ employeeId: emp.id });
  
  // Should see the shift (rejected apps don't block)
  expect(result.data.some(s => s.id === shift.id)).toBe(true);
});

test('Employee cannot see shift with pending application', async () => {
  const [emp] = await db.insert(profiles).values({ fullName: 'Test2', email: 'test2@test.com' }).returning();
  const [shift] = await db.insert(shifts).values({ 
    title: 'Test Shift 2', workType: 'cleaning', location: 'Amsterdam', 
    startAt: new Date('2099-01-01'), endAt: new Date('2099-01-02'), 
    requiredWorkers: 1, createdBy: emp.id, status: 'open' 
  }).returning();
  await db.insert(shiftApplications).values({ shiftId: shift.id, employeeId: emp.id, status: 'pending' });

  const result = await getAvailableShiftsForEmployee({ employeeId: emp.id });
  expect(result.data.some(s => s.id === shift.id)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/shifts.test.ts` (or jest equivalent)
Expected: FAIL — current query excludes all application statuses

- [ ] **Step 3: Implement fix in `src/lib/db/queries/shifts.ts:247-259`**

Change the `appliedShiftIds` subquery to filter by status:
```typescript
const appliedShiftIds = db
  .select({ shiftId: shiftApplications.shiftId })
  .from(shiftApplications)
  .where(and(
    eq(shiftApplications.employeeId, employeeId),
    inArray(shiftApplications.status, ['pending', 'accepted']) // only block active apps
  ));
```

Also fix `assignedShiftIds` to only exclude active assignments (`assigned`, `confirmed`):
```typescript
const assignedShiftIds = db
  .select({ shiftId: shiftAssignments.shiftId })
  .from(shiftAssignments)
  .where(and(
    eq(shiftAssignments.employeeId, employeeId),
    inArray(shiftAssignments.status, ['assigned', 'confirmed'])
  ));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/shifts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/integration/shifts.test.ts src/lib/db/queries/shifts.ts
git commit -m "fix: shift browsing excludes only active (pending/accepted) applications"
```

---

### Task 2: Fix Redis Lock Scoping (High — Finding #2)

**Files:**
- Modify: `src/lib/db/queries/applications.ts:172-173`
- Test: `tests/integration/applications.test.ts` (new)

**Interfaces:**
- Consumes: `applyForShiftWithLock(shiftId: string, employeeId: string)`
- Produces: Same; lock key now includes `employeeId`

- [ ] **Step 1: Write failing test**

```typescript
// tests/integration/applications.test.ts
import { applyForShiftWithLock } from '@/lib/db/queries/applications';
import { db } from '@/lib/db';
import { shifts, shiftApplications, profiles } from '@/lib/db/schema';

test('Concurrent applications from different users do not block each other', async () => {
  const [emp1] = await db.insert(profiles).values({ fullName: 'Emp1', email: 'emp1@test.com' }).returning();
  const [emp2] = await db.insert(profiles).values({ fullName: 'Emp2', email: 'emp2@test.com' }).returning();
  const [shift] = await db.insert(shifts).values({ 
    title: 'Concurrent Shift', workType: 'cleaning', location: 'Amsterdam', 
    startAt: new Date('2099-01-01'), endAt: new Date('2099-01-02'), 
    requiredWorkers: 2, createdBy: emp1.id, status: 'open' 
  }).returning();

  // Simulate concurrent applications
  const [r1, r2] = await Promise.all([
    applyForShiftWithLock(shift.id, emp1.id),
    applyForShiftWithLock(shift.id, emp2.id),
  ]);

  // Both should succeed (different users, different lock keys)
  expect(r1.success).toBe(true);
  expect(r2.success).toBe(true);
  
  // Verify both applications exist
  const apps = await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, shift.id));
  expect(apps.length).toBe(2);
});

test('Duplicate application from same user is rejected', async () => {
  const [emp] = await db.insert(profiles).values({ fullName: 'Emp3', email: 'emp3@test.com' }).returning();
  const [shift] = await db.insert(shifts).values({ 
    title: 'Duplicate Shift', workType: 'cleaning', location: 'Amsterdam', 
    startAt: new Date('2099-01-01'), endAt: new Date('2099-01-02'), 
    requiredWorkers: 1, createdBy: emp.id, status: 'open' 
  }).returning();

  const r1 = await applyForShiftWithLock(shift.id, emp.id);
  const r2 = await applyForShiftWithLock(shift.id, emp.id);
  
  expect(r1.success).toBe(true);
  expect(r2.success).toBe(false);
  expect(r2.message).toContain('al gesolliciteerd');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/applications.test.ts`
Expected: FAIL — current lock key blocks all users

- [ ] **Step 3: Implement fix in `src/lib/db/queries/applications.ts:172-173`**

```typescript
const lockKey = `lock:shift:${shiftId}:apply:${employeeId}`;
const lockVal = `${employeeId}:${Date.now()}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/applications.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/integration/applications.test.ts src/lib/db/queries/applications.ts
git commit -m "fix: Redis lock scoped per-user to allow concurrent applications"
```

---

### Task 3: Increase Lock TTL and Add Safety Margin (High — Finding #3)

**Files:**
- Modify: `src/lib/db/queries/applications.ts:178`
- Test: Covered by Task 2 test (longer TTL prevents expiry during test)

**Interfaces:**
- Consumes: `applyForShiftWithLock` lock acquisition
- Produces: Lock TTL increased from 5s to 15s

- [ ] **Step 1: Implement fix**

```typescript
// Change PX from 5000 to 15000 (15 seconds)
const acquired = await redis.set(lockKey, lockVal, { NX: true, PX: 15000 });
```

- [ ] **Step 2: Verify with existing tests**

Run: `npx vitest run tests/integration/applications.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/queries/applications.ts
git commit -m "fix: increase Redis lock TTL to 15s for transaction safety margin"
```

---

### Task 4: Redis Fail-Closed Behavior (High — Finding #4)

**Files:**
- Modify: `src/lib/db/queries/applications.ts:182-185`
- Test: `tests/integration/applications.test.ts` (extend)

**Interfaces:**
- Consumes: `applyForShiftWithLock` Redis error handling
- Produces: On Redis failure, reject with 503 instead of proceeding without lock

- [ ] **Step 1: Write failing test**

```typescript
// tests/integration/applications.test.ts (add to existing file)
import { getRedis, RedisUnavailableError } from '@/lib/auth/session';

test('Redis unavailability returns 503 (fail-closed)', async () => {
  const [emp] = await db.insert(profiles).values({ fullName: 'Emp4', email: 'emp4@test.com' }).returning();
  const [shift] = await db.insert(shifts).values({ 
    title: 'FailClosed Shift', workType: 'cleaning', location: 'Amsterdam', 
    startAt: new Date('2099-01-01'), endAt: new Date('2099-01-02'), 
    requiredWorkers: 1, createdBy: emp.id, status: 'open' 
  }).returning();

  // Mock Redis to throw
  const originalGetRedis = getRedis;
  jest.mock('@/lib/auth/session', () => ({
    ...jest.requireActual('@/lib/auth/session'),
    getRedis: () => Promise.reject(new RedisUnavailableError('Redis down')),
  }));

  const result = await applyForShiftWithLock(shift.id, emp.id);
  
  // Should fail-closed (reject), not proceed without lock
  expect(result.success).toBe(false);
  expect(result.message).toContain('tijdelijk onbeschikbaar'); // or similar
  
  // Restore
  jest.restoreAllMocks();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/applications.test.ts`
Expected: FAIL — current code proceeds without lock (fail-open)

- [ ] **Step 3: Implement fix in `src/lib/db/queries/applications.ts:182-185`**

```typescript
} catch (err) {
  // Fail-closed: if Redis unavailable, reject request
  // (Alternative: could queue in DB with FOR UPDATE SKIP LOCKED, but reject is safer)
  console.error('[applyForShiftWithLock] Redis unavailable, failing closed');
  return { 
    success: false, 
    message: 'Sollicitatieservice tijdelijk onbeschikbaar, probeer later opnieuw' 
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/applications.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/integration/applications.test.ts src/lib/db/queries/applications.ts
git commit -m "fix: Redis lock failure fails closed (rejects) instead of proceeding without lock"
```

---

### Task 5: Enforce Shift Capacity in Application (High — Finding #5)

**Files:**
- Modify: `src/lib/db/queries/applications.ts:191-203` (inside transaction)
- Test: `tests/integration/applications.test.ts` (extend)

**Interfaces:**
- Consumes: `applyForShiftWithLock` transaction
- Produces: Rejects application if `assignedCount >= requiredWorkers`

- [ ] **Step 1: Write failing test**

```typescript
// tests/integration/applications.test.ts (add to existing file)
import { shiftAssignments } from '@/lib/db/schema';

test('Application rejected when shift at capacity', async () => {
  const [emp1] = await db.insert(profiles).values({ fullName: 'Emp5', email: 'emp5@test.com' }).returning();
  const [emp2] = await db.insert(profiles).values({ fullName: 'Emp6', email: 'emp6@test.com' }).returning();
  const [shift] = await db.insert(shifts).values({ 
    title: 'Full Shift', workType: 'cleaning', location: 'Amsterdam', 
    startAt: new Date('2099-01-01'), endAt: new Date('2099-01-02'), 
    requiredWorkers: 1, createdBy: emp1.id, status: 'open' 
  }).returning();

  // Fill the shift via assignment
  await db.insert(shiftAssignments).values({ 
    shiftId: shift.id, employeeId: emp1.id, status: 'assigned', assignedBy: emp1.id 
  });

  // Second employee tries to apply
  const result = await applyForShiftWithLock(shift.id, emp2.id);
  
  expect(result.success).toBe(false);
  expect(result.message).toContain('vol'); // Dutch for "full"
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/applications.test.ts`
Expected: FAIL — no capacity check exists

- [ ] **Step 3: Implement fix in `src/lib/db/queries/applications.ts` (inside transaction, after shift status check)**

```typescript
// Add after shift status check (around line 202)
const [{ assignedCount }] = await tx
  .select({ assignedCount: count() })
  .from(shiftAssignments)
  .where(eq(shiftAssignments.shiftId, shiftId));

if (assignedCount >= shift.requiredWorkers) {
  return { success: false, message: 'Dienst is vol' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/applications.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/integration/applications.test.ts src/lib/db/queries/applications.ts
git commit -m "fix: enforce shift capacity (requiredWorkers) in application API"
```

---

### Task 6: Fix Shift Detail Access for Non-Open Shifts (Low — Finding #10)

**Files:**
- Modify: `src/lib/db/queries/shifts.ts:334-337`
- Test: `tests/integration/shifts.test.ts` (extend)

**Interfaces:**
- Consumes: `getShiftDetailsForEmployee(shiftId: string, employeeId: string)`
- Produces: Returns shift details if employee has application/assignment, regardless of shift status

- [ ] **Step 1: Write failing test**

```typescript
// tests/integration/shifts.test.ts (add to existing file)

test('Employee can view filled shift they applied to', async () => {
  const [emp] = await db.insert(profiles).values({ fullName: 'Emp7', email: 'emp7@test.com' }).returning();
  const [shift] = await db.insert(shifts).values({ 
    title: 'Filled Shift', workType: 'cleaning', location: 'Amsterdam', 
    startAt: new Date('2099-01-01'), endAt: new Date('2099-01-02'), 
    requiredWorkers: 1, createdBy: emp.id, status: 'filled' 
  }).returning();
  await db.insert(shiftApplications).values({ shiftId: shift.id, employeeId: emp.id, status: 'accepted' });

  const result = await getShiftDetailsForEmployee(shift.id, emp.id);
  
  expect(result).not.toBeNull();
  expect(result!.applicationStatus).toBe('accepted');
});

test('Employee cannot view filled shift they did not apply to', async () => {
  const [emp1] = await db.insert(profiles).values({ fullName: 'Emp8', email: 'emp8@test.com' }).returning();
  const [emp2] = await db.insert(profiles).values({ fullName: 'Emp9', email: 'emp9@test.com' }).returning();
  const [shift] = await db.insert(shifts).values({ 
    title: 'Filled Shift 2', workType: 'cleaning', location: 'Amsterdam', 
    startAt: new Date('2099-01-01'), endAt: new Date('2099-01-02'), 
    requiredWorkers: 1, createdBy: emp1.id, status: 'filled' 
  }).returning();

  const result = await getShiftDetailsForEmployee(shift.id, emp2.id);
  
  expect(result).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/shifts.test.ts`
Expected: FAIL — current code returns null for non-open shifts

- [ ] **Step 3: Implement fix in `src/lib/db/queries/shifts.ts:334-337`**

Replace the early return with ownership check:
```typescript
// Check if employee has access (application or assignment) before rejecting non-open shifts
const [hasApplication] = await db
  .select({ id: shiftApplications.id })
  .from(shiftApplications)
  .where(and(
    eq(shiftApplications.shiftId, shiftId),
    eq(shiftApplications.employeeId, employeeId)
  ))
  .limit(1);

const [hasAssignment] = await db
  .select({ id: shiftAssignments.id })
  .from(shiftAssignments)
  .where(and(
    eq(shiftAssignments.shiftId, shiftId),
    eq(shiftAssignments.employeeId, employeeId)
  ))
  .limit(1);

if (!hasApplication && !hasAssignment && shift.status !== 'open') {
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/shifts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/integration/shifts.test.ts src/lib/db/queries/shifts.ts
git commit -m "fix: allow employee shift detail access for their applications/assignments on non-open shifts"
```

---

### Task 7: Make GPS Coordinates Optional (Low — Finding #9)

**Files:**
- Modify: `src/lib/validators/attendance.ts:4-15`
- Modify: `src/lib/db/queries/attendance.ts:188-192, 254-260` (handle null coordinates)
- Test: `tests/integration/attendance.test.ts` (new)

**Interfaces:**
- Consumes: `checkInSchema`, `checkOutSchema`, `employeeCheckIn`, `employeeCheckOut`
- Produces: Coordinates optional in validation; null handled in DB inserts

- [ ] **Step 1: Write failing test**

```typescript
// tests/integration/attendance.test.ts
import { employeeCheckIn, employeeCheckOut } from '@/lib/db/queries/attendance';
import { db } from '@/lib/db';
import { shifts, shiftAssignments, profiles, attendanceRecords } from '@/lib/db/schema';

test('Check-in works without GPS coordinates', async () => {
  const [emp] = await db.insert(profiles).values({ fullName: 'Emp10', email: 'emp10@test.com' }).returning();
  const [shift] = await db.insert(shifts).values({ 
    title: 'No GPS Shift', workType: 'cleaning', location: 'Amsterdam', 
    startAt: new Date('2099-01-01'), endAt: new Date('2099-01-02'), 
    requiredWorkers: 1, createdBy: emp.id, status: 'open' 
  }).returning();
  const [assignment] = await db.insert(shiftAssignments).values({ 
    shiftId: shift.id, employeeId: emp.id, status: 'assigned', assignedBy: emp.id 
  }).returning();

  // Check in without lat/long
  const result = await employeeCheckIn(emp.id, assignment.id, 0, 0); // pass 0,0 but schema should allow null
  
  expect(result.success).toBe(true);
  
  // Verify record has null coordinates
  const [record] = await db.select().from(attendanceRecords).where(eq(attendanceRecords.shiftAssignmentId, assignment.id));
  expect(record.checkInLatitude).toBeNull();
  expect(record.checkInLongitude).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/attendance.test.ts`
Expected: FAIL — Zod schema requires coordinates

- [ ] **Step 3: Implement fix in `src/lib/validators/attendance.ts`**

```typescript
export const checkInSchema = z.object({
  shiftAssignmentId: z.string().uuid('Invalid shift assignment ID'),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

export const checkOutSchema = z.object({
  shiftAssignmentId: z.string().uuid('Invalid shift assignment ID'),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});
```

- [ ] **Step 4: Update attendance queries to handle null**

In `employeeCheckIn` and `employeeCheckOut`, change:
```typescript
checkInLatitude: latitude != null ? latitude.toString() : null,
checkInLongitude: longitude != null ? longitude.toString() : null,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/attendance.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/integration/attendance.test.ts src/lib/validators/attendance.ts src/lib/db/queries/attendance.ts
git commit -m "fix: make GPS coordinates optional in attendance check-in/out"
```

---

### Task 8: Run Full Verification Suite

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```
Expected: ✅ Pass

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Expected: ✅ Pass

- [ ] **Step 3: Run build**

```bash
npm run build
```
Expected: ✅ Pass

- [ ] **Step 4: Run all new integration tests**

```bash
npx vitest run tests/integration/
```
Expected: ✅ All pass

- [ ] **Step 5: Commit verification**

```bash
git commit --allow-empty -m "verify: all Phase 3 Critical/High fixes pass typecheck, lint, build, and integration tests"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** All 5 Critical/High findings addressed (Findings #1-5)
- [ ] **Step scan:** Each step has single checkable result; no "handle edge cases" lines
- [ ] **Type consistency:** Function signatures unchanged; only internal logic modified
- [ ] **Review focus:** Each finding maps to a task with specific test
- [ ] **Proportion:** Plan is concise; code blocks only for algorithmic decisions (lock key, TTL, capacity check)

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-10-19-phase3-fixes.md`. Please review the plan. Which execution approach would you prefer?**

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** - I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end. Runs well with a mid-tier session model, since the plan carries the design.

**For this plan I recommend Subagent-driven**, because the tasks involve concurrent/race condition testing (Tasks 2, 4) which benefit from independent verification, and the fixes touch security-critical paths where independent review adds confidence. Does the plan capture what you want, and which approach should we use?
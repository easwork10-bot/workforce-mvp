# Workforce MVP Migration Plan

> **For agentic workers:** This plan uses native phased implementation (not subagent-driven) due to constrained provider capacity. Each phase ends with targeted verification before proceeding to the next. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Workforce MVP from Supabase (PostgreSQL + Auth + RLS) to a self-hosted architecture with Next.js API routes, Redis for sessions/locks/rate-limiting/verification state, and a separate PostgreSQL database — preserving all existing frontend functionality while replacing backend dependencies.

**Architecture:** Replace Supabase's managed services with self-hosted equivalents: Next.js API routes for business logic, Redis for session/refresh-token state, rate limiting, verification state, and locks; PostgreSQL for persistent data. Keep the existing Next.js 14 frontend, next-intl i18n, Radix UI components, and middleware-based routing intact. Public `/nl` and `/ar` landing pages serve as marketing/company pages; authenticated users are redirected to the protected application area.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, next-intl, Radix UI, PostgreSQL (self-hosted), Redis (self-hosted), Docker Compose for local dev, Zod for validation, Argon2id for passwords, jose for JWT, Drizzle ORM.

**Spec:** Current implementation at `/home/as/projects/workforce-mvp` — 9 tables, RLS policies, auth flow, 13 pages, role-based access (admin/supervisor/employee)

## Global Constraints

- No Supabase client packages in production bundle (`@supabase/supabase-js`, `@supabase/ssr` removed)
- Next.js 14 App Router with TypeScript strict mode
- i18n: Dutch (nl) LTR + Arabic (ar) RTL via next-intl
- RBAC roles: `administrator`, `supervisor`, `employee` — explicitly enforced at every API route
- PWA-ready responsive web (no native mobile apps)
- Privacy-supporting capabilities (see Section 11 — not claimed as "GDPR-ready")
- No breaking changes to existing frontend component APIs
- Docker Compose for local development parity
- Native phased implementation (not subagent-driven)
- Each phase ends with targeted verification before proceeding

## Review Focus

1. **Token reuse / replay** — Stolen access JWTs must not grant persistent access; short TTL + refresh token rotation + Redis session invalidation; refresh token reuse detection triggers session purge
2. **SQL injection via dynamic queries** — All database access must use parameterized queries (Drizzle); no string interpolation in SQL
3. **Authorization boundary bypass** — Every API route must verify role + ownership; RLS is removed, so app-layer checks are the sole enforcement
4. **Password leak in logs/errors** — Argon2id hashes never logged; validation errors sanitized; no PII in error tracking
5. **Race conditions on shift applications** — Concurrent applications to same shift must use advisory locks; prevent double-booking

---

## 1. Current Architecture

**Frontend (preserved with cleanup):**
- Next.js 14 App Router with `(locale)` route group for i18n
- Pages: `/admin`, `/admin/shifts`, `/admin/shifts/create`, `/employee`, `/employee/shifts`, `/employee/schedule`, `/attendance/check-in`, `/auth/login`, `/auth/register`
- Components: SessionProvider, Navigation, UI primitives (Button, Card, Input, Label, Textarea)
- Middleware at `/src/middleware.ts` for route protection + locale handling (uses Supabase, to be replaced)
- Translations: `/src/locales/nl.json`, `/src/locales/ar.json`

**Backend (to replace):**
- Supabase PostgreSQL: 9 tables (profiles, user_roles, employee_details, shifts, shift_applications, shift_assignments, attendance_records, notifications, audit_logs)
- Supabase Auth: email/password signup, login, session management
- Supabase RLS: Row-level security policies on all tables
- Supabase Storage: file uploads (not yet used)
- `@supabase/ssr` for server-side session in middleware
- `@supabase/supabase-js` for browser client in components

**Database Schema (9 tables):**
- `profiles` — user profile data (id, full_name, email, phone, city, preferred_language, account_status, avatar_url)
- `user_roles` — role assignments (id, user_id, role, assigned_by, assigned_at)
- `employee_details` — extended employee info (work_categories, qualifications, employment_type, hourly_rate, bank details, emergency contact, address, BSN)
- `shifts` — shift definitions (title, work_type, client, location, lat/lng, start/end, required_workers, compensation, description, instructions, status, created_by)
- `shift_applications` — employee applications to shifts (shift_id, employee_id, status, applied_at, reviewed_by, reviewed_at, rejection_reason)
- `shift_assignments` — confirmed assignments (shift_id, employee_id, application_id, status, assigned_by, assigned_at, confirmed_at)
- `attendance_records` — check-in/out with GPS (shift_assignment_id, check_in/out_at, lat/lng, attendance_status, correction_reason, approved_by)
- `notifications` — in-app notifications (recipient_id, type, title, message, related_ids, read_at)
- `audit_logs` — audit trail (actor_id, action, entity_type, entity_id, old/new_values, ip, user_agent)

---

## 2. Supabase Dependencies to Remove/Replace

| Current | Replacement |
|---------|-------------|
| `@supabase/supabase-js` | Custom DB client (pg) + Drizzle ORM + Zod schemas |
| `@supabase/ssr` | jose (JWT verification) + Redis session lookup |
| Supabase Auth | Custom auth: Argon2id + RS256 JWT (access token) + opaque rotating refresh tokens |
| Supabase RLS | Application-layer authorization in middleware + API route guards |
| Supabase Realtime (unused) | Not replaced — use polling or SSE later if needed |
| Supabase Storage | **Deferred** — MinIO optional, added only when a concrete file-storage requirement exists |
| Supabase Edge Functions | Next.js API routes |

**Packages to remove:**
- `@supabase/supabase-js`
- `@supabase/ssr`

**Packages to add:**
- `pg` + `@types/pg` — PostgreSQL client
- `redis` (or ioredis) — Redis client for sessions, rate limiting, locks, verification state
- `jose` — JWT signing/verification (RS256)
- `argon2` — password hashing (Argon2id)
- `zod` — schema validation
- `drizzle-orm` + `drizzle-kit` + `pg` — type-safe query builder
- `crypto` (Node built-in) — for generating cryptographically-random opaque tokens

---

## 3. Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Compose                           │
├──────────────────┬──────────────────┬───────────────────────────┤
│   Next.js (app)  │   PostgreSQL     │      Redis                │
│                  │   (db)           │  (sessions/locks/rate)   │
└──────────────────┴──────────────────┴───────────────────────────┘
```

**MinIO is NOT included in the base stack.** It is optional and will be added only when a concrete file-storage/upload requirement emerges.

### Public vs. Protected Routing

```
Public (landing/marketing):
  /nl                     → public landing page (Dutch, LTR)
  /ar                     → public landing page (Arabic, RTL)
  /nl/auth/login          → login page (public, but redirects if already authenticated)
  /nl/auth/register       → register page (public, but redirects if already authenticated)
  /nl/auth/forgot-password → password reset request (public)
  /nl/auth/reset-password  → password reset form (public)

Protected (requires authenticated role):
  /nl/admin/*             → administrator-only area
  /nl/supervisor/*        → supervisor-only area (planned)
  /nl/employee/*          → employee-only area
  /nl/attendance/*        → authenticated users (any role)
```

**Routing flow:**
1. Root `/` redirects to `/nl` (public landing page)
2. Middleware extracts locale from path, verifies JWT from cookie
3. Unauthenticated users on protected routes → redirect to `/:locale/auth/login`
4. Authenticated users on auth pages (login/register) → redirect to role-appropriate dashboard
5. Authenticated users with wrong role on a role-scoped route → redirect to their role dashboard

---

## 4. Database/Schema Migration Strategy

**Approach:** Fresh Drizzle schema → generate migration SQL → apply to fresh PostgreSQL instance. No direct Supabase-to-PostgreSQL dump because:
- RLS policies don't translate
- Supabase Auth schema (`auth.users`) differs from custom users table
- Password hashes need to be regenerated (Argon2id)

**Steps:**
1. Write Drizzle schema in `/src/lib/db/schema.ts` matching 9 tables
2. Generate initial migration: `npx drizzle-kit generate:pg`
3. Create seed script for development data
4. Write one-time migration script to import from Supabase (optional, for prod data):
   - Export Supabase data via `supabase db dump --data-only`
   - Transform: map `auth.users` → `profiles` + `user_roles`
   - Hash passwords with Argon2id (no password recovery possible — prompt users to reset)
   - Import via `psql`

**Schema Changes:**
- Add `password_hash` column to `profiles` (nullable for migrated users, required for new)
- Move `refresh_token` management to Redis (not stored in DB)
- Remove `auth.users` dependency — `profiles.id` (UUID) is now the primary key
- Keep all existing columns, enums, indexes, foreign keys

---

## 5. Authentication/Session Strategy

### Password Hashing

Use **Argon2id** (not bcrypt). Argon2id is the winner of the Password Hashing Competition (2015) and provides resistance against both GPU cracking and timing attacks. Parameters: memory cost 64MB, parallelism 2, time cost 3, hash length 32 bytes.

```typescript
// /src/lib/auth/passwords.ts
import argon2 from 'argon2';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    timeCost: 3,
    memoryCost: 65536, // 64 MB
    parallelism: 2,
    hashLength: 32,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
```

### Token Design

**Access Token:** RS256 JWT, 15 min expiry. Contains `{ sub: userId, role, jti, iat, exp, ip: ipHash }`.
- **Why RS256 is justified:** In this self-hosted architecture, there is a single signing issuer (the Next.js app). RS256 allows the verification key (public key) to be embedded in the container/environment without risk — it cannot sign tokens. The private key stays server-side only. This is simpler than distributing a symmetric secret to all verifying services. The overhead is one asymmetric keypair, which is standard for this architecture. There is no added complexity beyond key generation and storage.

**Refresh/Session Token:** Opaque, cryptographically-random 32-byte string. Stored **only as a SHA-256 hash** in Redis. Never stored in plaintext or in the database.
- On each refresh, the old token is invalidated and a new one is issued (rotating).
- Reuse of an old refresh token after rotation is treated as a security event: all sessions for that user are purged from Redis.

**Session State in Redis:**
- `session:{jti}` → `{ userId, role, ipHash, createdAt, expiresAt, refreshHash }` (TTL: 7 days)
- `refresh:{userId}:{tokenHash}` → `{ sessionId, createdAt, expiresAt, used: boolean }` (TTL: 30 days)
- Only `tokenHash` (SHA-256) of the refresh token is stored — the raw token is never persisted.

### Flow

1. **Login:** POST `/api/auth/login` with email/password → verify Argon2id → generate access JWT + opaque refresh token → store session + refresh hash in Redis → set HttpOnly Secure cookies
2. **Register:** POST `/api/auth/register` → hash password with Argon2id → insert profile + user_role(employee) → auto-login
3. **Middleware:** Read access token from cookie → verify JWT signature (RS256) + expiry + IP binding → lookup session in Redis → attach `user` + `role` to request
4. **Refresh:** POST `/api/auth/refresh` → verify refresh token hash in Redis → check not already used → rotate both tokens → mark old refresh as used → issue new session
5. **Logout:** POST `/api/auth/logout` → delete session + refresh token from Redis → clear cookies
6. **Password Reset:** POST `/api/auth/forgot-password` → generate one-time token → store in Redis with TTL → email link → POST `/api/auth/reset-password` → verify token → hash new password with Argon2id → invalidate all sessions for user

### Cookie Settings

- `access_token`: HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=900 (15 min)
- `refresh_token`: HttpOnly, Secure, SameSite=Strict, Path=/api/auth/refresh, Max-Age=2592000 (30 days)

---

## 6. Redis Responsibilities

| Responsibility | Key Pattern | TTL | Notes |
|----------------|-------------|-----|-------|
| Session store | `session:{jti}` | 7 days | Access JWT session metadata; invalidated on logout or token reuse |
| Refresh token index | `refresh:{userId}:{tokenHash}` | 30 days | Only SHA-256 hash stored; `used` flag for rotation detection |
| Rate limiting | `ratelimit:{ip}:{endpoint}` | 1 min | Per-IP per-endpoint counters; sliding window |
| Password reset tokens | `reset:{tokenHash}` | 15 min | One-time use; stored as hash |
| Email verification tokens | `verify:{tokenHash}` | 24 hours | One-time use; stored as hash |
| Shift application locks | `lock:shift_application:{shiftId}:{userId}` | 30 sec | Advisory-lock equivalent; prevents double-booking |

**No general query caching is introduced.** Redis is limited to sessions, rate limiting, verification/reset state, and locks. Query caching will only be added if a concrete measured need arises.

**Connection:** Single Redis instance with connection pooling. Graceful degradation: if Redis unavailable in development, fall back to in-memory Map; in production, reject requests that require session state.

---

## 7. Docker Architecture

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports: ["3000:3000"]
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/workforce
      - REDIS_URL=redis://redis:6379
      - JWT_PUBLIC_KEY=... (from .env, mounted at build)
      - JWT_PRIVATE_KEY=... (from .env, mounted at build)
      - NODE_ENV=production
    depends_on: [db, redis]
    # MinIO NOT included — added only when file storage is required

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=workforce
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck: ["pg_isready", "-U", "postgres"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: ["redisdata:/data"]
    healthcheck: ["redis-cli", "ping"]
    # MinIO is optional — see below

  # minio:  # OPTIONAL — uncomment when file storage is needed
  #   image: minio/minio
  #   command: server /data --console-address ":9001"
  #   ports: ["9000:9000", "9001:9001"]
  #   environment:
  #     - MINIO_ROOT_USER=minioadmin
  #     - MINIO_ROOT_PASSWORD=minioadmin
  #   volumes: ["miniodata:/data"]

volumes: { pgdata, redisdata }
```

**Dockerfile:** Multi-stage: builder (install deps, generate Drizzle) → runner (copy dist, node_modules). Non-root user.

---

## 8. Routing/Landing-Page Changes

**Current:**
- Root `/` redirects to `/nl` via `layout.tsx`
- All routes under `/(locale)/` with middleware locale extraction
- Auth pages (`/auth/login`, `/auth/register`) currently show mock data and have malformed placeholder text

**Changes:**
- `/nl` and `/ar` become **public marketing/company landing pages** — no internal dashboard data or fake company statistics
- Middleware updated to:
  1. Extract locale from pathname
  2. Verify JWT from cookie (new auth)
  3. Role-based redirects using new session data from Redis
- `supervisor` role routes added (redirect target for supervisors)
- API routes at `/api/*` (no locale prefix — stateless)
- Public `/:locale/auth/*` pages redirect authenticated users to their role dashboard
- Add health check: `GET /api/health` → `{ status: "ok", db: true, redis: true }`

**Frontend cleanup required (Section 9):**
- Replace hardcoded mock data on dashboard pages with API-driven data (initially still fetch-based, not Supabase)
- Fix malformed placeholder text (e.g., `'sapos;s` artifacts in attendance page)
- Auth pages must point to new custom API routes (`/api/auth/login`, `/api/auth/register`) instead of Supabase client

---

## 9. Existing Frontend Pieces to Preserve (with Cleanup)

**Preserve as-is (zero changes):**
- `/src/app/(locale)/layout.tsx` — NextIntlClientProvider, SessionProvider, Navigation, locale/RTL handling
- `/src/components/navigation.tsx` — role-based nav (reads role from SessionProvider)
- `/src/components/ui/*` — all Radix-based primitives (Button, Card, Input, Label, Textarea)
- `/src/locales/nl.json`, `/src/locales/ar.json` — all translations
- `/src/lib/utils.ts` — `cn()` helper
- `/src/lib/i18n.ts` — next-intl config

**Files to UPDATE (modify, not replace):**
- `/src/middleware.ts` — swap Supabase auth for JWT verification + Redis session lookup
- `/src/components/session-provider.tsx` — change `createSupabaseClient()` to `fetch('/api/auth/me')`
- `/src/app/(locale)/admin/page.tsx` — replace hardcoded fake stats with API-driven data; fix malformed text
- `/src/app/(locale)/employee/page.tsx` — replace hardcoded fake stats with API-driven data; fix malformed text
- `/src/app/(locale)/attendance/check-in/page.tsx` — replace Supabase TODOs with API calls; fix malformed `'sapos;s` placeholder text
- `/src/lib/auth.ts` — keep date helpers; remove Supabase-specific functions

**Files to REMOVE:**
- `/src/lib/supabase.ts` — browser client wrapper
- `/src/lib/supabase-server.ts` — server client + types

---

## 10. Exact Implementation Phases

### Phase 0: Foundation (1-2 days)

- [ ] Task 0.1: Install dependencies — `pg`, `drizzle-orm`, `drizzle-kit`, `redis`, `jose`, `argon2`, `zod`, `@types/pg`, `@types/redis`
- [ ] Task 0.2: Create Docker Compose with Postgres + Redis
- [ ] Task 0.3: Write Drizzle schema in `/src/lib/db/schema.ts` mirroring 9 tables, with `password_hash` on profiles
- [ ] Task 0.4: Generate and run initial migration (`npx drizzle-kit generate:pg` + `npx drizzle-kit migrate`)
- [ ] Task 0.5: Create db connection pool (`/src/lib/db/index.ts`) — pg pool + Drizzle instance
- [ ] Task 0.6: Write Zod validators for all API inputs (`/src/lib/validators/`) — auth, shifts, employees, attendance
- [ ] Task 0.7: Generate RS256 keypair, store under `~/.config/ai/secrets/workforce-mvp/`
- [ ] **Verify:** `npx drizzle-kit studio` opens, migration applied, typecheck passes

### Phase 1: Auth System (2-3 days)

- [ ] Task 1.1: Implement Argon2id password hashing (`/src/lib/auth/passwords.ts`)
- [ ] Task 1.2: Implement RS256 JWT create/verify (`/src/lib/auth/tokens.ts`)
- [ ] Task 1.3: Implement Redis session CRUD + opaque refresh token handling (`/src/lib/auth/session.ts`)
- [ ] Task 1.4: Create API routes — `/api/auth/login` (POST), `/api/auth/register` (POST), `/api/auth/logout` (POST), `/api/auth/me` (GET), `/api/auth/refresh` (POST)
- [ ] Task 1.5: Create `/api/auth/forgot-password` (POST) + `/api/auth/reset-password` (POST) with Redis verification tokens
- [ ] Task 1.6: Write middleware auth guard — verify JWT + Redis session lookup (`/src/lib/middleware/requireAuth.ts`)
- [ ] Task 1.7: Create role guards (`/src/lib/middleware/requireRole.ts`) — supports `administrator`, `supervisor`, `employee`
- [ ] Task 1.8: Update `/src/middleware.ts` — replace Supabase with new JWT + Redis + locale extraction
- [ ] Task 1.9: Update `/src/components/session-provider.tsx` — fetch from `/api/auth/me`
- [ ] **Verify:** Register → login → access protected route → logout → token reuse rejected → rate limiting blocks brute force

### Phase 2: Admin API (2-3 days)

- [ ] Task 2.1: Shifts CRUD API (`/api/admin/shifts*`) with Zod validation + `requireRole('administrator')`
- [ ] Task 2.2: Employees CRUD API (`/api/admin/employees*`) — list, view, update role/status
- [ ] Task 2.3: Applications API (`/api/admin/applications*`) — list, review accept/reject (uses shift application lock)
- [ ] Task 2.4: Attendance overview API (`/api/admin/attendance`) — list attendance records
- [ ] Task 2.5: Add `supervisor` role support to API routes where applicable
- [ ] **Verify:** Admin can create/edit/delete shifts; supervisor can view but not create; employee gets 403

### Phase 3: Employee API (2 days)

- [ ] Task 3.1: Available shifts API (`/api/employee/shifts`) — with filtering + pagination
- [ ] Task 3.2: Shift apply API (`/api/employee/shifts/[id]/apply`) — uses advisory lock prevention
- [ ] Task 3.3: My schedule API (`/api/employee/schedule`) — upcoming assignments
- [ ] Task 3.4: My applications API (`/api/employee/applications`) — status tracking
- [ ] Task 3.5: Availability submit API (`/api/employee/availability`) — GET/POST
- [ ] **Verify:** Employee can browse/apply to shifts; cannot access admin endpoints (403); concurrent apply blocked

### Phase 4: Attendance API (1-2 days)

- [ ] Task 4.1: Check-in API (`/api/attendance/check-in`) — GET GPS coordinates from client, validate against shift location, record timestamp
- [ ] Task 4.2: Check-out API (`/api/attendance/check-out`) — same GPS validation
- [ ] Task 4.3: Shift assignment queries for attendance eligibility — verify employee is assigned to shift on that date
- [ ] **Verify:** Employee can check in/out only for assigned shifts; GPS validation rejects out-of-bounds; cannot check in twice

### Phase 5: Notifications & Audit (1 day)

- [ ] Task 5.1: Notification CRUD API (`/api/notifications*`)
- [ ] Task 5.2: Audit log middleware — auto-log mutations with actor_id, action, entity_type, entity_id, old/new_values, ip, user_agent
- [ ] Task 5.3: Background job for upcoming shift reminders (cron via `node-cron` or Next.js scheduled revalidation)
- [ ] **Verify:** Audit log captures all mutations; notifications created on application status change

### Phase 6: Migration & Polish (2 days)

- [ ] Task 6.1: Write optional Supabase export/import script (`/scripts/migrate-from-supabase.ts`) — for production data migration only
- [ ] Task 6.2: Seed development database with realistic test data (`/scripts/seed.ts`)
- [ ] Task 6.3: Remove `@supabase/supabase-js` and `@supabase/ssr` from `package.json`
- [ ] Task 6.4: Delete `/src/lib/supabase.ts`, `/src/lib/supabase-server.ts`
- [ ] Task 6.5: Update `.env.example` with new variables (JWT keys, DATABASE_URL, REDIS_URL)
- [ ] Task 6.6: Clean all frontend pages — remove hardcoded mock data, replace with API fetch; fix malformed placeholder text
- [ ] Task 6.7: Update `/src/app/(locale)/page.tsx` (root layout) — make `/nl` and `/ar` public marketing landing pages, no dashboard data
- [ ] Task 6.8: Run full verification — `npm run typecheck`, `npm run lint`, `npm run build`, security tests

---

## 11. Security Risks and Migration Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| JWT private key leak | Medium | Critical | Store RS256 private key in env/secret manager only; public key can be in container; rotate annually |
| Refresh token theft | Medium | High | Short TTL (30d), rotation on use, only hash stored in Redis, reuse detection purges all sessions |
| Session fixation | Low | High | Generate new JTI on login; destroy all sessions on logout; never reuse session IDs |
| SQL injection | Low | Critical | Drizzle ORM exclusively; no raw SQL; code review rule |
| Authorization bypass | High | Critical | Every API route calls `requireRole()`; integration tests per role boundary |
| Password exposure | Low | Critical | Argon2id (memory cost 64MB, time cost 3); never log hashes; constant-time comparison |
| Race condition on shift apply | Medium | High | Redis lock (`lock:shift_application:{shiftId}:{userId}`) + Drizzle transaction |
| Token replay | Low | High | 15-min access JWT TTL; Redis session lookup on every request; IP binding via hash |
| Redis data loss | Low | Medium | AOF persistence; sessions recoverable via refresh token; dev fallback to in-memory |
| Migration data loss | Medium | High | Dry-run on staging; checksum row counts; rollback plan; passwords require reset (Argon2id) |

### Privacy-Supporting Capabilities

This architecture provides privacy-supporting capabilities — it is not claimed to be "GDPR-ready" as a binary state. The Netherlands jurisdiction is assumed, but compliance requires ongoing operational practices beyond code.

- **Data minimization:** Only necessary profile fields collected; no tracking beyond auth IP hash for token binding
- **Data export:** API endpoint `/api/user/export` returns all stored personal data as JSON
- **Data deletion:** API endpoint `/api/user/delete` performs hard delete of profile + all related records (audit log redacted)
- **Retention:** Shift applications retain for 2 years; audit logs retained for 7 years; notification read status purged after 90 days of inactivity
- **Auditability:** Full audit trail of all mutations with actor_id, timestamp, IP (hashed), user_agent
- **Encryption:** TLS everywhere (Docker internal + public); passwords hashed with Argon2id; at-rest encryption via PostgreSQL TDE (optional, host-managed)

---

## 12. Files Expected to be Added, Changed, or Removed

### Added (new files)

```
/src/lib/db/index.ts                    # pg pool + Drizzle instance
/src/lib/db/schema.ts                   # Drizzle schema (9 tables)
/src/lib/db/queries/shifts.ts           # shift queries
/src/lib/db/queries/employees.ts        # employee queries
/src/lib/db/queries/applications.ts     # application queries
/src/lib/db/queries/assignments.ts      # assignment queries
/src/lib/db/queries/attendance.ts       # attendance queries
/src/lib/db/queries/notifications.ts    # notification queries
/src/lib/db/queries/audit.ts            # audit log queries
/src/lib/auth/passwords.ts              # Argon2id hash/verify
/src/lib/auth/tokens.ts                 # RS256 JWT create/verify
/src/lib/auth/session.ts                # Redis session + refresh token CRUD
/src/lib/middleware/requireAuth.ts      # auth guard (JWT + Redis session)
/src/lib/middleware/requireRole.ts      # role guards (admin/supervisor/employee)
/src/lib/validators/auth.ts             # login/register/reset schemas (Zod)
/src/lib/validators/shifts.ts           # shift CRUD schemas (Zod)
/src/lib/validators/employees.ts        # employee schemas (Zod)
/src/lib/validators/attendance.ts       # check-in/out schemas (Zod)
/src/app/api/auth/login/route.ts        # POST login → access JWT + refresh token
/src/app/api/auth/register/route.ts     # POST register → Argon2id hash + profile + role
/src/app/api/auth/logout/route.ts       # POST logout → purge Redis sessions
/src/app/api/auth/me/route.ts           # GET current user + role
/src/app/api/auth/refresh/route.ts      # POST refresh → rotate tokens, detect reuse
/src/app/api/auth/forgot-password/route.ts  # POST → Redis verification token
/src/app/api/auth/reset-password/route.ts   # POST → verify token, Argon2id re-hash
/src/app/api/health/route.ts            # GET health check (db + redis)
/src/app/api/admin/shifts/route.ts      # GET/POST shifts
/src/app/api/admin/shifts/[id]/route.ts # GET/PATCH/DELETE shift
/src/app/api/admin/employees/route.ts   # GET/POST employees
/src/app/api/admin/employees/[id]/route.ts # GET/PATCH/DELETE employee
/src/app/api/admin/applications/route.ts # GET applications
/src/app/api/admin/applications/[id]/review/route.ts # POST review
/src/app/api/admin/attendance/route.ts  # GET attendance
/src/app/api/employee/shifts/route.ts   # GET available shifts
/src/app/api/employee/shifts/[id]/apply/route.ts # POST apply (advisory lock)
/src/app/api/employee/schedule/route.ts # GET my schedule
/src/app/api/employee/applications/route.ts # GET my applications
/src/app/api/employee/availability/route.ts # GET/POST availability
/src/app/api/attendance/check-in/route.ts # POST GPS check-in
/src/app/api/attendance/check-out/route.ts # POST GPS check-out
/docker-compose.yml                     # local dev stack (no MinIO)
/Dockerfile                             # production image
/.env.example                           # updated env template
/scripts/migrate-from-supabase.ts       # one-time migration (optional)
/scripts/seed.ts                        # dev seed data
/tests/security.test.ts                 # security tests — auth, authz, token rotation, rate limiting, cross-role access
/tests/integration/auth.test.ts         # auth flow integration tests
/tests/integration/shifts.test.ts       # shift CRUD + application lock tests
```

### Changed (existing files)

```
/src/middleware.ts                      # JWT verification + Redis session lookup + locale
/src/components/session-provider.tsx    # fetch from /api/auth/me instead of Supabase
/src/app/(locale)/page.tsx              # public marketing landing (was redirect)
/src/app/(locale)/admin/page.tsx        # replace fake stats with API data
/src/app/(locale)/employee/page.tsx     # replace fake stats with API data
/src/app/(locale)/attendance/check-in/page.tsx # API calls + fix malformed text
/src/lib/auth.ts                        # keep date helpers, remove Supabase functions
/package.json                           # new deps, remove supabase packages
/.env.example                           # new env vars (JWT keys, DATABASE_URL, REDIS_URL)
/scripts/seed.ts                        # updated seed for new schema
```

### Removed (deleted files)

```
/src/lib/supabase.ts                    # browser client wrapper
/src/lib/supabase-server.ts             # server client + types
```

### Unchanged (preserved as-is)

```
/src/app/(locale)/admin/shifts/page.tsx        # shifts list table
/src/app/(locale)/admin/shifts/create/page.tsx # shift creation form
/src/app/(locale)/employee/shifts/page.tsx      # available shifts grid
/src/app/(locale)/employee/schedule/page.tsx   # schedule view
/src/app/(locale)/auth/login/page.tsx           # login form (update API target in Phase 1)
/src/app/(locale)/auth/register/page.tsx        # register form (update API target in Phase 1)
/src/components/navigation.tsx                  # role-based nav
/src/components/ui/*.tsx                        # all UI primitives
/src/locales/nl.json                            # Dutch translations
/src/locales/ar.json                            # Arabic translations
/src/lib/utils.ts                               # cn() helper
/src/lib/i18n.ts                                # next-intl config
/src/app/globals.css                            # Tailwind + theme + RTL
```

---

## Security Tests

Located in `/tests/security.test.ts`. These tests run against the real API routes (not mocks) using the Docker Compose stack.

**Test coverage:**
- Authentication: login with correct/incorrect credentials; register with duplicate email; expired JWT rejected; malformed JWT rejected
- Authorization boundaries: admin can access admin routes; employee gets 403 on admin routes; supervisor can access employee routes but not admin-only mutations; unauthenticated user redirected to login
- Token rotation/reuse: refresh token issues new tokens; reused refresh token after rotation triggers session purge; old access JWT rejected after logout (Redis session deleted)
- Rate limiting: 5 failed login attempts → 6th blocked (429); per-endpoint rate limits enforced
- Cross-role access: employee cannot apply to shifts they're already assigned to; employee cannot review their own applications; admin cannot impersonate other roles via token manipulation

---

**Total estimate:** 10-14 days for complete migration with testing, using native phased implementation.

**Execution approach:** Native phased implementation — each phase ends with targeted verification (`typecheck`, `lint`, `build`, and security tests) before proceeding to the next phase. No subagent orchestration due to provider capacity constraints.

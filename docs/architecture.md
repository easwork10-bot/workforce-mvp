# Workforce MVP — Current Architecture

This document describes the implementation currently present in the repository. It
is the technical source of truth; dated plans and the original project handoff are
historical records, not current implementation specifications. For onboarding, see
the [root README](../README.md) and [documentation index](./README.md). For safe
database-backed tests, see the
[isolated integration-test guide](./testing/isolated-integration-tests.md).

## System at a glance

Workforce MVP is one Next.js 15 App Router application. It serves localized pages,
API route handlers, and server-side business logic from the same deployment. It uses
PostgreSQL for persistent application data and Redis for authentication/session
state, rate limits, and application coordination. There is no active Supabase client
or Supabase-backed runtime in the current app.

| Area | Current implementation |
|---|---|
| Web application | Next.js 15, React 19, TypeScript, standalone output |
| UI | Tailwind CSS, Radix-based primitives, `lucide-react` |
| Localization | `next-intl`; Dutch (`nl`) and Arabic (`ar`) catalogs; Arabic RTL |
| API validation | Zod schemas in [`src/backend/validation/`](../src/backend/validation/) |
| Persistent data | PostgreSQL, Drizzle ORM, schema in [`src/backend/db/schema.ts`](../src/backend/db/schema.ts) |
| Authentication | Argon2id password hashes, RS256 access JWTs, opaque refresh tokens in [`src/backend/auth/`](../src/backend/auth/) |
| Session and coordination state | Redis |
| Tests | Vitest; database suites run through the isolated Docker workflow |

Next.js 15 and React 19 replace the vulnerable Next.js 14 line. The Next.js
PostCSS dependency is overridden to the patched version declared in
[`package.json`](../package.json). `next-intl` 4 uses asynchronous locale
resolution; explicit locale preferences retain the previous one-year cookie lifetime.

## Source ownership and request flow

```text
src/
├── app/
│   ├── [locale]/       Localized page routes and layouts
│   └── api/            Next.js Route Handlers
├── backend/
│   ├── auth/           Password, token, and Redis-session operations
│   ├── db/             Drizzle connection, schema, and query modules
│   ├── jobs/           Opt-in shift reminder scheduler
│   ├── security/       Authentication, role, CSRF, and audit helpers
│   ├── services/       Shared business services, including attendance
│   └── validation/     API request schemas
├── frontend/
│   ├── components/     Navigation and client session context
│   ├── features/       Connected employee and administrator features
│   ├── lib/            Browser-safe shared utilities
│   └── ui/             Reusable UI primitives
├── locales/            Dutch and Arabic message catalogs
├── i18n.ts             Locale configuration and request messages
├── instrumentation.ts  Thin runtime gate
└── middleware.ts       Locale routing; not API authorization
```

[`src/app/`](../src/app/) owns framework entry points and page composition.
Browser-facing shared components belong under [`src/frontend/`](../src/frontend/).
Database, secret, session, authorization, and business-logic code belongs under
[`src/backend/`](../src/backend/) and must remain server-only. The
[frontend import-boundary check](../scripts/check-frontend-boundaries.mjs) and its
[architecture test](../tests/unit/architecture/frontend-architecture.test.ts)
protect this separation.

The `next-intl` middleware applies locale routing and the default Dutch locale. It
does not authenticate or authorize application pages. Each protected dashboard page verifies the access JWT and its Redis session on the
server before rendering:
administrator pages require the administrator role; employee and attendance pages
require the employee role. Missing, expired or revoked sessions redirect to the
current locale's login; a wrong role receives a not-found response. API handlers
remain the authoritative enforcement boundary and perform authentication, role
checks, and resource ownership checks where required. Session lookup also requires
an active profile and an assigned role matching the Redis session. The employee
edit API replaces prior roles when its single role field is provided, then attempts
to revoke the user's sessions. Even if Redis revocation is incomplete, a session
with a removed role is rejected by the shared PostgreSQL-backed session check.
Setting an account inactive or suspended also triggers Redis session revocation;
any session that remains is rejected while the profile is inactive. Reactivation
first requires confirmed Redis revocation, so an unavailable Redis service leaves
the account inactive rather than reviving a stale session.

## Pages and implemented UI

Pages are under `src/app/[locale]/`:

- `/`, `/auth/login`, and `/auth/register`
- `/employee`, `/employee/shifts`, `/employee/applications`, and `/employee/schedule`
- `/admin`, `/admin/shifts`, `/admin/shifts/create`, `/admin/applications`, and `/admin/assignments`
- `/attendance/check-in`

The employee shift browser and application history use their APIs. The administrator
dashboard, shift management, application review and assignment overview use their
respective APIs. Login and registration use the self-hosted auth routes.
The employee dashboard, employee schedule, and attendance check-in/out page remain
presentation prototypes backed by sample data. In particular, the attendance page does not call the implemented
attendance APIs, and GPS shown there is not a server-side geofence or location
verification feature. Do not treat sample dashboard values or UI controls as
persisted workflows.

## API responsibilities

Route handlers live in [`src/app/api/`](../src/app/api/); Zod input contracts are in
[`src/backend/validation/`](../src/backend/validation/).

| Route group | Responsibility |
|---|---|
| `/api/auth/*` | CSRF token bootstrap, registration, login, logout, current identity, and refresh-token rotation |
| `/api/employee/shifts*` | Browse shifts, read shift details, and apply for a shift |
| `/api/employee/applications` | Read the authenticated employee's applications |
| `/api/employee/applications/:id/cancel` | Cancel an eligible pending application |
| `/api/employee/schedule` | Read the authenticated employee's schedule |
| `/api/employee/attendance/*` | Employee check-in and check-out |
| `/api/attendance/*` | Parallel attendance handlers retained for existing callers |
| `/api/admin/shifts*` | Administrative shift listing, creation and publication |
| `/api/admin/applications*` | Read applications and review a specific application |
| `/api/admin/assignments*` | List and cancel assignments |
| `/api/admin/employees*` | Employee management |
| `/api/admin/attendance` and `/api/admin/audit` | Attendance and audit queries |
| `/api/notifications*` | Read, create, mark read, and delete recipient notifications |
| `/api/health` | Application dependency health endpoint |

The two attendance route families remain in the API surface. Mutating business
routes use CSRF and role wrappers where implemented; authentication endpoints use
their own request/session flows. Preserve and test the route-specific contracts when
changing handlers.

## Authentication and security contracts

### Credentials, tokens, and sessions

- Passwords are stored as Argon2id hashes and verified server-side.
- Access tokens are RS256 JWTs with a 15-minute lifetime. Refresh tokens are opaque
  random values and are stored in Redis only as hashes.
- JWT signing and verification use a matching RSA key pair of at least 2048 bits.
  Configure either both `JWT_PRIVATE_KEY_FILE` and `JWT_PUBLIC_KEY_FILE`, or both
  base64 variables; do not mix sources. Legacy key-file discovery exists for
  compatibility, but explicit configuration is preferred.
- Access and refresh tokens are delivered as HttpOnly cookies. The access cookie is
  SameSite Lax; the refresh cookie is SameSite Strict and scoped to
  `/api/auth/refresh`. Production cookies set `Secure`.
- Redis holds the session record, refresh-token state, and revocation data. Login
  and refresh endpoints apply IP-based rate limits. Session records have a
  seven-day Redis TTL; refresh-token records have a 30-day TTL. Refresh-token claims
  are single-use and atomically claimed; reuse can revoke the user's sessions.
- Session lookup checks the Redis session, its matching refresh-token index, and the
  current PostgreSQL account status and role assignments. A Redis role snapshot is
  rejected if it is no longer assigned; accounts without role rows retain the
  existing employee fallback. Authentication fails closed when session state cannot
  be established.
- Deactivation and suspension reject existing sessions immediately through the
  account-status check and attempt Redis revocation. Reactivation is blocked unless
  Redis confirms revocation, preventing a session left by a failed deactivation
  cleanup from becoming usable again. A session without its matching refresh-token
  index is also rejected, including an orphan left by incomplete session creation.
- The employee-edit API's single role field replaces prior role assignments and
  revokes existing sessions. Even if Redis cleanup is unavailable, shared session
  validation immediately rejects a session whose role was removed.
- The fixed-window rate limiter fails open if Redis is unavailable. This is a
  current availability trade-off and must be considered in deployment threat
  modeling.

### Authorization and CSRF

[`requireAuth`](../src/backend/security/requireAuth.ts) verifies the access JWT and
looks up its JTI in Redis; session lookup also confirms that the associated profile
is active in PostgreSQL. [`requireRole`](../src/backend/security/requireRole.ts)
restricts access to `administrator`, `supervisor`, and `employee` roles. Handlers
also scope queries or mutations to the authenticated user where the resource is
employee-owned. PostgreSQL row-level security is not the current authorization
layer; API authorization and ownership checks are critical.

State-changing routes that use the
[CSRF helpers](../src/backend/security/csrf.ts) require a matching token from the
HttpOnly signed CSRF cookie and `x-csrf-token` header. The signature is an HMAC
under `CSRF_SECRET`. The frontend obtains the raw token from `/api/auth/csrf`.
Outside tests, `CSRF_SECRET` must be explicitly set and contain at least 32 bytes.
Startup validates the CSRF secret and JWT material.

The token payload includes an IP hash, but the request-time IP comparison in
`requireAuth` is currently commented out; it is not an enforced binding. IP-based
rate limiting reads forwarded headers, so any deployment proxy must overwrite and
control those headers rather than accept client-supplied values.

## PostgreSQL and migration state

The active schema is [`src/backend/db/schema.ts`](../src/backend/db/schema.ts);
query modules are under [`src/backend/db/queries/`](../src/backend/db/queries/).
[`src/backend/db/index.ts`](../src/backend/db/index.ts) creates the PostgreSQL pool
and Drizzle instance. [`drizzle.config.ts`](../drizzle.config.ts) points at this
schema and writes migration artifacts to [`drizzle/`](../drizzle/).

The current Drizzle journal records `0000_wild_agent_zero` and migrations
`0001_notification_idempotency_expand`, `0002_retire_notification_legacy_indexes`,
`0003_damp_unus`, `0004_application_history`, and
`0005_assignment_history`. Fresh-install, upgrade, and rollback behavior for this
chain is verified only by the guarded disposable-database workflow. There is also
an older `drizzle/0000_melodic_spectrum.sql` file that is not present in the current
journal, plus the historical
[Supabase initial schema](./history/database/supabase/001_initial_schema.sql).
These artifacts represent different historical schema tracks; their presence
does not establish the state of any existing database.

**Unresolved operational concern:** reconcile the current schema, deployed/local
database migration ledgers, and both historical SQL tracks before deciding how to
bootstrap or upgrade a database. No reviewed first-run development database
initialization procedure is provided. Do not run Drizzle push/migration commands
against an existing `workforce` database. The isolated test runner is the only
documented workflow here that initializes a database, and it does so only after
verifying its disposable target identity and empty state.

## Attendance, applications, audit, and notifications

- Attendance route handlers validate the employee and assignment relationship.
  Shared `checkInCore` and `checkOutCore` logic in
  [`src/backend/services/attendance.ts`](../src/backend/services/attendance.ts)
  performs the business writes.
- Check-in locks the assignment and active attendance row, creates the attendance
  record, confirms an assigned shift, and writes audit rows in the same PostgreSQL
  transaction. Check-out locks the active record and writes the checkout and audit
  event transactionally. Coordinates are optional; this is not geofence
  enforcement.
- Employee shift applications use a Redis request lock, a PostgreSQL shift-row
  lock, and a partial unique index for pending applications. Rejected and cancelled
  attempts remain in application history; employees can cancel their own pending
  attempt and reapply after rejection or cancellation. Applications require an open
  shift and remaining active-assignment capacity, but have no scheduled-start cutoff.
  Review and pending cancellation lock the shift before reloading/locking the
  application; approval then checks assignment rows under that shift lock.
  Only open shifts can accept approvals, without a scheduled-start cutoff.
  Assigned/confirmed rows occupy capacity. The final approval atomically changes
  `open` to `filled` and audits the transition; other pending applications remain.
  Rejection does not change capacity or shift status. Identical completed decisions
  replay without side effects; conflicting decisions return HTTP 409 with stable
  error codes. Application, assignment, shift, notification and audit writes are
  coordinated transactionally. A partial unique assignment index covers only
  `assigned` and `confirmed`; cancelled/completed assignment history can coexist
  with a new assignment linked to a distinct application attempt.
- Administrator assignment cancellation uses
  [`cancelAssignment`](../src/backend/db/queries/assignments.ts) through
  `POST /api/admin/assignments/:id/cancel`, protected by session/JWT role checks,
  CSRF and UUID validation. It reads the shift reference, then locks **Shift →
  Assignment → Attendance** and reloads/rechecks the assignment. Assigned or
  confirmed assignments can be cancelled only before scheduled start and before
  any check-in/check-out evidence (including historical attendance). An absent
  record without check-in/check-out evidence does not block cancellation.
  Successful cancellation retains the assignment and application history; it
  reopens only `filled` shifts whose remaining assigned/confirmed count is below
  capacity. Cancelled/completed shifts and pending applications are unchanged.
  Approval still locks **Shift → Application → Assignment**. All check-in paths
  lock the assignment before attendance, without subsequently locking the shift,
  so cancellation/check-in serialize without reversing the shift lock order.
  Confirmation permits only assigned-to-confirmed, never terminal reactivation.
  Cancelled retries return 200 with `replayed: true`, including after the start
  time. Cancellation returns `ASSIGNMENT_CANCELLED`; errors are
  `ASSIGNMENT_NOT_FOUND` (404), `ASSIGNMENT_STATE_CONFLICT`, `SHIFT_STARTED`,
  `ATTENDANCE_EXISTS` (409), `INVALID_REQUEST` (400), or `INTERNAL_ERROR` (500).
  Assignment cancellation, optional filled-to-open audit, notification and
  notification audit commit atomically. One localized in-app notification uses
  existing `shift_updated` type and `assignment-cancellation:v1:<assignment-id>`;
  it clearly refers to the employee's assignment, not cancellation of the shift.
  Post-start cancellation and automatic candidate selection are not supported.
- Administrator assignment listing uses `GET /api/admin/assignments` and the
  existing [`getAssignments`](../src/backend/db/queries/assignments.ts) repository.
  [`requireRole`](../src/backend/security/requireRole.ts) requires a valid JWT,
  live Redis session and administrator role; access remains company-wide, not
  restricted to the administrator who created a shift. The strictly read-only
  endpoint requires no CSRF token and returns private, non-cacheable responses.
  Query parameters are optional `status` (`assigned`, `confirmed`, `cancelled`,
  `completed`), positive safe-integer `page` (default 1), and integer `limit`
  (1–100, default 20); unsafe offsets, unknown or repeated parameters return
  `INVALID_REQUEST` (400). Omitting status includes every assignment, preserving
  cancelled/completed history rather than grouping by employee/shift.
  The response is `{ assignments, pagination: { page, limit, total, totalPages } }`.
  Each assignment retains its schema fields (`id`, `shiftId`, `employeeId`,
  `applicationId`, `status`, `assignedBy`, `assignedAt`, `confirmedAt`) plus
  `employee: { id, fullName }` and
  `shift: { id, title, location, startAt, endAt }`. Dates serialize as ISO strings;
  nullable application/confirmation fields remain null. One count query and one
  paged query with foreign-key-backed profile/shift joins avoid N+1 reads.
  Ordering is `assignedAt DESC, id DESC`; empty results have `totalPages: 0`.
  Authentication failures return 401, other roles 403, unavailable session
  storage 503, and logged unexpected failures `INTERNAL_ERROR` (500).
  No assignment mutation or capacity calculation is introduced.
  The administrator overview at `/admin/assignments` (`/ar/admin/assignments`
  for Arabic) uses this API through a validated frontend response contract.
  Dashboard and navigation links expose the list. All four statuses
  and an All filter use server-side pagination; changing a filter resets page 1.
  Requests are abortable, empty out-of-range pages return to the last available
  page, and failures show localized retry feedback (including 401/403/503).
  The compact list stacks at mobile widths and uses the existing dashboard
  cards/buttons. Dutch/Arabic dates show full start and end dates in the
  Europe/Amsterdam time zone; Arabic uses the existing RTL layout.
  Assigned/confirmed rows offer cancellation through the existing CSRF-protected
  endpoint. A modal confirmation identifies the employee and shift and explains
  the pre-start/no-check-in-or-out-history restriction; only the backend decides
  eligibility. No browser-clock eligibility rule or attendance inference is added.
  Existing Radix dialog primitives provide modal focus trapping and dismissal;
  dismissal restores the action's focus, while mutation refresh restores focus
  to the page heading if the original action disappears. Submission is single-flight,
  with dialog dismissal and list interactions blocked through mutation/refresh.
  Responses must contain `success: true`, `ASSIGNMENT_CANCELLED`, and a boolean
  `replayed`; all existing conflicts and authentication/service errors have
  Dutch/Arabic feedback. Every attempt reloads authoritative data, even after
  uncertain network outcomes; refresh errors remain distinct from mutation
  feedback. Cancelled history stays visible under All. No backend lifecycle,
  notifications, capacity, employee schedule or migration changes are introduced.
- Audit records are written through shared query helpers. Audit values redact keys
  whose names resemble secrets, credentials, tokens, or cookies.
- Notifications are in-app database records with recipient scoping and idempotent
  creation support. There is no configured email or push-delivery integration.
- The shift reminder scheduler is an in-process Node job started through
  [`src/instrumentation-node.ts`](../src/instrumentation-node.ts) only in production when
  `SHIFT_REMINDER_JOB_ENABLED=true`. It creates idempotent in-app reminders and
  system audit entries. The Dockerfile currently sets this flag to `true`; a
  multi-replica deployment would start a scheduler in each process. Idempotency
  limits duplicate records but is not a distributed leader-election mechanism.

## Localization

[`src/i18n.ts`](../src/i18n.ts) configures locale-prefixed routes with Dutch (`nl`) as the default and
Arabic (`ar`) as the other supported message catalog. Arabic pages set RTL direction;
the locale configuration uses Riyadh time for Arabic and Amsterdam time for Dutch.
The profile schema also contains an `en` preferred-language value, but there is no
English message catalog in the active locale configuration.

## Development

Use Node.js 24 as declared by [`.nvmrc`](../.nvmrc) and install the locked
dependencies with `npm ci`. Copy [`.env.example`](../.env.example)
to `.env.local`; configure `DATABASE_URL` for a disposable, separately provisioned
local development database and `REDIS_URL` for a local Redis service. The repository
does not provide a reviewed first-run development database bootstrap. Do not point
initial setup at a shared/existing `workforce` database or run schema push/migration
commands against one.

Configure exactly one matching RSA JWT key pair (file variables or base64 variables)
with at least 2048-bit keys, and set `CSRF_SECRET` to a fresh random value of at
least 32 bytes. Keep private material outside version control. The
[development launcher](../scripts/start-dev.cjs) validates these requirements
before starting Next.js.

The root [`docker-compose.yml`](../docker-compose.yml) is for local development, not
production: it publishes PostgreSQL/Redis ports, uses persistent volumes, and has
development defaults. Review existing local services and volumes before using it.

## Tests and isolated database workflow

Vitest has a database-free unit configuration
([`vitest.config.ts`](../vitest.config.ts)) and a separate integration
configuration ([`vitest.integration.config.ts`](../vitest.integration.config.ts)).
The unit configuration selects only [`tests/unit/`](../tests/unit/) and has no
database global setup. The integration configuration includes unit and
database-backed suites in [`tests/integration/`](../tests/integration/), runs
serially because they share fixture tables, and
validates an explicitly configured loopback `workforce_test` URL plus the connected
PostgreSQL database, server address, and port before any test modules run.

The database-backed tests are grouped by domain under `tests/integration/`,
including separate shift-browsing, application-concurrency, attendance, and
approval-concurrency suites. Other suites cover authentication, API behavior,
notifications, audit logging, and database safety.

The [database safety guard](../tests/support/database/testDatabaseSafety.ts) is
tested without connecting to a database. Run `npm test` or `npm run test:ui` for
database-free unit tests. Use
`npm run test:integration:safe` for the supported database-backed workflow. It starts a
uniquely named disposable PostgreSQL/Redis Compose project on an internal network,
uses tmpfs-only service storage and no published ports, runs focused and full
Vitest suites plus typecheck, lint, boundary check, and production build, verifies
protected fixture tables remain empty after the tests, and cleans up only its own
resources. See [the test guide](./testing/isolated-integration-tests.md) and
[safe runner](../scripts/test-integration-safe.mjs).
Playwright UI regression tests are maintained under [`tests/e2e/`](../tests/e2e/)
and run against both Chromium and WebKit through the guarded
[`npm run test:integration:safe -- --browser`](./testing/isolated-integration-tests.md)
workflow. These UI tests stub their documented APIs. The separate
[`tests/real-backend/admin-assignments.spec.ts`](../tests/real-backend/admin-assignments.spec.ts)
exercises the production app with real PostgreSQL, Redis, authentication and CSRF
inside the same isolated workflow. Test output is kept under the ignored
`tests/results/` directory; never run the real-backend Playwright config directly
against development data.

## Historical records

- The [historical records index](./history/README.md) links to the dated
  [implementation plans](./history/plans/) and original
  [product handoff](./history/workforce-handoff.md).
- The archived Supabase SQL is a historical artifact, not the active database or
  runtime configuration. The unused Supabase environment templates and feature-flag
  module were removed after confirming no current consumers. Use the root
  `.env.example` for active variable names.

Historical documents may contain unfinished tasks or obsolete implementation
descriptions. Their original content is retained; verify all current behavior
against source and this document.

## Current limitations and deployment readiness

This repository is an MVP codebase, not a production deployment runbook. Before a
production launch:

1. Resolve the migration-history discrepancy and establish a reviewed database
   bootstrap, upgrade, rollback, backup, and restore procedure.
2. Design deployment-specific secret provisioning and rotation for the JWT key pair
   and `CSRF_SECRET`; never use sample or Compose development values.
3. Treat the root `docker-compose.yml` as local development only: it publishes
   PostgreSQL/Redis ports, persists local volumes, and contains development
   defaults. It is not a production hardening template.
4. Review the authorization boundary carefully: the current app relies on API-level
   role and ownership checks rather than PostgreSQL RLS.
5. Review handling, encryption, retention, and access control for sensitive
   employee data represented in the schema, including bank and government-ID
   fields, before storing real data.
6. Decide how the in-process reminder job is operated in a multi-instance
   deployment; idempotent inserts alone do not provide distributed scheduling.
7. Configure trusted reverse-proxy behavior for forwarded IP headers and deploy
   behind HTTPS so secure cookies and rate limits have the intended properties.
8. Replace sample-backed pages and validate end-to-end UI flows before representing
   them as implemented product workflows.
9. Owner-review the seven root `test-*.ts` diagnostics. Previous static review
   found credential-like literals whose validity is unknown; do not execute them
   until reviewed. If any value is live, revoke or rotate it through its owner.

No deployment topology, CI release workflow, or approved production migration
procedure is defined in this repository. The Supabase migration is historical and
must not be treated as an active deployment target.

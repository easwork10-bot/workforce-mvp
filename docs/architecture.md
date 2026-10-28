# Workforce MVP — Current Architecture

This document describes the implementation currently present in the repository. It
is the technical source of truth; dated plans and the original project handoff are
historical records, not current implementation specifications. For onboarding, see
the [root README](../README.md) and [documentation index](./README.md). For safe
database-backed tests, see the
[isolated integration-test guide](./testing/isolated-integration-tests.md).

## System at a glance

Workforce MVP is one Next.js 14 App Router application. It serves localized pages,
API route handlers, and server-side business logic from the same deployment. It uses
PostgreSQL for persistent application data and Redis for authentication/session
state, rate limits, and application coordination. There is no active Supabase client
or Supabase-backed runtime in the current app.

| Area | Current implementation |
|---|---|
| Web application | Next.js 14, React 18, TypeScript, standalone output |
| UI | Tailwind CSS, Radix-based primitives, `lucide-react` |
| Localization | `next-intl`; Dutch (`nl`) and Arabic (`ar`) catalogs; Arabic RTL |
| API validation | Zod schemas in [`src/backend/validation/`](../src/backend/validation/) |
| Persistent data | PostgreSQL, Drizzle ORM, schema in [`src/backend/db/schema.ts`](../src/backend/db/schema.ts) |
| Authentication | Argon2id password hashes, RS256 access JWTs, opaque refresh tokens in [`src/backend/auth/`](../src/backend/auth/) |
| Session and coordination state | Redis |
| Tests | Vitest; database suites run through the isolated Docker workflow |

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
│   ├── features/       Connected employee shift-browser feature
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
does not authenticate or authorize application pages. API handlers perform
authentication, role checks, and resource ownership checks where required; UI
visibility is not a security boundary.

## Pages and implemented UI

Pages are under `src/app/[locale]/`:

- `/`, `/auth/login`, and `/auth/register`
- `/employee`, `/employee/shifts`, `/employee/applications`, and `/employee/schedule`
- `/admin`, `/admin/shifts`, and `/admin/shifts/create`
- `/attendance/check-in`

The public Jofra Verkeer site includes the landing page, localized inquiry and
recruitment forms, and server-side Resend delivery. Dutch routes are unprefixed
in the application; Arabic routes use `/ar`. The GitHub Pages build adapter in
[`scripts/jofra-pages/`](../scripts/jofra-pages/) statically renders and hydrates
the same components from
[`src/frontend/features/jofra-landing/`](../src/frontend/features/jofra-landing/).
It emits canonical Dutch routes at `/`, `/aanvragen/`, and `/werken-bij-jofra/`,
Arabic routes under `/ar/`, and compatibility files under `/nl/`. Shared links
do not target legacy Dutch paths. Pages disables forms because static hosting
cannot run the API or Resend service. Jofra typography is self-hosted and shared
by both builds, including Noto Sans Arabic with its SIL Open Font License.

The employee shift browser and employee applications page are connected to
their employee APIs. The employee dashboard shows the authenticated employee's
recent applications from the same applications API. Login and registration use the
self-hosted auth routes. Other screens remain presentation prototypes backed by
hard-coded sample data: employee schedule, admin dashboard, admin shift list/create
form, and attendance check-in/out page. In particular, the attendance page does not
call the implemented attendance APIs, and GPS shown there is not a server-side
geofence or location verification feature. Do not treat prototype screen data or
controls as persisted workflows.

## API responsibilities

Route handlers live in [`src/app/api/`](../src/app/api/); Zod input contracts are in
[`src/backend/validation/`](../src/backend/validation/).

| Route group | Responsibility |
|---|---|
| `/api/auth/*` | CSRF token bootstrap, registration, login, logout, current identity, and refresh-token rotation |
| `/api/employee/shifts*` | Browse shifts, read shift details, and apply for a shift |
| `/api/employee/applications` | Read the authenticated employee's applications |
| `/api/employee/schedule` | Read the authenticated employee's schedule |
| `/api/employee/attendance/*` | Employee check-in and check-out |
| `/api/attendance/*` | Parallel attendance handlers retained for existing callers |
| `/api/admin/shifts` | Administrative shift listing and creation |
| `/api/admin/applications*` | Read applications and review a specific application |
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
- Redis holds the session record, refresh-token state, and revocation data. Login,
  registration, and refresh endpoints apply IP-based rate limits. Session records have a
  seven-day Redis TTL; refresh-token records have a 30-day TTL. Refresh-token claims
  are single-use and atomically claimed; reuse can revoke the user's sessions.
- Refresh rotation looks up the deterministic token key directly; bulk session
  revocation uses Redis cursor iteration instead of the blocking `KEYS` command.
- Session lookup depends on Redis. Missing or malformed session records return
  unauthenticated status, while Redis outages return HTTP 503 rather than appearing
  as revoked sessions.
- The fixed-window rate limiter fails closed and returns HTTP 503 when Redis is
  unavailable; authentication requests are not allowed to bypass abuse controls.
- Runtime PostgreSQL and Redis connections require explicit `DATABASE_URL` and
  `REDIS_URL` values; there is no implicit localhost connection fallback.

### Authorization and CSRF

[`requireAuth`](../src/backend/security/requireAuth.ts) verifies the access JWT and
looks up its JTI in Redis. [`requireRole`](../src/backend/security/requireRole.ts)
restricts access to `administrator`, `supervisor`, and `employee`
roles. Handlers also scope queries or mutations to the authenticated user where the
resource is employee-owned. PostgreSQL row-level security is not the current
authorization layer; API authorization and ownership checks are critical.

State-changing routes that use the
[CSRF helpers](../src/backend/security/csrf.ts) require a matching token from the
HttpOnly signed CSRF cookie and `x-csrf-token` header. The signature is an HMAC
under `CSRF_SECRET`. The frontend obtains the raw token from `/api/auth/csrf`.
Outside tests, `CSRF_SECRET` must be explicitly set and contain at least 32 bytes.
Startup validates the CSRF secret and JWT material.

The token payload includes an IP hash, but the request-time IP comparison in
`requireAuth` is not an enforced binding. Production rate limiting and audit metadata
prefer framework-provided `NextRequest.ip`. A self-hosted deployment may configure
`TRUSTED_CLIENT_IP_HEADER` as `x-forwarded-for` or `x-real-ip` only when its trusted
reverse proxy strips and overwrites that header. Forwarded headers are never trusted
implicitly; without a trusted IP source, protected endpoints fail closed with HTTP
503. The standalone Node deployment in this repository does not configure a trusted
proxy header by default, so set it only after the ingress behavior has been verified.

## PostgreSQL and migration state

The active schema is [`src/backend/db/schema.ts`](../src/backend/db/schema.ts);
query modules are under [`src/backend/db/queries/`](../src/backend/db/queries/).
[`src/backend/db/index.ts`](../src/backend/db/index.ts) creates the PostgreSQL pool
and Drizzle instance. [`drizzle.config.ts`](../drizzle.config.ts) points at this
schema and writes migration artifacts to [`drizzle/`](../drizzle/).

The current Drizzle journal records `0000_wild_agent_zero` and migrations
`0001_notification_idempotency_expand`, `0002_retire_notification_legacy_indexes`,
and `0003_damp_unus`. There is also an older `drizzle/0000_melodic_spectrum.sql`
file that is not present in the current journal, plus the historical
[Supabase initial schema](./history/database/supabase/001_initial_schema.sql).
These artifacts represent different historical schema tracks; their presence
does not establish the state of any existing database. The journaled sequence has
been verified in a disposable PostgreSQL instance and applied to the confirmed empty
Windows development database; no Linux database or legacy data volume was touched.

Specifically, the unjournaled `0000_melodic_spectrum.sql` baseline does not contain
the two partial unique notification indexes present in the journaled
`0000_wild_agent_zero.sql` baseline:
`unique_notification_recipient_type_shift` and
`unique_notification_recipient_type_application`. This remains a separate unresolved migration-history discrepancy. Do not apply the
unjournaled file or alter the journal as part of routine migration execution.

**Operational note:** the Windows development database was initialized only after
verifying its Docker project ownership, loopback port 5433 mapping, database identity,
empty schema, and absence of a Drizzle ledger. The read-only post-check confirmed all
four journaled migrations and the expected notification/audit constraints. The safe
integration runner initializes only its verified disposable database. Do not use
`drizzle-kit push`; do not run migrations against another existing database without a
separate identity and backup review.

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
- Employee shift applications use a Redis lock and database uniqueness protection.
  Application review locks the application and, when accepting, the shift row;
  it enforces worker capacity before creating an assignment. Application,
  assignment, notification, and audit writes are coordinated transactionally.
- Audit records are written through shared query helpers. Audit values redact keys
  whose names resemble secrets, credentials, tokens, or cookies.
- Notifications are in-app database records with recipient scoping and idempotent
  creation support. Jofra public inquiries and job applications use a separate
  server-side Resend integration configured by `RESEND_API_KEY`,
  `JOFRA_FORMS_FROM`, and `JOFRA_FORMS_TO`, plus Redis-backed idempotency/rate
  limiting. Automated tests mock the provider and do not deliver email.
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
dependencies with `npm ci --legacy-peer-deps`. Copy [`.env.example`](../.env.example)
to `.env.local`; configure `DATABASE_URL` for the dedicated local development
database and `REDIS_URL` for its local Redis service. On the reviewed Windows
workstation, the `work-force` development database is initialized from the journaled
migrations; other existing databases require their own identity, state, and backup
review before any migration.

Configure exactly one matching RSA JWT key pair (file variables or base64 variables)
with at least 2048-bit keys, and set `CSRF_SECRET` to a fresh random value of at
least 32 bytes. Keep private material outside version control. The
[development launcher](../scripts/start-dev.cjs) validates these requirements
before starting Next.js.

The root [`docker-compose.yml`](../docker-compose.yml) is for local development, not
production. It retains persistent `pgdata` and `redisdata` volumes and the
directory-derived Compose project name; do not rename the project or volumes without
identifying existing data. The configurable app/PostgreSQL/Redis host ports bind to
loopback only, with PostgreSQL defaulting to host port 5433. A required local
development database password and host-provided JWT secret files replace committed
or machine-specific credential defaults. Compose must be passed `.env.local` with
`--env-file`; the host app's Redis URL uses the loopback published port, while the
Compose app uses service DNS (`redis:6379`) inside its project network.
The smoke configuration requires a unique project name per run and uses an internal
network with tmpfs-only PostgreSQL/Redis storage; the safe integration runner creates
its own random project and refuses nonlocal Docker endpoints.

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
The Playwright Chromium suite in [`tests/e2e/`](../tests/e2e/) checks the main
Jofra routes, responsive navigation, image loading, form validation with
intercepted submissions, Arabic font/RTL overflow, process-line scroll reversal,
and static Pages routes. Run `npm run test:e2e` after building the Pages export as
described in the [root README](../README.md). The app server starts with public
email delivery disabled; the tests intercept requests and do not send real email.
Generated artifacts are under `tests/results/playwright/`.

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

1. Reconcile the unjournaled legacy migration file and establish a production
   database bootstrap, upgrade, rollback, backup, and restore procedure.
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
7. Configure a trusted hosting adapter that populates the framework client IP and
   deploy behind HTTPS so secure cookies and rate limits have the intended properties.
8. Replace sample-backed pages and validate remaining end-to-end Workforce flows
   before representing them as implemented product workflows.
9. Owner-review the seven root `test-*.ts` diagnostics. Previous static review
   found credential-like literals whose validity is unknown; do not execute them
   until reviewed. If any value is live, revoke or rotate it through its owner.

The [Jofra Pages workflow](../.github/workflows/jofra-showcase-pages.yml) runs a
quality gate and deploys only the static public Jofra site; it is not a deployment
for the Workforce backend. No backend production topology or approved production
migration procedure is defined in this repository. The Supabase migration is
historical and must not be treated as an active deployment target.

# Workforce MVP

Workforce MVP is a single Next.js application for workforce scheduling. Its current
backend supports employee accounts, shifts, applications, assignments, attendance,
notifications, and audit records. The product UI is only partly connected to those
services; see [current limitations](./ARCHITECTURE.md#current-limitations-and-deployment-readiness).

## Stack

- Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, and `next-intl`
- PostgreSQL accessed through Drizzle ORM
- Redis for authentication sessions, refresh-token state, rate limits, and application locks
- Argon2id password verification and RS256 access tokens
- Vitest for automated tests; Docker Compose for the isolated database-test workflow

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the current system design and [isolated
integration-test guide](./docs/testing/isolated-integration-tests.md) for test safety.

## Prerequisites

- Node.js 24 (see `.nvmrc` and `package.json`)
- npm
- Docker with the Compose plugin to run the recommended database-backed test workflow
- Local PostgreSQL and Redis for application development
- A local RS256 key pair and a `CSRF_SECRET`

## Local development

1. Install the Node version in `.nvmrc`, then install the locked dependencies:

   ```sh
   nvm use
   npm ci --legacy-peer-deps
   ```

2. Create a local environment file from the current template:

   ```sh
   cp .env.example .env.local
   ```

   Configure `DATABASE_URL` to a **disposable, separately provisioned local
   development database** and `REDIS_URL` to a local Redis service. Do not point a
   first-time setup at a shared or existing `workforce` database.

3. Configure exactly one complete JWT key source in `.env.local`: either
   `JWT_PRIVATE_KEY_FILE` plus `JWT_PUBLIC_KEY_FILE`, or the corresponding
   `JWT_PRIVATE_KEY_B64` and `JWT_PUBLIC_KEY_B64` pair. Keys must be matching RSA
   keys of at least 2048 bits. Keep private material outside version control; the
   repository ignores `secrets/` and key files. Set `CSRF_SECRET` to a fresh random
   value of at least 32 bytes. The comments in `.env.example` give generation
   commands; do not paste generated values into tracked files.

4. Start the development server once the database already has the expected schema
   and PostgreSQL and Redis are reachable:

   ```sh
   npm run dev
   ```

   The launcher validates the CSRF secret and JWT keys before starting Next.js.
   The repository does not currently provide a reviewed, safe first-run database
   bootstrap procedure. **Do not run schema push or migration commands against an
   existing `workforce` database.** The historical migration discrepancy must be
   reconciled before documenting database initialization; see
   [Database and migration state](./ARCHITECTURE.md#postgresql-and-migration-state).

The root `docker-compose.yml` is a development stack, not a production deployment
template. It uses persistent volumes, publishes database and Redis ports, and has
development defaults. It also expects JWT key files at the paths declared in that
Compose file. Inspect the configuration and ensure any existing local services or
volumes are understood before using it.

Supabase-era environment templates and the unused feature-flag module have been
removed; they were not part of the active configuration. Use `.env.example`.

## npm commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the validated local Next.js development server |
| `npm run build` | Create a production Next.js build |
| `npm start` | Serve a previously built application |
| `npm run lint` | Run the configured Next.js lint command |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm test` | Run Vitest directly; database suites require the explicit safety guard environment |
| `npm run test:integration:safe` | Run database-backed tests and quality checks with disposable isolated services |
| `npm run test:ui` | Open the Vitest UI; this is not a substitute for the isolated database workflow |
| `npm run check:frontend-boundaries` | Check frontend/backend import boundaries |

Prefer `npm run test:integration:safe` for database-backed tests. It requires Node 24
and Docker/Compose, creates disposable PostgreSQL and Redis services on a private
internal network, uses tmpfs storage, verifies the live database identity, checks
fixture tables, and cleans up its uniquely named resources. It does not use the
development or production database. Do not run `npm test` or `npm run test:ui`
against a shared database; direct Vitest execution is guarded and requires a
verified local `workforce_test` target. Full details are in the
[isolated test guide](./docs/testing/isolated-integration-tests.md).

## Troubleshooting

- **Startup rejects `CSRF_SECRET` or JWT keys:** configure a complete key pair and a
  random CSRF secret of at least 32 bytes. Do not use a tracked or shared secret.
- **PostgreSQL or Redis connection errors:** verify the local service is running and
  that `.env.local` points to the intended disposable development services.
- **Database schema is missing or differs:** stop before running any migration or
  schema-push operation. Review the unresolved history in
  [ARCHITECTURE.md](./ARCHITECTURE.md#postgresql-and-migration-state) and get the
  database owner to confirm a safe bootstrap/upgrade target.
- **Safe tests cannot start:** check Node 24, Docker, and the Compose plugin; follow
  the [safe-test guide](./docs/testing/isolated-integration-tests.md). Do not work
  around the database identity guard.
- **A screen shows sample data:** this is expected for several unfinished UI
  workflows; consult the implementation status in
  [ARCHITECTURE.md](./ARCHITECTURE.md#current-limitations-and-deployment-readiness).

## Project documents

- [Technical architecture and security contracts](./ARCHITECTURE.md)
- [Safe isolated integration testing](./docs/testing/isolated-integration-tests.md)
- [Historical plans and handoff](./docs/superpowers/plans/2026-10-18-workforce-mvp-migration.md),
  [Phase 3 fixes](./docs/superpowers/plans/2026-10-19-phase3-fixes.md),
  [Phase 5 notifications/audit](./docs/superpowers/plans/2026-10-20-phase5-notifications-audit.md),
  and [workforce handoff](./workforce-handoff.md) are retained as historical records,
  not current implementation specifications.

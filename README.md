# Workforce MVP

Workforce MVP is a localized workforce-scheduling application built with Next.js,
PostgreSQL, and Redis. It includes employee and administrator workflows for
authentication, shift browsing and management, applications, and assignments.
Administrator, employee, and attendance pages require a valid server-side session
and the appropriate role. Employee schedules, dashboards, and attendance use real
backend data. The core publish/apply/approve/schedule/check-in/out workflow has
been verified in the guarded disposable environment. See the
[current architecture](./docs/architecture.md) for the verified feature status.

## Requirements

- Node.js 24 and npm
- PostgreSQL and Redis for local application development
- A configured RS256 JWT key pair and `CSRF_SECRET`

See [.env.example](./.env.example) for the environment variables and
[architecture security notes](./docs/architecture.md#authentication-and-security-contracts).
Never put production credentials in tracked files.

## Setup and local development

```sh
npm ci
```

Copy `.env.example` to `.env.local`, configure the local PostgreSQL/Redis services,
JWT keys and CSRF secret, then start:

```sh
npm run dev
```

Do not run schema push or migration commands against an existing `workforce`
database. For a newly provisioned empty database, follow the
[database bootstrap and recovery runbook](./docs/operations/database-bootstrap-and-recovery.md).
Existing databases require schema/ledger classification and a verified backup
and restore rehearsal before migration.

## Safe checks

Run database-free tests and static checks:

```sh
npm test
npm run typecheck
npm run lint
npm run check:frontend-boundaries
```

Database-backed tests must use the guarded isolated workflow; never point test
commands directly at a development or production database:

```sh
npm run test:integration:safe
```

The optional production-browser run also starts Docker and builds the application,
so run it separately from other heavy workloads. Monitor resource use as a warning,
not a fixed launch gate: high CPU or RAM usage alone does not cancel a functioning run.

```sh
npm run test:integration:safe -- --browser
```

See the [isolated integration-test guide](./docs/testing/isolated-integration-tests.md)
for isolation details and the [documentation index](./docs/README.md) for the
architecture, roadmap, and historical records.

## Production preparation

The [production runtime guide](./docs/operations/production-runtime.md) describes
the single-instance production Compose template, host HTTPS proxy, external
private PostgreSQL/Redis, and runtime secrets. Hosting, ingress/TLS, credentials,
and target-database readiness still require operator decisions and verification;
the templates are not a deployment or launch approval.

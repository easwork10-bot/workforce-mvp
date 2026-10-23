# Workforce MVP

Workforce MVP is a Next.js workforce-scheduling application with PostgreSQL and
Redis-backed services. The employee shift browser, login, and registration are
connected; several other screens remain prototypes. See the
[documentation index](./docs/README.md) for verified architecture, setup, testing,
security, database, operations, and historical records.

## Quick start

- Use Node.js 24 and npm.
- Install dependencies with `npm ci --legacy-peer-deps`.
- Copy `.env.example` to `.env.local` and configure local services and secrets as
  described in the [environment template](./.env.example) and
  [security notes](./docs/architecture.md#authentication-and-security-contracts).
- Start the app with `npm run dev`.

Do not run schema push or migration commands against an existing `workforce`
database. The migration history is unresolved; see
[database and migration state](./docs/architecture.md#postgresql-and-migration-state).

## Common commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the validated local development server |
| `npm test` | Run database-free unit tests |
| `npm run test:integration:safe` | Run database-backed tests on disposable isolated services |
| `npm run typecheck` | Run the TypeScript check |
| `npm run lint` | Run the configured lint command |
| `npm run build` | Create a production build |

Use only `npm run test:integration:safe` for database-backed tests. It verifies the
disposable database identity and does not use the development or production
database. See the [testing guide](./docs/testing/isolated-integration-tests.md).

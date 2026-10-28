# Isolated integration tests

Run the PostgreSQL-backed test suite without using the development or production database:

```sh
npm run test:integration:safe
```

For database-free unit tests, use `npm test` or `npm run test:ui`. Both select only
`tests/unit/` and require neither PostgreSQL nor Redis. The separate
`vitest.integration.config.ts` includes unit and integration suites and enforces the
database identity guard before tests; do not invoke that configuration directly.

The command requires Node.js 24, Docker, and Docker Compose. It starts a uniquely named
project containing only PostgreSQL and Redis. The services use a private internal
network, tmpfs-only data directories, generated database credentials, and no published
host ports. On Windows, the runner first installs a Linux-compatible copy of the
locked dependencies in a uniquely created OS temporary directory; the dependency
container does not join the test network and receives no project environment file or
database credentials. A temporary Node.js 24 worker then mounts those dependencies
read-only and joins only the internal test network. Inside
the worker, short-lived proxies bind dynamically assigned ports to `127.0.0.1`; the
existing database safety guard verifies the live PostgreSQL container address and
server port through that loopback endpoint before initializing the empty
`workforce_test` database.

The runner is implemented in
[`scripts/test-integration-safe.mjs`](../../scripts/test-integration-safe.mjs) and
[`scripts/run-isolated-integration-tests.mjs`](../../scripts/run-isolated-integration-tests.mjs).
The integration configuration is
[`vitest.integration.config.ts`](../../vitest.integration.config.ts); its
[database safety guard](../../tests/support/database/testDatabaseSafety.ts) verifies
the live endpoint before tests run.

The workflow applies only the journaled Drizzle migrations to the verified-empty
disposable database; it never uses `drizzle-kit push`. It runs focused
safety/auth/business tests and the complete unit plus
integration suite using the guarded integration configuration, then typecheck,
lint, and the frontend import-boundary check. It verifies the protected fixture tables
are empty before and after each test pass, then removes only the unique Compose project
created for that run after rechecking container and network ownership. Worker cleanup
also verifies its exact generated name, run label, and network before removing it.
The production build runs after service cleanup, outside the internal network, because
Next.js fetches Google Fonts during builds. Its database and Redis URLs point to
unavailable loopback port `1`, so that phase cannot connect to a host or persistent
service. No existing database or persistent Docker volume is started, migrated, or
removed.

On Windows, use Docker Desktop with its local Linux-container context selected. The
runner accepts only local Unix sockets and the standard local Docker Desktop named
pipes; it rejects TCP/SSH and other remote Docker endpoints. It checks for resources
carrying its newly generated project label before starting Compose. Run it from
PowerShell with:

```powershell
npm run test:integration:safe
```

The random project name, internal network, tmpfs-only storage, generated password,
and absence of host port bindings are required safety properties; do not replace
them with a shared project name, persistent volume, or host-published database port.

Do not run the schema initialization command independently against an existing database.
The disposable database is initialized from the journaled migration chain by the safe
runner only after its identity and empty state have been verified.

## Drizzle migration configuration

`drizzle.config.ts` loads the repository's Next.js environment files and requires an
explicit, valid `DATABASE_URL`; application runtime connections enforce the same
requirement, with no implicit PostgreSQL/localhost fallback. Redis connections also
require an explicit `REDIS_URL`. Authentication rate limiting fails closed and returns
HTTP 503 when Redis is unavailable. Production auth rate limits use only the trusted
framework-provided client IP; configure the hosting adapter to populate it. The app
does not trust `X-Forwarded-For` or `X-Real-IP` directly. Before any manual
`drizzle-kit migrate` command, inspect the resolved target and use a disposable
database unless the target database has been explicitly reviewed and backed up.
Do not run a migration command with an unset URL or against the persistent development
database as a substitute for migration-chain verification.

Only entries in `drizzle/meta/_journal.json` are part of the current migration chain.
`drizzle/0000_melodic_spectrum.sql` is an unjournaled legacy file; do not apply it
manually or rename/delete it as part of routine migration execution.

## Controlled Jofra email delivery

Automated tests mock Resend and never deliver email. A manual delivery check requires
owner approval of the recipient, a Resend API key and verified sender domain supplied
through server-only environment variables, and `JOFRA_FORMS_TO` set to the explicitly
approved test mailbox. Set `JOFRA_PUBLIC_ORIGINS` to the exact test-site origin and
confirm Redis is healthy before submitting a single synthetic inquiry. Do not use
real applicant or customer data. Restore the intended production recipient only after
the test is complete; do not put any API key in source control.

# Isolated integration tests

Run the PostgreSQL-backed test suite without using the development or production database:

```sh
npm run test:integration:safe
```

To also verify the assignments overview against real PostgreSQL/Redis and run
production Chromium/WebKit UI regressions, use:

```sh
npm run test:integration:safe -- --browser
```

`npm run test:integration -- --browser` is an equivalent alias for the same
guarded runner.

For lightweight checks, run these commands sequentially:

```sh
npm run test -- tests/unit/security/session-security.test.ts
npm run typecheck
npm run lint
npm run check:frontend-boundaries
```

The employee account PATCH regression is an integration test and must be run via
the guarded database workflow; do not invoke the integration Vitest config directly.
The `--browser` option adds the production build and Chromium/WebKit checks and
requires Docker.

## Resource monitoring and failure conditions

The runner has no minimum available-RAM requirement, CPU/RAM percentage gate, or
automatic cancellation based on resource usage. On a 16 GB Windows computer,
Task Manager and `docker stats --no-stream` can help observe resource pressure;
temporary 100% CPU usage or high RAM usage is a warning, not proof of failure.
Run one heavy build/test workflow at a time and let it continue while it makes
progress. Child output is buffered until a command finishes, so a long or quiet
stage alone does not establish a hang.

Keep `experimental.cpus: 1` in [`next.config.js`](../../next.config.js): the
production build has been verified with this reduced build-worker parallelism.
Playwright uses one worker, Vitest disables file parallelism, and workflow stages
are awaited sequentially. The PostgreSQL 512 MiB and Redis 64 MiB tmpfs sizes cap
their disposable data directories; they are not process-memory limits or host
memory-headroom requirements.

Nonzero process exits, Docker failures, and existing service-startup, connection,
test and hook timeouts remain failure conditions. There is no whole-workflow
resource watchdog. If there is confirmed out-of-memory termination, persistent
unresponsiveness or severe sustained paging, a genuine hang, or unsafe effects on
unrelated services, stop the run rather than repeatedly retrying it. For a
responsive launcher, cancel with SIGINT/SIGTERM and allow its ownership-checked
cleanup to finish. Abruptly killing the launcher or an OS out-of-memory kill cannot
guarantee cleanup; cleanup errors are reported, and any remaining resources must
be checked for ownership before removal. Never use global Docker cleanup commands.

## Database safety and isolation guarantees

The opt-in phase builds a uniquely labelled temporary browser image using the
locked Playwright version. Tooling installation has no repository, environment
file or database credentials. A curated temporary source copy excludes environment
files, secrets and prior test artifacts; its Linux production build runs before
database startup, with database/Redis URLs pointing to unavailable loopback port 1.
Fresh ephemeral JWT keys are used, never development keys. The production server,
HTTPS loopback listener and both browsers subsequently run inside the same isolated
worker as the database safety guard. No host ports are published. The test-local
HTTPS listener replaces incoming client-IP headers with the actual socket address,
using the existing trusted-proxy configuration; secure authentication cookies,
real password verification, Redis sessions and CSRF remain enabled.
The production Next.js request handler and locale rewrites share that same HTTPS
origin; there is no HTTP upstream whose port could be mistaken for a TLS endpoint.
That origin uses `localhost`, which matches Next.js's canonical loopback URL;
Node DNS prefers IPv4 to reach the IPv4-only listener without a hostname mismatch.
The server process trusts only its generated certificate in addition to Node's
normal CA roots, allowing internal locale rewrites without disabling TLS verification.

The guarded browser phase runs
[`tests/real-backend/admin-assignments.spec.ts`](../../tests/real-backend/admin-assignments.spec.ts)
and [`tests/e2e/`](../../tests/e2e/) against the same production server in both
browser engines. The real-backend spec does not intercept assignment or auth APIs;
the separate UI regression specs stub their documented API responses. The config
and server require the safe worker, and fixture writes recheck the live pinned
database identity. Real-backend tests create disposable accounts/roles, use real
login/create/publish/apply/approve/cancel APIs, and compare rendered data with
PostgreSQL. Confirmed/completed/cancelled historical rows are synthetic fixtures,
not an invented completion business flow. Scenarios cover all statuses,
pagination, history, Dutch/Arabic, RTL, 390/768/1280px, access denial, changes and
empty results. Date assertions use each browser's native locale formatter with
the PostgreSQL timestamps and the explicit Europe/Amsterdam time zone, avoiding
Node/WebKit ICU punctuation differences without relaxing date correctness.
The lifecycle runs as named serial tests sharing disposable fixtures and a real
authenticated browser context per engine. Approval, listing, fixture history,
each locale's filtering/layout checks, authorization, cancellation, record changes
and session revocation retain separate default test budgets rather than sharing
one oversized end-to-end timeout. A failed stage skips dependent stages; suite
cleanup still runs. Cancellation is submitted through the confirmation dialog,
including its real CSRF request, and checks assignment/application history,
capacity reopening and the existing idempotent notification in PostgreSQL.
Fixture-specific SQL and Redis cleanup precede the worker's
protected-table emptiness check. The launcher removes its ownership-checked
browser image and temporary source/dependencies along with the disposable worker,
PostgreSQL, Redis and network. Failure traces/screenshots are kept under
`tests/results/real-backend/`; never run this config directly on development data.

For database-free unit tests, use `npm test` or `npm run test:ui`. Both select only
`tests/unit/` and require neither PostgreSQL nor Redis. The separate
`vitest.integration.config.ts` includes unit and integration suites and enforces the
database identity guard before tests; do not invoke that configuration directly.

The command requires Node.js 24, Docker, and Docker Compose. It starts a uniquely named
project containing only PostgreSQL and Redis. The services use a private internal
network, tmpfs-only data directories, generated database credentials, and no published
host ports. A temporary Node.js 24 worker joins that network to run the checks. Inside
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

The workflow runs focused safety/auth/business tests and the complete unit plus
integration suite using the guarded integration configuration, then typecheck,
lint, and the frontend import-boundary check. It verifies the protected fixture tables
are empty before and after each test pass, then removes only the unique Compose project
created for that run. For non-browser runs, the production build runs after service
cleanup, outside the internal network, because Next.js fetches Google Fonts during
builds. Browser runs already build the curated production app before starting
services, so they omit a redundant second build. The launcher handles SIGINT/SIGTERM
by stopping its active worker command and then running ownership-checked cleanup; a
signal received during cleanup is recorded while cleanup is allowed to finish. No
existing database or persistent Docker volume is started, migrated, or removed.

Do not run the schema initialization command independently against an existing database.
The disposable database is initialized by the safe runner only after its identity and
empty state have been verified.

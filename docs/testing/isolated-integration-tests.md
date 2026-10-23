# Isolated integration tests

Run the PostgreSQL-backed test suite without using the development or production database:

```sh
npm run test:integration:safe
```

The command requires Node.js 24, Docker, and Docker Compose. It starts a uniquely named
project containing only PostgreSQL and Redis. The services use a private internal
network, tmpfs-only data directories, generated database credentials, and no published
host ports. A temporary Node.js 24 worker joins that network to run the checks. Inside
the worker, short-lived proxies bind dynamically assigned ports to `127.0.0.1`; the
existing database safety guard verifies the live PostgreSQL container address and
server port through that loopback endpoint before initializing the empty
`workforce_test` database.

The workflow runs focused safety/auth/business tests, the full Vitest suite, typecheck,
lint, and the frontend import-boundary check. It verifies the protected fixture tables
are empty before and after each test pass, then removes only the unique Compose project
created for that run. The production build runs after service cleanup, outside the
internal network, because Next.js fetches Google Fonts during builds. No existing
database or persistent Docker volume is started, migrated, or removed.

Do not run the schema initialization command independently against an existing database.
The disposable database is initialized by the safe runner only after its identity and
empty state have been verified.

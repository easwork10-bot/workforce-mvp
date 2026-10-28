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
- Configure a strong `CSRF_SECRET`, a matching RSA JWT key pair, and a
  `WORKFORCE_DEV_DB_PASSWORD`. Keep the Compose JWT files in the ignored `secrets`
  directory; do not commit them.
- Start the host app with `npm run dev`. The launcher loads `.env.local` before
  validating the security configuration. Host processes use loopback service URLs;
  the Compose app uses `db:5432` and `redis:6379` inside its private project network.

Generate local JWT files on Windows without printing key material:

```powershell
New-Item -ItemType Directory -Force .\secrets | Out-Null
node -e "const fs=require('node:fs');const path=require('node:path');const {generateKeyPairSync}=require('node:crypto');const pair=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});fs.writeFileSync(path.join('secrets','jwt_private_key.pem'),pair.privateKey,{mode:0o600});fs.writeFileSync(path.join('secrets','jwt_public_key.pem'),pair.publicKey,{mode:0o644});"
```

Keep the `.env.local` entries for `JWT_PRIVATE_KEY_FILE` and
`JWT_PUBLIC_KEY_FILE` set to the relative paths in `.env.example`. The keys and
`.env.local` are ignored by Git; ensure the Windows ACL on the `secrets` directory
does not grant access to unintended users.

On Windows, validate Compose interpolation without starting services:

```powershell
docker compose --env-file .env.local config --quiet
```

The Compose services bind only to `127.0.0.1`; PostgreSQL defaults to host port
`5433` to avoid the Windows PostgreSQL service on `5432`, and Redis defaults to
`6380`. These host ports are configurable with `WORKFORCE_DEV_POSTGRES_PORT`,
`WORKFORCE_DEV_REDIS_PORT`, and `WORKFORCE_DEV_APP_PORT`.

The root Compose file intentionally keeps its existing directory-derived project
name and `pgdata`/`redisdata` volume declarations. Before starting it on a machine
with prior Compose data, inspect the existing project and volume names and confirm
they match the configuration. Do not change the project name, delete volumes, or
start against an existing volume until its identity and PostgreSQL credentials are
known. PostgreSQL does not update the password of an already initialized data volume
when `POSTGRES_PASSWORD` changes.

With Docker Desktop running, inspect (do not start) the current Compose project and
its labeled volumes first:

```powershell
docker compose --env-file .env.local ps -a
docker volume ls --filter label=com.docker.compose.project=work-force
```

`docker compose ... config --format json` currently resolves the local project name
to `work-force` and the volume names to `work-force_pgdata` and
`work-force_redisdata`. That is the configuration-derived identity, not proof that
those volumes exist or contain the expected database. If the directory-derived
project name has changed on the machine, stop and identify the existing volumes
before using any `-p` override.

Only after the project/volume identity, PostgreSQL credentials, and port bindings
have been checked should local Compose services be started:

```powershell
docker compose --env-file .env.local up --build
```

The smoke Compose file requires a unique project name for every run and uses only an
internal network and tmpfs service storage. It does not publish ports or use the
development volumes.

The Windows `work-force` development database has been initialized from the
journaled Drizzle migrations after its Docker ownership, loopback endpoint, identity,
and empty state were verified. Do not use `drizzle-kit push` or apply the unjournaled
`0000_melodic_spectrum.sql`. For another existing database, verify its identity,
schema, and migration ledger and back it up before considering `drizzle-kit migrate`.
See [database and migration state](./docs/architecture.md#postgresql-and-migration-state).

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

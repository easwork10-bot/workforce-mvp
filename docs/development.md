# Development and safe operations

Start at the [root README](../README.md). This guide applies on Windows and Linux.
Database identity and service ownership are machine-specific; do not copy a
previous machine's state claims into a new environment.

## Prerequisites and checkout

Use Node.js 24, npm, Git, and Docker Compose v2 with a local Linux-container daemon
for integration tests. Windows normally uses Docker Desktop. Linux uses a local
Unix socket. The isolated test runner refuses TCP/SSH Docker endpoints.

Check branch and worktree before editing:

```text
git status --short --branch
git rev-parse HEAD
git remote -v
npm ci --legacy-peer-deps
```

The development branch is `jofra-showcase`. Do not change `main` or overwrite
uncommitted work. Native dependencies such as Argon2 and browser binaries are
OS-specific: install from the lockfile on each OS, not by copying `node_modules`.

### Environment file

Windows PowerShell (from the checkout):

```powershell
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Linux shell:

```sh
test -e .env.local || cp .env.example .env.local
chmod 600 .env.local
```

The [environment template](../.env.example) contains names and explanations, not
working secrets. Next.js and the development launcher load `.env.local`.
Compose requires `--env-file .env.local`. Do not print the resolved Compose
configuration containing secret values; use `config --quiet`.

## Configuration contract

| Names | Purpose |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Explicit backend endpoints, no implicit localhost database fallback |
| `WORKFORCE_DEV_DB_PASSWORD` | Password for a **new** dedicated development PostgreSQL volume; existing volumes retain their initialized password |
| `WORKFORCE_DEV_POSTGRES_PORT`, `WORKFORCE_DEV_REDIS_PORT`, `WORKFORCE_DEV_APP_PORT` | Loopback host ports, defaults 5433 / 6380 / 3000 |
| `WORKFORCE_SECRETS_DIR` | Host directory mounted as Compose secret files |
| `JWT_PRIVATE_KEY_FILE`, `JWT_PUBLIC_KEY_FILE` | Matching RSA key files (preferred explicit source) |
| `JWT_PRIVATE_KEY_B64`, `JWT_PUBLIC_KEY_B64` | Alternative complete key pair; do not mix with file configuration |
| `CSRF_SECRET` | Random signing secret of at least 32 bytes |
| `RESEND_API_KEY`, `JOFRA_FORMS_FROM`, `JOFRA_FORMS_TO` | Server-only email configuration |
| `JOFRA_PUBLIC_ORIGINS`, `TRUSTED_CLIENT_IP_HEADER` | Exact allowed form origins and optional proxy-overwritten IP header |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BASE_PATH` | Public canonical origin and static prefix, never secrets |
| `ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM` | Password hashing costs |
| `SHIFT_REMINDER_JOB_ENABLED` | Opt-in production reminder scheduler |

Generate a new key pair only when no approved pair exists. The following works
with Node on both systems and refuses to replace either existing key:

```sh
node -e "const fs=require('node:fs');const a='secrets/jwt_private_key.pem',b='secrets/jwt_public_key.pem';if(fs.existsSync(a)||fs.existsSync(b))throw Error('Existing keys: stop and inspect');fs.mkdirSync('secrets',{recursive:true,mode:0o700});const k=require('node:crypto').generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});fs.writeFileSync(a,k.privateKey,{flag:'wx',mode:0o600});fs.writeFileSync(b,k.publicKey,{flag:'wx',mode:0o644});"
```

Linux file modes do not replace Windows ACL review. Limit access to the ignored
`secrets` directory and `.env.local`; never store private keys in documentation.
Provision `CSRF_SECRET` using a cryptographically secure secret generator.

## Identify services before starting anything

The root [Compose file](../docker-compose.yml) is development-only. It uses
directory-derived project names and persistent `pgdata`/`redisdata` volumes.
Changing directories or OS can silently select a different project/volume.
The reviewed Windows checkout previously resolved to `work-force`, with
`work-force_pgdata` and `work-force_redisdata`; **reverify**, do not assume.

Read-only inspection:

```sh
docker context show
docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local ps -a
docker volume ls --filter label=com.docker.compose.project=work-force
```

Use a project label confirmed for this machine instead of blindly using
`work-force` on Linux. Inspect resource labels, mounts and host port bindings
without dumping credential-bearing container environments. Confirm PostgreSQL
database/user identity, schema and migration ledger read-only before any write.

Do not use native Windows PostgreSQL on 5432, unrelated FlyttSignal/Trafikverket
resources, or preserved Linux Workforce volumes for this development workflow.
The dedicated Windows host endpoint defaults to loopback 5433; Redis uses 6380.
Host Node uses loopback URLs. Containers use `db:5432` and `redis:6379` internally.
Port numbers alone are not proof of ownership.

Only after explicit ownership, credential and endpoint verification, local
services may be started with `docker compose --env-file .env.local up --build`.
Then use `npm run dev` for a host Next.js process (avoid starting two app servers
on the same port). Never delete/reset volumes to resolve a password mismatch.

## Database changes

Follow [testing and migrations](./testing/isolated-integration-tests.md).
The Windows dedicated development database was initialized in an earlier reviewed
task; that does not authorize migration of any other database. No startup or
Docker build automatically applies migrations. Back up existing data and obtain
target-specific approval before considering persistent migrations.

## Handoff between machines

Record without secrets:

1. Repository remote, branch, HEAD, worktree/staged status and pending owner review.
2. Node/npm versions and checks actually run on this OS.
3. Verified Docker context/project, mounts, service identities and loopback ports.
4. Which migration tags/hashes the read-only ledger reports; note inaccessible
   systems rather than treating an incomplete comparison as parity.
5. Environment **names** configured, key provisioning source and missing services.
6. Whether tests used mocks, disposable services or actual approved email delivery.
7. Visual QA browser engines/viewports and remaining physical-device checks.

Do not transfer environment files, databases or private keys as part of a routine
source handoff. Do not change SSH configuration or Linux resources to make a
comparison succeed. Existing approved SSH identities can be reused read-only.

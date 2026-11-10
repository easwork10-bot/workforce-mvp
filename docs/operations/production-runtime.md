# Minimal production runtime

Prepared topology: **one existing Docker `runner` image**, a host HTTPS reverse
proxy, and external PostgreSQL/Redis services on private networks. This is a
deployment template, not an installed environment or launch approval.

## Runtime configuration

Use `docker-compose.production.yml` by itself, never combined with the
development Compose file. It has no database or Redis service, development
password, source bind mount, or public application listener. The only published
application address is `127.0.0.1:3000`. Use a supported Docker Engine with
loopback-publishing isolation (28 or later); additionally deny port 3000 in the
host/cloud firewall. Never change that binding to `0.0.0.0`.

Build the existing image's `runner` target from the reviewed release, without
runtime secrets as build arguments. Its `.dockerignore` excludes environment
files and keys. Set `WORKFORCE_IMAGE` to the reviewed tag, preferably a pinned
digest. Compose runs its non-root user on a read-only filesystem with bounded
temporary cache storage, dropped capabilities, and no privilege escalation.
Keep one instance: the in-process reminder job is enabled and is not a
distributed scheduler.

Inject these variables from the host secret manager or an operator-protected
environment file **outside the checkout and Docker build context**:

| Variable | Required production value |
|---|---|
| `WORKFORCE_IMAGE` | Reviewed `runner` image tag/digest |
| `DATABASE_URL` | Explicit PostgreSQL database and credentials, private endpoint |
| `REDIS_URL` | Explicit Redis URL and credentials, private endpoint |
| `JWT_PRIVATE_KEY_B64` | Base64 PKCS#8 RSA private PEM, at least 2048 bits |
| `JWT_PUBLIC_KEY_B64` | Matching base64 SPKI public PEM |
| `CSRF_SECRET` | Unique cryptographically random secret, at least 32 bytes |

Use new production credentials, never the development Compose values, test keys
or repository-local keys. JWT file variables must not be mixed with the base64
pair. Both key validity and CSRF strength are checked before runtime startup;
missing/invalid database or Redis URLs also refuse production startup. Nothing
automatically runs migrations at startup.

External PostgreSQL must use certificate-verified TLS
(`sslmode=verify-full`), and external Redis must use `rediss://` with certificate
verification. Do not use `sslmode=no-verify`, `rejectUnauthorized=false`, or
`NODE_TLS_REJECT_UNAUTHORIZED=0`. Private plaintext URLs remain technically
accepted for isolated testing/private transports; startup URL validation does
not prove encryption or network privacy. If a provider uses a private CA,
mount its reviewed CA bundle and configure the provider's driver-supported CA
trust explicitly; test verification failure as well as success. Do not expose
either service to the public Internet. Use a least-privilege app account and a
separate operator migration account; enable provider backups and Redis
persistence/no-eviction suitable for sessions and rate limits.

Compose passes a fixed environment allowlist to the container; unrelated host
environment variables are not inherited. Keep the environment file readable
only by the operator, and limit Docker-daemon access because container
environment values are visible to daemon administrators. A hosting platform
may inject the same variables through its secret manager instead.

Validate without printing interpolated secrets:

```sh
docker compose --env-file /etc/workforce/runtime.env -f docker-compose.production.yml config --quiet
```

Starting this configuration is a separate, owner-authorized deployment action.
Do not use the development Compose file or publish PostgreSQL/Redis ports.

## HTTPS and proxy trust boundary

`deploy/nginx.conf.example` is an example for nginx **on the same host as
Docker, directly facing clients**. Replace the reserved `.invalid` domain and
certificate paths, provision/renew a valid certificate, validate with `nginx -t`,
and configure the host firewall before deployment. Only HTTPS and the HTTP-to-
HTTPS redirect are public. Keep the application listener accessible only to
that trusted proxy and host operators.

The proxy replaces, rather than appends, `X-Forwarded-For` and `X-Real-IP` with
its socket peer address. It fixes host/protocol/port headers to the approved
HTTPS origin and clears the arbitrary `Forwarded` header. The app accepts one
valid IPv4/IPv6 address, not client-supplied chains or arbitrary rate-limit
keys. Login, registration, refresh, and audit attribution use the same parser.
**The parser cannot authenticate the header sender**: the loopback binding,
firewall and overwriting proxy are required, not optional.

Do not use `$proxy_add_x_forwarded_for` or configure arbitrary `real_ip_header`
trust. For a CDN/load balancer in front of nginx, or a hosted application
platform, the provider must supply an authenticated/private ingress path and
an authoritative overwritten single-IP header. Review its trusted proxy
addresses and header contract before adapting this example. Do not simply
expose port 3000 to make an external load balancer reach it.

`NODE_ENV=production` keeps access/refresh/CSRF cookies Secure and HttpOnly,
with their existing SameSite and path restrictions. No wildcard CORS is
enabled; serve the UI and APIs on the same HTTPS origin. Do not relax cookies,
CSRF, or session validation to work around an HTTP deployment.

## Startup, probes and logs

- `/api/live` checks that the Next.js HTTP process is responsive without
  depending on PostgreSQL or Redis.
- `/api/health` is uncached readiness: a bounded PostgreSQL query and an actual,
  bounded Redis `PING` must succeed; failure returns 503. It does not certify
  that the schema has been migrated. Complete the database runbook first.
- The Compose healthcheck uses readiness. Docker marks failures unhealthy but
  does **not** automatically restart an unhealthy running process. The restart
  policy covers process exits. Arrange host/platform alerting and stop routing
  traffic while unready; do not make a dependency outage an infinite restart
  loop.
- The sample proxy hides the exact probe endpoints from public clients.
  Configure internal platform probes over the private/loopback interface.
- Production builds retain `console.error` and `console.warn`. Startup,
  dependency and existing application error handlers write to stdout/stderr;
  Compose bounds local log rotation. Logs are operationally sensitive: restrict
  access, set retention, and avoid forwarding bodies, tokens, cookies,
  connection URLs or employee details. Review/redact application and proxy
  error records before sending them to any external logging service. nginx
  access logging is disabled in this minimal template.

## Verification and remaining provider decisions

The guarded command below runs focused security/startup/configuration tests,
the existing migration checks, a build/smoke check of the actual production
Docker target, and a synthetic database backup/restore. It publishes no ports,
uses temporary keys and tmpfs PostgreSQL/Redis only, and removes only its owned
resources:

```sh
npm run test:integration:safe -- --focus=employee-dashboard --production --recovery
```

The image smoke check runs non-root/read-only with PostgreSQL and Redis on the
internal test network; it checks liveness, readiness, unauthenticated access
denial and Secure/HttpOnly CSRF cookies. It does not validate a real domain,
certificate, nginx installation, public firewall or provider-managed TLS.

Delivery 9C verification (2026-11-09): standalone Compose validation, 142
guarded focused unit/integration/security checks, typecheck, lint, frontend
boundaries, the actual `runner` image build/startup smoke check and synthetic
backup/restore all passed. Temporary containers, network and test image were
removed. The full browser suite was not rerun, and no existing database or live
infrastructure was accessed.

Before launch the owner still needs to choose the host/platform, domain and
certificate renewal, private database/Redis endpoints and CA trust, firewall/
ingress restrictions, secrets provisioning/rotation, backup storage/retention
and recovery targets, and readiness alerts. Classify any existing database and
rehearse its particular upgrade before migration. No existing database's state
is inferred by the disposable tests. See
[database bootstrap and recovery](./database-bootstrap-and-recovery.md).

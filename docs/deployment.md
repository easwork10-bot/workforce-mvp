# Deployment and CI/CD

See the [root README](../README.md) for setup and current scope.

## Two output targets, one authoritative frontend

| Target | Build/output | Available functionality |
|---|---|---|
| Node-capable deployment | `npm run build`; Next.js standalone output in `.next/standalone` | Public UI, API routes, auth, database/Redis integrations and configured email |
| GitHub Pages | `npm run build:jofra-pages`; static `out/` | Public Jofra UI only; disabled form previews and phone/email links |

[`scripts/jofra-pages/`](../scripts/jofra-pages/) is a build adapter, not another
Next.js application. Vite compiles the shared Jofra components/CSS/fonts; React
renders each route to HTML and hydrates it. Narrow adapters provide translation,
pathname and image rendering for the public components. In particular image
`fill` must preserve absolute positioning and container dimensions from Next.js.
Do not add independent page copy/design here or reintroduce a showcase app.
The shared Jofra stylesheet explicitly owns its base typography and container
spacing so Workforce/Tailwind globals cannot narrow the Node version relative
to Pages. Browser regressions compare image dimensions across both builds.
The Why Jofra and process photographs sit beside their section headings on wider
screens and between the heading and details on phones. Their shared grid owns
this reading order; keep the process SVG attached to its step list when changing
photo placement.

Public photographs use the shared `JofraPhoto` component with pre-encoded WebP
files and width-descriptor `srcset`/`sizes` in both output targets. Original-size
files retain source dimensions; 480px and (where useful) 960px candidates reduce
mobile transfers without changing CSS framing. The 472px-wide process photograph
has no smaller derivative. Hero loading is eager/high-priority; other photographs
are lazy and asynchronously decoded. Logos remain PNG and SVG artwork is unchanged.
No runtime image service is needed on Pages. When replacing a photograph, update
its candidate widths and files together, check image fidelity and run the static
verifier/browser suite; do not generate or commit unused variants.

The builder copies only `public/jofra/assets` and emits nine routes: canonical
Dutch home/inquiry/recruitment, Arabic equivalents, and legacy `/nl/` compatibility
files. Shared navigation never targets `/nl/`. Language switching preserves the
corresponding page. Default Pages prefix is `/workforce-mvp`; canonical origin
defaults to `https://easwork10-bot.github.io`. Override only the public
`NEXT_PUBLIC_BASE_PATH` and `NEXT_PUBLIC_APP_URL` for another static host.

Local static verification:

```sh
npm run build:jofra-pages
node scripts/verify-jofra-pages-export.mjs out
node scripts/serve-jofra-export.mjs
```

The last command serves loopback port 4173 at `/workforce-mvp/`; stop it when done.
No database, Redis or email credentials are needed. Do not publish `.env.local`,
keys or the entire checkout as a Pages artifact.

## GitHub Actions

The [Pages workflow](../.github/workflows/jofra-showcase-pages.yml) runs on pushes
to `jofra-showcase` and manual `workflow_dispatch`:

1. Quality: locked dependency install, typecheck, lint, unit tests, frontend
   boundary check, main Next.js production build with unavailable service URLs.
2. Build Pages after quality succeeds: static build and route/asset verifier.
3. Deploy the `out/` artifact only on `jofra-showcase`.

The workflow does not currently run the Docker integration suite or Playwright.
Run both as appropriate locally before release; a successful CI build is not
visual or real-device evidence. Node-20 action runtime/runner image notices may
appear; distinguish these from failed checks.

**A push triggers deployment. Do not commit, push or manually dispatch a release
while owner review is pending.** After explicit approval, verify destination,
run checks, inspect staged files for secrets/unrelated changes, and use only a
normal non-force push to `jofra-showcase`. Do not touch `main`. Verify Actions
HEAD and the resulting live artifact instead of assuming a push was deployed.

### Showcase verification limitations

The October 2026 local review used Chromium and Windows Playwright WebKit at
desktop, tablet and phone-sized viewports. It did not use a physical iPhone,
macOS Safari or real-device network measurements. Physical-device checks remain
outstanding; browser emulation must not be reported as actual-device verification.
Windows WebKit displayed lighter Manrope variable-font headings than Chromium
despite the same computed weight. That observation remains unresolved and needs
comparison on actual Safari before claiming cross-device typography parity.

The safe integration runner's Docker Desktop Linux-daemon preflight was
unavailable during this review, before disposable resources were created.
Database integration tests are therefore not a passed release check. This
public-only release changes no backend behavior or persistent database resources.
Unit, browser and static checks do not replace integration or email-delivery
verification. Pages forms remain disabled regardless of those checks.

## Node runtime and operations

The [Dockerfile](../Dockerfile) has development, builder and non-root runner
stages. The runner serves standalone Next.js with copied public/static assets,
dependencies and journaled migrations. It does not initialize PostgreSQL.
The root [Compose configuration](../docker-compose.yml) is development, not a
production security template. Smoke Compose uses a unique project, internal
network and tmpfs; integration Compose is owned by the safe test runner.

Production needs approved HTTPS/proxy configuration, secrets, managed PostgreSQL
and Redis endpoints, backups/restore, migration procedure, monitoring and personal
data retention/access policy. Set `NEXT_PUBLIC_BASE_PATH` empty for the main app;
using the static prefix also selects disabled form previews. The Docker runner
enables the in-process reminder job; define single-instance ownership before
scaling replicas. See [architecture](./architecture.md#authentication-and-security-contracts)
for API authorization and session contracts.

## Public forms and controlled email

On Node, form submission requires Redis, a trusted client IP, allowed exact
`JOFRA_PUBLIC_ORIGINS`, and server-only `RESEND_API_KEY`, `JOFRA_FORMS_FROM`,
`JOFRA_FORMS_TO`. A self-hosted proxy must strip/overwrite any configured
`TRUSTED_CLIENT_IP_HEADER`; do not trust arbitrary forwarded headers.
Missing dependencies fail safely rather than reporting successful delivery.

On Pages, forms remain visibly disabled in Dutch and Arabic. Phone and mail links
are alternatives, not evidence that the site sent email. Automated tests mock
Resend and browser requests; accepted provider responses are not inbox-delivery
proof. A real check requires explicit approval of the test recipient, a verified
sender domain and one synthetic submission. Never use real customer/applicant
data for that test. Follow the [controlled test procedure](./testing/isolated-integration-tests.md#controlled-jofra-email-delivery).

# Workforce MVP and Jofra Verkeer

One Next.js 14 application serves the public Dutch/Arabic Jofra website and the
Workforce dashboard/API. PostgreSQL/Drizzle and Redis support the backend.
The employee shift browser, applications, login and registration are connected;
several dashboard screens are still prototypes.

## Start here

| Document | Responsibility |
|---|---|
| [Architecture](./docs/architecture.md) | Source ownership, routes, backend contracts and implemented functionality |
| [Development and safe operations](./docs/development.md) | Windows/Linux setup, environment, machine handoffs and database safety |
| [Testing and migrations](./docs/testing/isolated-integration-tests.md) | Isolated test resources, migration procedure and browser checks |
| [Deployment and CI/CD](./docs/deployment.md) | Static Pages versus Node runtime, quality gates and email limitations |
| [Roadmap](./docs/roadmap.md) | Outstanding product work and owner decisions, not claims of completion |

Use Node.js 24 ([`.nvmrc`](./.nvmrc)), then `npm ci --legacy-peer-deps`.
Copy [`.env.example`](./.env.example) to ignored `.env.local` **only if it does
not already exist**. Configure dedicated local services, a strong `CSRF_SECRET`
and one matching RSA JWT key pair using the development guide before `npm run dev`.
Do not overwrite existing secrets or assume another machine's database is empty.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Validated Next.js local development server |
| `npm run typecheck` | Typecheck app and static adapter |
| `npm run lint` | Next.js ESLint checks |
| `npm test` | Database-free unit tests |
| `npm run check:frontend-boundaries` | Browser/server dependency boundary |
| `npm run test:integration:safe` | Verified disposable PostgreSQL/Redis tests |
| `npm run build` | Main Next.js production build |
| `npm run build:jofra-pages` | Shared Jofra static output in ignored `out/` |
| `node scripts/verify-jofra-pages-export.mjs out` | Static routes/assets/form safety |
| `npm run test:e2e` | Build Pages and run Chromium/WebKit browser tests |

The static adapter in [`scripts/jofra-pages/`](./scripts/jofra-pages/) reuses the
authoritative [`Jofra frontend`](./src/frontend/features/jofra-landing/); it is
not a second independent website. Pages cannot run API routes, authentication,
PostgreSQL, Redis or Resend. Its forms are disabled previews.

## Working safely

- Preserve unrelated work, databases, containers, networks and volumes.
- Never infer database identity from a port or folder name alone. Do not use
  `drizzle-kit push`, global Docker pruning, or `docker compose down -v`.
- Only the journaled migrations 0000-0003 are active. Never replay a historical
  baseline from Git against an existing database.
- Keep environment files, private keys, provider tokens and real personal data
  out of source, logs, screenshots and commits.
- No real email tests without an approved test recipient.
- Pushes to `jofra-showcase` automatically deploy Pages after CI passes.
  **Owner approval is required before a release; passing tests is not approval.**

When switching OS, machine or assistant, start with these documents and current
`git status`, not an old conversation or plan. The
[handoff checklist](./docs/development.md#handoff-between-machines) records what
must be reverified locally. Historical implementation plans and Supabase SQL
remain in Git history, not in the active documentation.

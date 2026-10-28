# Workforce MVP — Repository Architecture and Codebase Inventory

**Audit date:** 2026-10-28

**Repository:** `C:\Users\Kickfooter\Desktop\Work-Force`

**Branch / HEAD:** `jofra-showcase` / `82fefb4af657c2435ad21258ce23b3007b6e7dd3`
**Scope:** Read-only inspection of the current checkout. No tests, services, Docker
commands, migrations, or database queries were run for this audit. No secrets or
environment-file values were read.

## 1. Executive summary

This is one repository with two Next.js applications:

1. The main Workforce application lives in `src/app`. It serves the Dutch/Arabic
   Jofra public pages as well as Workforce login, employee, attendance, and admin
   pages. Next route handlers under `src/app/api` provide the backend API.
2. `showcase/` is a small, separately configured Next.js application that imports
   the shared Jofra UI and builds a static GitHub Pages site. It has its own
   layouts because Pages cannot execute the main application's middleware or
   server APIs.

The main server-side application uses PostgreSQL/Drizzle, Redis, cookie-based
JWT sessions, Zod validation, and Resend for public Jofra email. The Pages export
is intentionally static: the Jofra preview forms are disabled and cannot send
email. A Node-capable deployment is required for application APIs and actual
form submission.

At the start of this audit, Git reported 226 tracked files, a clean worktree,
and ignored development/build/runtime material. This report is the only
untracked file created by this read-only investigation. The most
important architectural distinction is between shared UI/data and independent
runtime shells: the showcase shares Jofra components, CSS, translations,
metadata, route helpers, and source images, but owns static routing/layout/config
and copies source images into generated showcase output.

The inventory found concrete operational risks worth recording, not an
alternative architecture: Redis session lookup errors are converted to a
not-found result in one layer and therefore can appear as authentication
failures; refresh-token rotation scans Redis with `KEYS`; an unjournaled legacy
SQL migration remains beside the active migration chain; and configured
Playwright e2e paths have no corresponding tracked e2e suite. Other items below
are explicitly labeled as duplication, inconsistency, or items needing owner
confirmation rather than assumed defects.

## 2. Repository snapshot and hygiene

- Before report creation, `git status --short --branch` showed
  `jofra-showcase` with no changes. The only current untracked path created by
  this task is `docs/reviews/workforce-codebase-architecture-audit.md`.
- HEAD: `82fefb4af657c2435ad21258ce23b3007b6e7dd3`
  (`Fix Jofra Pages parity and deployment`).
- Tracked-file count: **226**.
- No other ordinary untracked files were reported.
- Ignored local/generated paths observed: `.cache/`, `.env.local`, `.next/`,
  `node_modules/`, `secrets/`, `showcase/.next/`, `showcase/next-env.d.ts`,
  `showcase/out/`, and `showcase/public/`.
- The contents of `.env.local` and `secrets/` were not inspected. Generated
  outputs and dependencies are not source-of-truth files.

## 3. Complete tracked directory inventory

The tree below lists the tracked source/configuration files and their purpose.
Generated output and ignored local-only files are described separately in
§12. The empty local `public/jofra/fonts/` directory is not tracked.

```text
.
├── .dockerignore                         Docker build context exclusions
├── .env.example                          Environment-variable names and setup notes
├── .eslintrc.json                        ESLint configuration
├── .github/
│   └── workflows/
│       └── jofra-showcase-pages.yml      Pages quality, build, and deployment jobs
├── .gitignore                            Ignored local secrets/build outputs
├── .nvmrc                                Node version selector
├── .taste-skill/
│   └── direction.json                    Tracked project-direction metadata
├── Dockerfile                            Multi-stage Node application image
├── README.md                             Setup, local operations, and safety guidance
├── docker-compose.yml                    Persistent local PostgreSQL/Redis/app services
├── docker-compose.integration-test.yml   Isolated integration-test databases
├── docker-compose.smoke.yml              Disposable application smoke environment
├── drizzle.config.ts                     Drizzle CLI schema/migration connection config
├── next-env.d.ts                         Next.js-generated type declarations
├── next.config.js                        Main Next.js server configuration
├── package.json                          Scripts, runtime dependencies, and dev tools
├── package-lock.json                     npm dependency lockfile
├── playwright.config.ts                  Playwright browser-test configuration
├── postcss.config.js                      PostCSS/Tailwind processing
├── tailwind.config.js                     Tailwind scan/theme configuration
├── tsconfig.json                          Main TypeScript configuration
├── vitest.config.ts                       Unit-test configuration
├── vitest.integration.config.ts           Database integration-test configuration
├── docs/
│   ├── README.md                          Documentation index and source-of-truth links
│   ├── architecture.md                    Current architecture, status, and limitations
│   ├── testing/
│   │   └── isolated-integration-tests.md  Safe disposable test procedure and caveats
│   └── history/
│       ├── README.md                      Historical-document index
│       ├── workforce-handoff.md           Original handoff record
│       ├── database/
│       │   └── supabase/
│       │       └── 001_initial_schema.sql Historical Supabase-era schema
│       └── plans/
│           ├── 2026-10-18-workforce-mvp-migration.md
│           ├── 2026-10-19-phase3-fixes.md
│           └── 2026-10-20-phase5-notifications-audit.md
│                                           Dated historical plans/audit records
├── drizzle/
│   ├── 0000_melodic_spectrum.sql           Existing SQL not present in active journal
│   ├── 0000_wild_agent_zero.sql            Journaled baseline migration
│   ├── 0001_notification_idempotency_expand.sql
│   ├── 0002_retire_notification_legacy_indexes.sql
│   ├── 0003_damp_unus.sql
│   └── meta/
│       ├── _journal.json                   Active migration sequence
│       ├── 0000_snapshot.json
│       ├── 0001_snapshot.json
│       ├── 0002_snapshot.json
│       └── 0003_snapshot.json              Drizzle schema snapshots
├── public/
│   └── jofra/
│       └── assets/
│           ├── 01_s01_expertise_site_overview.jpg
│           ├── 02_s01_expertise_close_control.jpg
│           ├── 03_s02_waaromjofra_team_talk.jpg
│           ├── 04_s03_mensen_portret.jpg
│           ├── 05_s04_werkwijze_hand_signal.jpg
│           ├── 06_case_forklift_coordination.jpg
│           ├── 07_case_night_operation.jpg
│           ├── logo-source.png
│           └── worker.jpg                 Source photographs and logo
├── scripts/
│   ├── check-frontend-boundaries.mjs       Frontend import-boundary checker
│   ├── docker-endpoint-safety.cjs          Docker endpoint safety helpers
│   ├── docker-resource-safety.cjs          Docker ownership/resource guards
│   ├── drizzle-config-safety.ts            Safe Drizzle CLI config validation
│   ├── load-dev-env.cjs                    Development environment loading
│   ├── run-isolated-integration-tests.mjs   Disposable test lifecycle/runner
│   ├── start-dev.cjs                       Validated local development launcher
│   ├── test-integration-safe.mjs            Public safe integration-test entrypoint
│   └── verify-jofra-pages-export.mjs        Static Pages export acceptance checks
├── showcase/
│   ├── README.md                           Static-host limitations and build guide
│   ├── next.config.js                      Static export, basePath and assets config
│   ├── tsconfig.json                       Showcase TypeScript config
│   └── app/
│       ├── (home)/
│       │   ├── layout.tsx                  Unprefixed Dutch HTML/i18n shell
│       │   └── page.tsx                    Unprefixed Dutch landing route
│       └── [locale]/
│           ├── layout.tsx                  Static Dutch/Arabic locale provider and HTML
│           ├── page.tsx                    Localized landing route
│           ├── aanvragen/
│           │   └── page.tsx                Localized static inquiry preview
│           └── werken-bij-jofra/
│               └── page.tsx                Localized static recruitment preview
├── src/
│   ├── app/
│   │   ├── layout.tsx                      Main document shell and global styles
│   │   ├── globals.css                     Workforce/global styles
│   │   ├── [locale]/
│   │   │   ├── layout.tsx                  Locale provider and authenticated app shell
│   │   │   ├── page.tsx                    Public Jofra landing
│   │   │   ├── aanvragen/page.tsx          Public inquiry page
│   │   │   ├── werken-bij-jofra/page.tsx   Public recruitment page
│   │   │   ├── auth/
│   │   │   │   ├── login/page.tsx          Sign-in page
│   │   │   │   └── register/page.tsx       Registration page
│   │   │   ├── employee/
│   │   │   │   ├── page.tsx                Employee home
│   │   │   │   ├── applications/page.tsx   Employee applications
│   │   │   │   ├── schedule/page.tsx       Employee schedule
│   │   │   │   └── shifts/page.tsx          Employee shift browser
│   │   │   ├── attendance/
│   │   │   │   └── check-in/page.tsx       Attendance/check-in UI
│   │   │   └── admin/
│   │   │       ├── page.tsx                Admin home
│   │   │       └── shifts/
│   │   │           ├── page.tsx            Shift administration
│   │   │           └── create/page.tsx     Create shift UI
│   │   └── api/                             Next route handlers (listed in §5)
│   ├── backend/
│   │   ├── auth/                             Password, JWT, refresh and session logic
│   │   ├── db/                               PostgreSQL singleton, Drizzle schema/queries
│   │   ├── jobs/                             Shift reminder background task
│   │   ├── jofra/                            Public form idempotency/email submission
│   │   ├── security/                         CSRF, IP, auth/role and audit helpers
│   │   ├── services/                         Business services (attendance)
│   │   └── validation/                       Zod domain request schemas
│   ├── frontend/
│   │   ├── components/                       Session, navigation and shell components
│   │   ├── features/
│   │   │   ├── employee-applications/        Employee application UI/API client
│   │   │   ├── employee-shifts/              Shift UI/API client and run-once helper
│   │   │   └── jofra-landing/                Public site, forms, routes, CSS/fonts/assets
│   │   ├── lib/
│   │   │   └── utils.ts                      `cn` class-name utility
│   │   └── ui/                                Reusable button/card/input/label/sheet/textarea
│   ├── lib/
│   │   └── jofra-metadata.ts                 Shared public-page metadata URLs
│   ├── locales/
│   │   ├── nl.json                           Dutch translations
│   │   └── ar.json                           Arabic translations
│   ├── shared/
│   │   ├── LocaleAwareLink.ts                Locale-aware link wrapper
│   │   ├── i18n-routing.ts                  Locale routing configuration
│   │   ├── localized-href.ts                Localized URL helper
│   │   └── jofra-public-form-schemas.ts      Public form schemas shared by UI/API
│   ├── i18n.ts                               next-intl message/time-zone loading
│   ├── instrumentation.ts                    Next instrumentation entrypoint
│   ├── instrumentation-node.ts                Node startup validation and jobs
│   └── middleware.ts                          Locale/URL middleware (not API auth)
└── tests/
    ├── support/
    │   ├── setup.ts                          Shared unit/integration setup
    │   └── database/
    │       ├── globalSetup.ts                Integration DB setup guard
    │       └── testDatabaseSafety.ts         Database identity/safety checks
    ├── unit/
    │   ├── api/                              Employee API client behavior
    │   ├── architecture/                     Frontend boundary/architecture checks
    │   ├── db/                               Database URL and Drizzle config safety
    │   ├── scripts/                           Startup and Docker safety
    │   ├── security/                          JWT/CSRF/session/IP tests
    │   └── testing/                           Jofra forms, locale and DB safety tests
    └── integration/
        ├── admin-employee-patch-csrf.test.ts
        ├── application-audit.test.ts
        ├── attendance-auth.test.ts
        ├── audit-logging.test.ts
        ├── core-audit-workflows.test.ts
        ├── csrf-security-endpoint.test.ts
        ├── csrf-security.test.ts
        ├── notification-api.test.ts
        ├── notifications.test.ts
        ├── phase3-application-concurrency.test.ts
        ├── phase3-approval-concurrency.test.ts
        ├── phase3-attendance.test.ts
        ├── phase3-shift-browsing.test.ts
        ├── registration-audit.test.ts
        └── shift-reminders.test.ts            Database-backed auth/workflow tests
```

### Directory responsibilities

- **`src/app/`** is the active main Next App Router tree: localized page entrypoints
  and server API handlers.
- **`src/frontend/`** owns client-facing features, shared UI and presentation
  utilities. It is not a second application router.
- **`src/backend/`** contains server-side authentication, database, security,
  validation, jobs and domain services called by route handlers.
- **`src/shared/`** contains cross-boundary URL/i18n behavior and public-form
  schemas consumed on both sides.
- **`src/lib/`** contains Jofra metadata URL construction. **`src/frontend/lib/`**
  contains the CSS class combiner `cn`. The names are similar; their observed
  responsibilities are different.
- **`showcase/`** is the independent static-site Next app used for Pages; it is
  not the Workforce API/backend.
- **`public/`** holds original static Jofra images/logo. Workflow-generated
  showcase copies are ignored output. The inspected local `public/jofra/fonts/`
  directory had no files; the Jofra font source is under
  `src/frontend/features/jofra-landing/fonts/`.
- **`tests/`** has 16 unit test files, 14 integration test files, and shared
  setup/safety support. There is no tracked `tests/e2e/` directory.
- **`scripts/`** contains development/test launchers, Docker safety helpers,
  verification scripts, and boundary checks.
- **`drizzle/`** holds the journaled schema migrations and snapshots, plus one
  unjournaled SQL file discussed in §11.
- **`docs/`** mixes current operational documentation with explicitly historical
  dated plans/handoff/Supabase material. `docs/README.md` distinguishes them.
- **`.github/`** currently contains only the Pages workflow; no separate general
  CI workflow was found.

## 4. Current application architecture

### Runtime dependency diagram

```mermaid
flowchart TD
  Browser[Browser]
  Middleware[src/middleware.ts<br/>next-intl and URL normalization]
  Pages[src/app/[locale]<br/>Jofra, auth, employee, attendance, admin pages]
  Features[src/frontend/features and components<br/>client UI, state, API clients]
  API[src/app/api route handlers]
  Validation[src/backend/validation<br/>and src/shared form schemas]
  Security[src/backend/auth and security<br/>JWT, Redis session, role, CSRF]
  Domain[src/backend/services and queries]
  PG[(PostgreSQL<br/>Drizzle)]
  Redis[(Redis<br/>sessions, rate limits, idempotency)]
  Resend[Resend email API]
  Jobs[src/instrumentation-node.ts<br/>optional shift reminder job]
  Browser --> Middleware --> Pages
  Pages --> Features
  Features -->|HTTP fetch| API
  API --> Validation
  API --> Security
  API --> Domain
  Domain --> PG
  Security --> Redis
  Domain --> Redis
  API -->|public Jofra submissions| Resend
  Jobs --> Domain
```

This is the observed division, not a separate service deployment: the Next
application hosts both pages and API route handlers. PostgreSQL/Redis are
external services in Compose/production; the repository also supplies a
standalone Node Docker image.

### Entrypoints, configuration, localization

- `next.config.js:1-25` configures the main Next app (standalone output and
  instrumentation, among other build settings). It conditionally applies the
  Pages base path from `NEXT_PUBLIC_BASE_PATH` (`:2,7`).
- `src/app/layout.tsx:1-38` is the root HTML shell, imports global CSS and
  Next-managed fonts, and validates the document locale.
- `src/app/[locale]/layout.tsx:1-39` supplies `next-intl`, time zone and
  `RouteAwareShell`. It declares both `dynamic = 'force-dynamic'` and
  `generateStaticParams` for `nl`/`ar`.
- `src/i18n.ts:16-23,34-39` configures localized route names and loads the
  locale JSON. Arabic uses `Asia/Riyadh`; Dutch uses `Europe/Amsterdam`
  (`src/i18n.ts:38`).
- `src/shared/i18n-routing.ts:5-8` configures supported `nl` and `ar` locales
  with `localePrefix = 'as-needed'`.
- `src/middleware.ts:1-38` applies `next-intl` routing, defaults to Dutch,
  disables locale detection, normalizes trailing slashes, excludes framework
  and public Jofra assets, and bypasses locale handling for `/api`.
- Middleware is not the authentication boundary. API handlers use backend
  session/role/CSRF guards.

### Page route map

| Route family | Main source entrypoint | Purpose / observed consumers |
|---|---|---|
| `/` (Dutch default), `/ar` | `src/app/[locale]/page.tsx` | Jofra marketing landing |
| `/aanvragen`, `/ar/aanvragen` | `src/app/[locale]/aanvragen/page.tsx` | Public inquiry/request form |
| `/werken-bij-jofra`, `/ar/werken-bij-jofra` | `src/app/[locale]/werken-bij-jofra/page.tsx` | Public recruitment/interest form |
| `/{locale}/auth/login` | `src/app/[locale]/auth/login/page.tsx` | Login; calls `/api/auth/login` |
| `/{locale}/auth/register` | `src/app/[locale]/auth/register/page.tsx` | Registration; calls `/api/auth/register` |
| `/{locale}/employee` | `src/app/[locale]/employee/page.tsx` | Employee home |
| `/{locale}/employee/shifts` | `src/app/[locale]/employee/shifts/page.tsx` | Employee shift browser |
| `/{locale}/employee/applications` | `src/app/[locale]/employee/applications/page.tsx` | Employee application list |
| `/{locale}/employee/schedule` | `src/app/[locale]/employee/schedule/page.tsx` | Schedule page |
| `/{locale}/attendance/check-in` | `src/app/[locale]/attendance/check-in/page.tsx` | Attendance UI |
| `/{locale}/admin` | `src/app/[locale]/admin/page.tsx` | Admin home |
| `/{locale}/admin/shifts` | `src/app/[locale]/admin/shifts/page.tsx` | Admin shift UI |
| `/{locale}/admin/shifts/create` | `src/app/[locale]/admin/shifts/create/page.tsx` | Create-shift UI |

`/{locale}` above denotes `nl` or `ar`; default Dutch production paths are
unprefixed due to `as-needed` routing. There is no distinct supervisor page
directory in the tracked route tree. `requireRole` supports the
`administrator`, `supervisor`, and `employee` roles; which pages a supervisor
should see is an owner/product question rather than inferred from the route
names.

### API route map

- **Auth:** `src/app/api/auth/{csrf,login,logout,me,refresh,register}/route.ts`.
- **Employee:** `employee/shifts`, `employee/shifts/[id]`,
  `employee/shifts/[id]/apply`, `employee/applications`, `employee/schedule`,
  and employee attendance check-in/check-out handlers.
- **Attendance aliases:** `/api/attendance/check-in` and `/api/attendance/check-out`
  are thin wrappers for the employee handlers, not separate attendance
  implementations (`src/app/api/attendance/check-in/route.ts:12-13,90`;
  checkout `:12-13,106`).
- **Admin:** applications, application review, attendance, audit, employees,
  employee detail, and shifts under `src/app/api/admin`.
- **Notifications:** list/create and ID-based update/delete under
  `src/app/api/notifications`.
- **Public Jofra:** `/api/public/jofra/inquiries` and
  `/api/public/jofra/applications`, both delegated to
  `submitJofraPublicForm`.
- **Health:** `/api/health`.

### Backend and data dependencies

- `src/backend/db/index.ts:1-35` creates a PostgreSQL pool and Drizzle instance,
  imports the full schema, and exports database, migration, close and health
  helpers. `DATABASE_URL` is validated by
  `src/backend/db/databaseUrl.ts:1-44`; the Drizzle CLI config is
  `drizzle.config.ts:1-19`.
- `src/backend/db/schema.ts:1-354+` defines PostgreSQL enums and tables such as
  profiles, roles, employee details, shifts, applications, assignments,
  attendance, notifications and audit records. Query modules separate
  applications, assignments, attendance, audit, employees, notifications and
  shifts.
- `src/backend/redisUrl.ts:1-17` validates `REDIS_URL`.
  `src/backend/auth/session.ts:1-75` manages Redis-backed JWT/refresh session
  records. `src/backend/jofra/publicFormRedis.ts:1-112` uses Redis Lua scripts
  for submission rate limits and idempotency. The inspected code does not
  establish a general-purpose application cache.
- `src/backend/auth/tokens.ts:1-136` issues RS256 access tokens (15-minute
  expiry) and opaque refresh tokens. RSA key loading and pair validation are in
  `src/backend/auth/jwtKeyMaterial.js:1-127`.
- `src/backend/security/requireAuth.ts:1-49` validates the cookie JWT and
  Redis session; `requireRole.ts:1-29` applies role authorization.
- `src/backend/security/csrf.ts:42-116,156` implements signed CSRF-cookie and
  request-header checks, including a combined CSRF/auth wrapper.
- `src/backend/validation/` holds workforce request Zod schemas.
  `src/shared/jofra-public-form-schemas.ts` is shared between public form UI and
  backend submission validation.
- `src/backend/services/attendance.ts` is a business-service layer for
  attendance; database operations reside in query modules.
- `src/backend/jobs/shiftReminders.ts` implements the reminder job.
  `src/instrumentation-node.ts:1-22` performs Node startup validation and starts
  the reminder only in production when enabled.
- Jofra public submissions use Redis protection and Resend through
  `publicFormSubmission.ts:99-164`, `publicFormRedis.ts:55-112`, and
  `publicFormsEmail.ts:117-139`; the inspected implementation does not persist
  these public form submissions in PostgreSQL.

## 5. Frontend component and data dependency maps

### Public Jofra pages

```text
src/app/[locale]/page.tsx
  └── JofraLanding
      ├── JofraSiteHeader ── LanguageSwitch ── jofraRoutes/localized-href
      ├── src/locales/{nl,ar}.json (jofraLanding translations)
      ├── JofraLanding.css
      ├── jofraFonts.ts ── jofra-fonts.css ── local WOFF2 subsets
      └── public/jofra/assets/* images/logo

src/app/[locale]/aanvragen/page.tsx ─┐
src/app/[locale]/werken-bij-jofra/page.tsx ─┴── JofraPublicPage
      ├── JofraSiteHeader / LanguageSwitch
      ├── JofraPublicForm
      │   ├── src/shared/jofra-public-form-schemas.ts
      │   └── POST /api/public/jofra/{inquiries,applications}
      ├── same JofraLanding.css and jofra-fonts.css
      └── public/jofra/assets/* support images
```

- `src/frontend/features/jofra-landing/JofraLanding.tsx:26` exports the landing.
  It renders the header at `:192` and uses the logo and seven named Jofra
  photographs at `:198,319,328,413,430,541,561,571,673`.
- `JofraSiteHeader.tsx:9-18` defines section navigation and exports the header;
  `:22-54` contains scroll/IntersectionObserver state; `:59-102` contains
  mobile-menu keyboard/focus/resize handling; `:110-140` provides inline road
  artwork, logo and language switch.
- `JofraPublicPage.tsx:11-25` sets locale, direction, fonts and localized title
  content; `:29-66` selects recruitment/inquiry forms and contact cards.
- `JofraPublicForm.tsx:60-68` supports inquiry/application and static preview;
  `:77` disables static submission, `:82-104` validates/serializes and submits
  the form, `:152-157` shows preview notice and disabled fieldset, and
  `:163-219` renders controls and submit action.
- `LanguageSwitch.tsx:8-26` chooses the alternate locale and preserves query
  string/hash; the component is used by the shared header.

### Styling, typography, images, responsive design

- `JofraLanding.css` is the shared Jofra stylesheet used by both landing and
  public form pages (`JofraLanding.tsx:6`; `JofraPublicPage.tsx:8`). It includes
  header, hero, services, benefits, process, contact/footer, reveal and public
  page styles. It has many later override blocks re-targeting the same selectors;
  this is a confirmed overlapping-style pattern, not proof each override is
  unnecessary.
- Responsive rules include `max-width:900px` (`JofraLanding.css:510-551`),
  `max-width:650px` (`:552-697`), and further later responsive blocks. Reduced
  motion rules occur at `:698`, `:1071`, `:4181`, and `:4347`.
- The process-line drawing is driven by CSS `@keyframes drawline`
  (`JofraLanding.css:797-800`); additional `roadscan` animation is at
  `:862-865`. `JofraLanding.tsx:39,74` observes reduced-motion preference;
  `JofraSiteHeader.tsx:22-54` handles section observation.
- Jofra font files live under
  `src/frontend/features/jofra-landing/fonts/`: DM Sans Latin and Latin-ext;
  Manrope Latin, Latin-ext, Cyrillic, Cyrillic-ext, Greek, and Vietnamese; plus
  `OFL.txt`. `jofra-fonts.css:1-79` declares WOFF2 subsets and Unicode ranges;
  `jofraFonts.ts:1-5` exports class-variable names. The Jofra UI applies those
  classes in `JofraLanding.tsx:29` and `JofraPublicPage.tsx:14`.
- The Arabic CSS/font subset filenames do not prove Arabic glyph coverage.
  Arabic text is rendered and RTL is set by the components; actual font fallback
  for Arabic glyphs remains dependent on browser/system font coverage.
- Source images are the nine tracked files in `public/jofra/assets/`. The public
  landing uses the logo and eight photos; public form cards reuse existing
  photography (`JofraPublicPage.tsx:37-42,55-60`). The favicon also uses Jofra
  artwork (`src/app/[locale]/layout.tsx:12-14`).
- Asset filenames indicate their intended subjects; this audit did not perform
  visual comparison or inspect image EXIF/metadata.

### Localization and RTL

- Translation data is in `src/locales/nl.json` and `src/locales/ar.json`;
  `src/i18n.ts:34-39` loads it dynamically. The Jofra components use
  `jofraLanding` translations (`JofraLanding.tsx`,
  `JofraSiteHeader.tsx:19`, `JofraPublicPage.tsx:12`).
- Locale route configuration is shared through `src/shared/i18n-routing.ts`,
  `src/shared/localized-href.ts`, and `src/frontend/features/jofra-landing/jofraRoutes.ts`.
- Production default Dutch URLs omit `/nl`; Arabic routes use `/ar`.
  The static showcase emits both locale-prefixed URLs because it cannot run
  Next middleware: `/workforce-mvp/nl/` and `/workforce-mvp/ar/`.
- `JofraPublicPage.tsx:14` sets `lang` and sets `dir="rtl"` for Arabic.
  Landing route document direction is also provided by app/layout configuration.

## 6. Main application versus `showcase/`

### Purpose and history

`showcase/` was first added with the Pages workflow in commit
`8b7753edce6e321920a4d0bf9873e56ca47e596f` on 2026-10-25
(`Add landing-only Jofra Pages showcase`). Its original README describes a
static Dutch/Arabic Jofra marketing showcase that excludes Workforce sign-in,
employee/admin UI, APIs, database services and runtime secrets. The first
workflow copied Jofra images, built `showcase`, and deployed `showcase/out`.

The inquiry and recruitment Pages were added in commit
`63c00cc34f9ed713f2ee9fabeb4ee3401ec2c937` on 2026-10-28
(`Complete Jofra public pages and site QA`). They continue to share the
production form-page UI but render static-only disabled form previews.

The Pages workflow was made manual-only in
`3b59444ce7b4693be709b0101e9a3638fe80d1cf` and push deployment was restored in
the current HEAD. Current `.github/workflows/jofra-showcase-pages.yml:1-8`
supports push to `jofra-showcase` and manual dispatch.

### What it is and what it owns

`showcase/` is a separate Next.js application root (`npx next build showcase`),
not merely a config flag applied to `src/app`. It uses root `package.json` and
dependencies; it does not have a separate `package.json`. It owns:

- Static export configuration, trailing slash behavior, `basePath` and
  `assetPrefix`, external directory access and unoptimized images in
  `showcase/next.config.js:1-15`.
- Its own static locale layout/provider in `showcase/app/[locale]/layout.tsx:1-43`.
- A separate unprefixed Dutch HTML/layout/provider in
  `showcase/app/(home)/layout.tsx:3-22`.
- Thin route wrappers for the unprefixed home and localized landing/forms, with
  static metadata (`showcase/app/(home)/page.tsx:1-5` and
  `showcase/app/[locale]/{page.tsx,aanvragen/page.tsx,werken-bij-jofra/page.tsx}`).
- Its own README and TypeScript config.

It does **not** own independent copies of translations: its layouts import
`src/locales/{nl,ar}.json`. It imports the shared production
`JofraLanding`, `JofraPublicPage`, `JofraPublicForm`, `JofraSiteHeader`,
`LanguageSwitch`, CSS, font declarations, `jofraRoutes`, and shared metadata.
The prior `showcase.css` files are absent in current source; current shared
feature CSS supplies the Jofra styles.

### URL difference

- Main app: default Dutch routes are unprefixed (`/`, `/aanvragen`,
  `/werken-bij-jofra`); Arabic is prefixed (`/ar/...`). This follows
  `localePrefix: 'as-needed'` (`src/shared/i18n-routing.ts:5-8`) and the main
  app middleware.
- Showcase: both locales are explicit (`/workforce-mvp/nl/...` and
  `/workforce-mvp/ar/...`), plus `/workforce-mvp/` for the Dutch home route.
  Static hosting cannot perform the main middleware's locale negotiation or
  dynamic redirect behavior; the separate route tree materializes each path.
- The main Next config can accept `NEXT_PUBLIC_BASE_PATH` for generated Next
  assets; the shared Jofra route helper also accounts for the base prefix.

### Build, deployment and necessity

`.github/workflows/jofra-showcase-pages.yml`:

1. Runs quality checks (`:20-59`).
2. Copies source images to showcase public output (`:67-68`).
3. Builds the static app with `/workforce-mvp` (`:70-74`).
4. Verifies route/asset/locale output (`:76-78`).
5. Uploads `showcase/out` and deploys only after the build (`:80-98`).

Pages serves only static HTML/assets. Its forms are disabled with localized
contact instructions; it cannot host Next API routes, workforce authentication,
PostgreSQL, Redis, or Resend credentials (`showcase/README.md:3-18`).

The separate `showcase/` app is necessary for the **current** Pages build
because the deployment targets a static export and requires explicit paths,
static layouts, and base-path handling. It is not intrinsically necessary to
the Jofra design itself: the UI and translation sources are shared. Removing it
without replacing the workflow's build input would break the current Pages
deployment and published routes. Whether GitHub Pages itself remains a required
destination is an owner decision.

### Remaining overlap and non-overlap

- **Shared source of truth:** Jofra components, CSS, font files, locale JSON,
  route helper, metadata and original images.
- **Separate necessary host shell:** `showcase` layouts/routes/config differ
  because static Pages cannot execute main middleware/server handlers.
- **Physical image duplication at build time:** the workflow copies
  `public/jofra/assets/*` to `showcase/public/jofra/assets/`; this is generated
  output under the ignored `showcase/public/`, not a second tracked source of
  photographs.
- **Prior duplicate showcase CSS:** old source CSS files are deleted at this
  HEAD; no active showcase-only Jofra stylesheet was found.
- **Public UI / backend capability mismatch is gated:** shared form component
  uses `staticPreview` to disable Pages forms. It does not claim that email
  delivery works on GitHub Pages.

## 7. Backend/service dependency map

```text
Next route handler
  ├─ Zod validation: src/backend/validation/* or src/shared/*
  ├─ Authentication: cookie JWT -> Redis session lookup
  ├─ Authorization: requireRole(...)
  ├─ CSRF: signed cookie + matching request header for state-changing requests
  ├─ Workforce queries/services -> Drizzle -> PostgreSQL
  ├─ Sessions/refresh tokens -> Redis
  └─ Public Jofra handler -> Redis rate-limit/idempotency -> Resend
```

Frontend API consumers include:

- Login and registration pages call auth endpoints;
  `src/frontend/components/session-provider.tsx:31` requests `/api/auth/me`;
  navigation logs out through `/api/auth/logout`.
- `employeeShiftsApi.ts:111-163` fetches shifts, obtains CSRF, and submits
  applications. `employeeApplicationsApi.ts:115` loads applications.
- `JofraPublicForm.tsx:103-104` calls the public inquiry/application endpoints.

### Persistence, email and runtime configuration

`DATABASE_URL` is a validated PostgreSQL URL; `REDIS_URL` accepts Redis/Redis-TLS
schemes. Drizzle schema source is `src/backend/db/schema.ts`; active migration
state is `drizzle/meta/_journal.json`. Database migrations are an explicit
operation (`drizzle-kit migrate` in the isolated integration runner), not a
per-request or Pages operation.

Public Jofra runtime submission requires a Node-capable API deployment, working
Redis and configured Resend sender/recipient/provider values. GitHub Pages
submissions do not run: controls are disabled. The audit did not send email or
verify any live sender domain.

### Environment-variable names

Names only; no values are included. The following names appear in environment
templates, runtime code, Compose, CI or test tooling. Their presence does not
mean every deployment requires every optional/test-only variable.

- **Application/database/security:** `DATABASE_URL`, `REDIS_URL`, `CSRF_SECRET`,
  `JWT_PRIVATE_KEY_FILE`, `JWT_PUBLIC_KEY_FILE`, `JWT_PRIVATE_KEY_B64`,
  `JWT_PUBLIC_KEY_B64`, `TRUSTED_CLIENT_IP_HEADER`.
- **Jofra/public metadata/email:** `JOFRA_PUBLIC_ORIGINS`, `RESEND_API_KEY`,
  `JOFRA_FORMS_FROM`, `JOFRA_FORMS_TO`, `NEXT_PUBLIC_APP_URL`,
  `NEXT_PUBLIC_BASE_PATH`.
- **Application/runtime tuning:** `ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`,
  `ARGON2_PARALLELISM`, `SHIFT_REMINDER_JOB_ENABLED`, `NODE_ENV`,
  `NEXT_PHASE`, `NEXT_RUNTIME`, `PORT`, `HOSTNAME`, `CI`.
- **Docker/development:** `COMPOSE_PROJECT_NAME`, `DOCKER_BIN`, `DOCKER_CONTEXT`,
  `DOCKER_HOST`, `WORKFORCE_DEV_APP_PORT`, `WORKFORCE_DEV_DB_PASSWORD`,
  `WORKFORCE_DEV_POSTGRES_PORT`, `WORKFORCE_DEV_REDIS_PORT`,
  `WORKFORCE_SECRETS_DIR`.
- **Smoke-test tooling:** `WORKFORCE_SMOKE_COMPOSE_PROJECT`,
  `WORKFORCE_SMOKE_DB_PASSWORD`, `WORKFORCE_SMOKE_SECRETS_DIR`.
- **Integration/test safety:** `WORKFORCE_SAFE_DB_PASSWORD`,
  `WORKFORCE_TEST_DB_HOST`, `WORKFORCE_TEST_DB_SERVER_ADDRESS`,
  `WORKFORCE_TEST_DB_SERVER_PORT`, `WORKFORCE_TEST_REDIS_HOST`,
  `WORKFORCE_DISABLE_FS_MODULE_CACHE`, `WORKFORCE_STARTUP_TEST_VALUE`.

The main sources of names are `.env.example:1-69`, `docker-compose.yml:12-27`,
`docker-compose.smoke.yml:9-28`, and
`scripts/run-isolated-integration-tests.mjs:11-15,205-215`.

## 8. Tests and development tooling

### Active test runners

- **Unit:** `npm test` invokes Vitest with `vitest.config.ts:4-19`, Node
  environment, shared setup, 30-second test/hook timeouts, and serial file
  execution. Tracked suites cover API clients, architecture boundaries,
  database URL/config safety, startup/Docker safety, security, Jofra forms and
  locale routing.
- **Integration:** `vitest.integration.config.ts:4-11` includes unit and
  integration suites plus database global setup. `npm run test:integration:safe`
  is the supported database-backed launcher.
- The safe runner creates a unique Compose identity and temporary credentials
  (`scripts/test-integration-safe.mjs:20-35`), sets loopback test endpoints,
  test-only CSRF configuration and job/cache flags
  (`scripts/run-isolated-integration-tests.mjs:205-215`), then applies
  journaled migrations (`:228-229`). Test DB safety support is in
  `tests/support/database/globalSetup.ts` and `testDatabaseSafety.ts`.
- Integration test files cover admin employee patch/CSRF, application and
  registration audit, attendance/auth, audit logging, core audit workflows,
  CSRF endpoints, notification APIs/flows, application and approval
  concurrency, attendance, shift browsing, and shift reminders.
- **Playwright:** `playwright.config.ts:3-25` points at `tests/e2e` and starts
  `npm run dev`, but there is no tracked `tests/e2e/` suite. `docs/architecture.md:288-289`
  also says no browser-test suite is present. Treat the configuration as
  currently unused/stale until an owner confirms planned e2e work; invoking it
  may start a development server without discovering tests.
- No separate browser/e2e suite or security-scanner workflow was found in the
  tracked repository. Security-focused unit and integration test files do exist.

### Test/build tooling

`package.json:8-16` exposes dev/build/start, lint, typecheck, unit tests, safe
integration tests, Vitest UI, and frontend boundary check. Runtime dependencies
include Next 14, React 18, `pg`, Drizzle, Redis clients, JOSE, Argon2, Resend and
Zod (`package.json:17-34`). Dev tooling includes Playwright, Vitest/Vite,
TypeScript, Drizzle Kit and ESLint (`:35-48`). Node version is 24 (`:4-6`).

The isolated integration Compose file defines PostgreSQL/Redis only, internal
networking, tmpfs storage, and no published host ports
(`docker-compose.integration-test.yml:1-33`). Safety helpers include
`scripts/docker-endpoint-safety.cjs` and
`scripts/docker-resource-safety.cjs`; their purpose is to validate endpoint
and resource ownership before cleanup.

## 9. Docker, database and deployment modes

| Configuration | Services / purpose | Data / reachability |
|---|---|---|
| `docker-compose.yml` | Local PostgreSQL, Redis and app development services | Named persistent `pgdata`/`redisdata`; host ports bind loopback. Defaults avoid Windows PostgreSQL 5432 by using port 5433 and Redis 6380 (`README.md`). |
| `docker-compose.integration-test.yml` | Disposable PostgreSQL and Redis for integration tests | Internal network, tmpfs, no published database ports; invoked by safe runner. |
| `docker-compose.smoke.yml` | Disposable app and dependent services for smoke validation | Internal network and tmpfs; no published ports; unique project and mounted test JWT secrets. |
| `Dockerfile` | Node 24 multi-stage development/build/production image | Production runner is non-root and standalone; reminder job is enabled in production image (`Dockerfile:1-62`). |
| `.github/workflows/jofra-showcase-pages.yml` | Jofra static site CI/CD | Static artifact only; no backend runtime or secrets. |

The development Compose volumes are intentionally persistent. The test runner
uses separate disposable resources and does not imply any permission to touch
development resources. The Docker and migration files describe capabilities;
this audit did not inspect or modify live Docker/database state.

The main Node-capable Next deployment can serve pages and API routes, assuming
the required database, Redis, JWT, CSRF and email configuration is supplied.
GitHub Pages can serve only generated static output. Do not infer successful
email delivery from a Pages build.

## 10. Overlapping directories and responsibility analysis

| Paths | Observed responsibility and consumers | Classification |
|---|---|---|
| `src/lib/jofra-metadata.ts` vs `src/frontend/lib/utils.ts` | Metadata URL builder consumed by Jofra route metadata vs `cn` class combiner consumed by layouts/UI components. | Similar directory names, **not duplicate responsibilities**. |
| `src/backend/validation/*` vs `src/shared/jofra-public-form-schemas.ts` | Workforce API/domain validation vs public Jofra schema shared by UI and server submission. | Different scope; the shared Jofra schema is intentionally cross-boundary. |
| `src/backend/db/schema.ts` vs `drizzle/*.sql` / `drizzle/meta/*.json` | Current typed schema definition vs generated/applied migration history and snapshots. | Complementary; not duplicate schemas with equivalent runtime ownership. |
| `src/app/api/attendance/*` vs `src/app/api/employee/attendance/*` | Generic attendance URLs delegate to employee handlers. | Confirmed implementation alias; duplicated route surface is intentional compatibility/API surface, not a separate implementation. |
| `src/app/[locale]` vs `showcase/app` | Main dynamic app route shell vs static Pages route/layout shell; showcase routes import shared Jofra UI. | Separate host/runtime responsibilities, shared business-facing UI. Not a complete duplicate app. |
| `public/jofra/assets/*` vs `showcase/public/jofra/assets/*` | Canonical tracked images vs workflow-copied static export input. | Generated physical copy; canonical source remains `public/jofra/assets`. |
| `JofraLanding.css` selectors repeated in later blocks | Single file contains base styles and later overrides for overlapping selectors. | Confirmed overlapping style responsibility; whether each override is redundant requires design/history investigation. |
| Root `src/app/layout.tsx` and locale `src/app/[locale]/layout.tsx` | Both import `globals.css`. | Redundant global CSS import; not established as runtime breakage. |
| `showcase/next.config.js` vs root `next.config.js` | Static export/basePath vs main server build/standalone behavior. | Separate app-specific configuration is expected, not a duplicate config file by name alone. |

No separate `src/components`, root `lib`, root `utils`, or root `services`
directories were found. Frontend UI components are in `src/frontend/ui` and
`src/frontend/components`; backend business services are in `src/backend/services`.

## 11. Historical and potentially obsolete artifacts

These are candidates for owner review, not removal recommendations:

1. **`drizzle/0000_melodic_spectrum.sql`** — present in tracked source but absent
   from `drizzle/meta/_journal.json`; the active journal contains
   `0000_wild_agent_zero`, then `0001_notification_idempotency_expand`,
   `0002_retire_notification_legacy_indexes`, and `0003_damp_unus`
   (`_journal.json:1-29`). `docs/testing/isolated-integration-tests.md:81-83`
   explicitly identifies the unjournaled SQL as outside the active chain.
   Consequence of casual application/deletion: schema mismatch or data loss;
   preserve until its origin and intended status are reconciled.
2. **`docs/history/database/supabase/001_initial_schema.sql`** — historical
   Supabase schema, separate from the current Drizzle/PostgreSQL migration chain.
   Its directory and history index mark it historical.
3. **Dated `docs/history/plans/*` and `workforce-handoff.md`** — preserved
   decision/context records. `docs/README.md` instructs that they do not
   supersede current source/architecture documentation.
4. **`playwright.config.ts` targeting missing `tests/e2e/`** — probably unused
   at this snapshot; removing it could discard planned browser-test
   configuration. Confirm owner intent before changing it.
5. **Ignored generated `showcase/public/`, `showcase/out/`, `showcase/.next/`**
   — copied images, static export, and Next build output. Not source files;
   the build recreates them. No cleanup was performed.
6. **Ignored `.next/`, `node_modules/`, `.cache/`, `.env.local`, `secrets/`**
   — local build, dependency/cache, and runtime/configuration material. Values
   and contents were not inspected.
7. **`public/jofra/fonts/`** — empty local directory observed; no tracked files
   or consumers found in repository inventory. Empty directories are not
   represented in Git.
8. **Root `next-env.d.ts`** — generated by Next but tracked. It is active
   TypeScript support rather than an arbitrary build artifact; avoid treating
   it like ignored `.next` output.

## 12. Confirmed defects, risks, and design choices

Severity reflects potential impact based on implementation evidence; it is not
a full penetration test or production incident finding.

| Classification | Severity | Evidence | Consequence / confidence |
|---|---:|---|---|
| Confirmed error-semantics defect | Medium | `src/backend/auth/session.ts:93-116` catches Redis session lookup failures and returns `null`; `src/backend/security/requireAuth.ts:30-39` has a 503 branch for Redis unavailability. | A Redis outage during session lookup can be surfaced as `401 Session expired or revoked` rather than service unavailable. The catch makes the explicit 503 distinction ineffective on that lookup path. |
| Confirmed scalability risk | Medium | `src/backend/auth/session.ts:158-166` uses Redis `KEYS refresh:{userId}:*` during refresh-token rotation. | Redis `KEYS` scans the keyspace synchronously; latency/blocking risk grows with keyspace. It may be acceptable at current scale, but operational scale assumptions are undocumented here. |
| Confirmed idempotency consistency risk | Medium | `src/backend/jofra/publicFormSubmission.ts:154-164` can return success after provider acceptance even when marking the Redis submission sent fails. | Redis may leave a pending reservation until expiry, so later retry behavior can diverge from provider acceptance and duplicate delivery is possible after expiry/retry. The exact user-visible frequency depends on Redis/provider timing. |
| Configuration ambiguity | Low/Medium | `src/backend/auth/jwtKeyMaterial.js:15-22,46-56` can discover repository-relative `secrets/` when explicit key variables are absent. | Key source depends on working directory and implicit fallback order. This is intentional compatibility behavior, but can make deploy configuration less explicit. |
| Configuration inconsistency | Low | `src/app/[locale]/layout.tsx:32-37` declares `force-dynamic` and `generateStaticParams`. | Competing static/dynamic intent; not shown to cause a runtime failure, but complicates assumptions about prerendering. |
| Duplicated global import | Low | `src/app/layout.tsx:1` and `src/app/[locale]/layout.tsx:1` both import `globals.css`. | Redundant declaration; no failure observed or established. |
| Migration history ambiguity | Medium | Unjournaled `0000_melodic_spectrum.sql` coexists with journaled `0000_wild_agent_zero.sql`. | A careless CLI/manual action could apply the wrong baseline. Current docs identify the intended chain; no migration was run for this report. |
| Test coverage gap / stale config | Low/Medium | `playwright.config.ts:3-25` points at `tests/e2e`; no tracked `tests/e2e` suite exists; architecture docs `:288-289` say no browser suite. | E2E command/config may not execute meaningful user journeys. Existing Vitest and integration tests remain separate and active. |
| Shared large stylesheet | Maintainability | `src/frontend/features/jofra-landing/JofraLanding.css` contains multiple later blocks re-targeting `.jofra-page`, `.hero`, `.navlinks`, `.benefits`, `.process-grid`, `.reveal`; see ranges in §5. | Later overrides make the effective rule depend on source order. This is concrete style overlap, but not proof that a particular rule is dead. |
| Reasonable separation | — | Middleware bypasses `/api`; API route handlers enforce auth/role/CSRF separately. | Locale selection and API authorization have distinct responsibilities. |
| Reasonable separation | — | Showcase has independent static layouts/config but imports shared Jofra UI/translations. | Supports GitHub Pages without duplicating core Jofra presentation or pretending it has a backend. |

## 13. Open questions for the owner

1. Is GitHub Pages a long-term customer-facing destination, or only a design
   preview? Current static forms cannot submit.
2. Should supervisors have a distinct UI route, or should their access be
   represented by existing admin pages? The backend role abstraction includes
   `supervisor`, but no distinct supervisor route directory is present.
3. Is `tests/e2e/` planned? The checked-in Playwright config points there, but
   the directory/suite is absent.
4. What is the provenance and intended archival status of the unjournaled
   `0000_melodic_spectrum.sql`? Current documentation says not to apply it.
5. What operational behavior is desired when Redis session lookup is
   unavailable: fail as unauthorized or return an availability error?
6. Are public form delivery and idempotency guarantees intended to be
   best-effort or durable across Redis failures after Resend accepts a message?
7. What production scale is expected for refresh-token sets, given the current
   `KEYS` lookup?
8. Are Manrope's checked-in subsets expected to cover Arabic glyphs, or is
   browser/system Arabic fallback intentional?
9. Root README says some screens remain prototypes; which employee/admin
   capabilities are considered complete for customer testing? This audit maps
   routes and services but does not judge product acceptance.

## 14. Evidence reference index

Primary source references used in this inventory:

- App shells/routes/middleware/config:
  `src/app/layout.tsx:1-38`,
  `src/app/[locale]/layout.tsx:1-39`,
  `src/middleware.ts:1-38`,
  `src/shared/i18n-routing.ts:5-8`,
  `src/i18n.ts:16-23,34-39`,
  `next.config.js:1-25`.
- API consumers:
  `src/app/api/auth/register/route.ts:2-13`,
  `src/app/api/auth/refresh/route.ts:2-6`,
  `src/app/api/auth/logout/route.ts:2-4`,
  `src/app/api/employee/schedule/route.ts:2-12`,
  `src/app/api/employee/shifts/[id]/route.ts:2-15`,
  `src/app/api/attendance/check-in/route.ts:12-13,90`,
  `src/app/api/attendance/check-out/route.ts:12-13,106`,
  `src/app/api/public/jofra/inquiries/route.ts:1-7`.
- Backend/data/security:
  `src/backend/db/index.ts:1-35`,
  `src/backend/db/databaseUrl.ts:1-44`,
  `src/backend/db/schema.ts:1-354+`,
  `drizzle.config.ts:1-19`,
  `src/backend/redisUrl.ts:1-17`,
  `src/backend/auth/session.ts:1-75,93-116,158-166`,
  `src/backend/auth/tokens.ts:1-136`,
  `src/backend/auth/jwtKeyMaterial.js:1-127`,
  `src/backend/security/requireAuth.ts:1-49`,
  `src/backend/security/requireRole.ts:1-29`,
  `src/backend/security/csrf.ts:42-116,156`,
  `src/instrumentation-node.ts:1-22`,
  `src/backend/jofra/publicFormSubmission.ts:99-164`,
  `src/backend/jofra/publicFormRedis.ts:55-112`,
  `src/backend/jofra/publicFormsEmail.ts:117-139`.
- Public frontend:
  `src/frontend/features/jofra-landing/JofraLanding.tsx:26,39,74,192-198,319,328,413,430,541,561,571,673`,
  `JofraSiteHeader.tsx:9-18,22-54,59-102,110-140`,
  `JofraPublicPage.tsx:11-25,29-66`,
  `JofraPublicForm.tsx:60-104,152-219`,
  `LanguageSwitch.tsx:8-26`,
  `JofraLanding.css:510-551,552-697,698,797-800,862-865`,
  `jofra-fonts.css:1-79`,
  `jofraFonts.ts:1-5`,
  `src/shared/jofra-public-form-schemas.ts`,
  `src/locales/nl.json`,
  `src/locales/ar.json`.
- Showcase/Pages:
  `showcase/README.md:3-18,27-30`,
  `showcase/next.config.js:1-15`,
  `showcase/app/[locale]/layout.tsx:1-43`,
  `showcase/app/(home)/layout.tsx:3-22`,
  `showcase/app/(home)/page.tsx:1-5`,
  `.github/workflows/jofra-showcase-pages.yml:1-8,20-98`,
  `scripts/verify-jofra-pages-export.mjs`.
- Test/deploy/documentation:
  `package.json:4-48`,
  `vitest.config.ts:4-19`,
  `vitest.integration.config.ts:4-11`,
  `playwright.config.ts:3-25`,
  `scripts/test-integration-safe.mjs:20-35`,
  `scripts/run-isolated-integration-tests.mjs:11-25,205-229`,
  `docker-compose.integration-test.yml:1-33`,
  `docker-compose.yml:12-27`,
  `docker-compose.smoke.yml:9-28`,
  `Dockerfile:1-62`,
  `drizzle/meta/_journal.json:1-29`,
  `docs/testing/isolated-integration-tests.md:1-21,81-83`,
  `docs/architecture.md:288-289`,
  `.env.example:1-69`,
  `docs/README.md`.
- History:
  commit `8b7753edce6e321920a4d0bf9873e56ca47e596f`
  (2026-10-25, first Pages showcase);
  commit `63c00cc34f9ed713f2ee9fabeb4ee3401ec2c937`
  (2026-10-28, public pages);
  commit `3b59444ce7b4693be709b0101e9a3638fe80d1cf`
  (2026-10-28, manual-only publishing);
  current HEAD `82fefb4af657c2435ad21258ce23b3007b6e7dd3`
  (2026-10-28, restored push deployment/parity).

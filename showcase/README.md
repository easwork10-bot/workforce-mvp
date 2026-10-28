# Jofra landing showcase

This is a static-only showcase of the Dutch and Arabic Jofra public pages. It
reuses the same landing and public-page components, typography, locale copy,
navigation, logo, and curated photographs as the main application. It does not
publish Workforce sign-in, employee/admin pages, API routes, database services,
or runtime secrets.

Dutch is published without a locale prefix at `/`, `/aanvragen/`, and
`/werken-bij-jofra/`. Arabic uses `/ar/`, `/ar/aanvragen/`, and
`/ar/werken-bij-jofra/`. The older `/nl/...` static routes remain available for
existing links, but shared navigation and language switching use the canonical
unprefixed Dutch paths.

The forms are rendered for visual preview but disabled on GitHub Pages, with a
localized notice explaining how to contact Jofra. Static export does not include
the Next.js API routes or Resend server configuration. Use a Node-capable
deployment for live submissions; the static demo cannot send requests.

The owner confirmed the existing postal address and KvK during the site QA pass;
they were not independently checked against an external register.

## Local preview

From the repository root in PowerShell, run:

```powershell
New-Item -ItemType Directory -Force .\showcase\public\jofra\assets | Out-Null
Copy-Item .\public\jofra\assets\* .\showcase\public\jofra\assets\
$env:NEXT_PUBLIC_BASE_PATH = "/workforce-mvp"
$env:NEXT_PUBLIC_APP_URL = "https://easwork10-bot.github.io"
npx next build showcase
node scripts/verify-jofra-pages-export.mjs showcase/out
Remove-Item Env:\NEXT_PUBLIC_BASE_PATH
Remove-Item Env:\NEXT_PUBLIC_APP_URL
```

Serve the contents of `showcase/out` with a static file server. The generated
files expect the repository path prefix `/workforce-mvp`; on GitHub Pages the
entry page is `/workforce-mvp/`, Dutch subpages are
`/workforce-mvp/aanvragen/` and `/workforce-mvp/werken-bij-jofra/`, and Arabic
pages are below `/workforce-mvp/ar/`.

The repeatable browser check is `npm run test:e2e`. It starts the main app with
public-form email configuration disabled, serves the static export locally, and
intercepts form API requests; it never sends email.

The GitHub Actions workflow runs typecheck, lint, unit tests, frontend boundary
checks, and the Workforce production build before building and publishing these
pages. Pushes to `jofra-showcase` deploy automatically after all checks pass;
`workflow_dispatch` remains available for manual runs.

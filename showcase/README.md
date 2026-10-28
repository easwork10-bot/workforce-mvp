# Jofra landing showcase

This is a static-only showcase of the Dutch and Arabic Jofra public pages. It
reuses the same landing and public-page components, typography, locale copy,
navigation, logo, and curated photographs as the main application. It does not
publish Workforce sign-in, employee/admin pages, API routes, database services,
or runtime secrets.

The public routes also include `/{locale}/aanvragen/` and
`/{locale}/werken-bij-jofra/` in Dutch and Arabic. This static GitHub Pages
export keeps `/nl` in its Dutch paths because GitHub Pages cannot run the
Next.js locale middleware needed to redirect `/nl/...` to unprefixed production
URLs. The production Next.js app uses Dutch without a locale prefix.

The forms are rendered for visual preview but disabled on GitHub Pages, with a
localized notice explaining how to contact Jofra. Static export does not include
the Next.js API routes or Resend server configuration. Use a Node-capable
deployment for live submissions; the static demo cannot send requests.

The owner confirmed the existing postal address and KvK during the site QA pass;
they were not independently checked against an external register.

## Local preview

From the repository root, run:

```sh
mkdir -p showcase/public/jofra/assets
cp public/jofra/assets/* showcase/public/jofra/assets/
NEXT_PUBLIC_BASE_PATH=/workforce-mvp npx next build showcase
NEXT_PUBLIC_BASE_PATH=/workforce-mvp node scripts/verify-jofra-pages-export.mjs showcase/out
```

Serve the contents of `showcase/out` with a static file server. The generated
files expect the repository path prefix `/workforce-mvp`; on GitHub Pages the
entry page is `/workforce-mvp/`, with Dutch at `/workforce-mvp/nl/` and Arabic
at `/workforce-mvp/ar/`.

The GitHub Actions workflow runs typecheck, lint, unit tests, frontend boundary
checks, and the Workforce production build before building and publishing these
pages. Pushes to `jofra-showcase` deploy automatically after all checks pass;
`workflow_dispatch` remains available for manual runs.

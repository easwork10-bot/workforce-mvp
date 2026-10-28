# Jofra landing showcase

This is a static-only showcase of the Dutch and Arabic Jofra marketing landing
pages. It reuses the landing feature, locale copy, logo, and curated Jofra
photographs from the main project. It does not publish Workforce sign-in, employee/admin pages,
API routes, database services, or runtime secrets.

The public routes also include `/{locale}/aanvragen/` and
`/{locale}/werken-bij-jofra/` in Dutch and Arabic. This static GitHub Pages
export keeps `/nl` in its Dutch paths because GitHub Pages cannot run the
Next.js locale middleware needed to redirect `/nl/...` to unprefixed production
URLs. The production Next.js app uses Dutch without a locale prefix.

The forms are rendered for visual preview but cannot submit from GitHub Pages:
the static export does not include the Next.js API routes or Resend server
configuration. Use a Node-capable deployment for live submissions; the static
demo must not be used to send real requests.

The owner confirmed the existing postal address and KvK during the site QA pass;
they were not independently checked against an external register.

## Local preview

From the repository root, run:

```sh
mkdir -p showcase/public/jofra/assets
cp public/jofra/assets/* showcase/public/jofra/assets/
NEXT_PUBLIC_BASE_PATH=/workforce-mvp npx next build showcase
```

Serve the contents of `showcase/out` with a static file server. The generated
files expect the repository path prefix `/workforce-mvp`; on GitHub Pages the
entry page is `/workforce-mvp/`, with Dutch at `/workforce-mvp/nl/` and Arabic
at `/workforce-mvp/ar/`.

The GitHub Actions workflow can build and publish this output only when manually
started with `workflow_dispatch`; pushing to `jofra-showcase` does not deploy it.

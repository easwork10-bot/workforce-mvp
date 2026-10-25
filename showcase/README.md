# Jofra landing showcase

This is a static-only showcase of the Dutch and Arabic Jofra marketing landing
pages. It reuses the landing feature, locale copy, logo, and worker photo from
the main project. It does not publish Workforce sign-in, employee/admin pages,
API routes, database services, or runtime secrets.

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

The `jofra-showcase` branch's GitHub Actions workflow builds this output and
publishes it to GitHub Pages.

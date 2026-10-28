# Jofra landing showcase

This is a static-only showcase of the Dutch and Arabic Jofra marketing landing
pages. It reuses the landing feature, locale copy, logo, and curated Jofra
photographs from the main project. It does not publish Workforce sign-in, employee/admin pages,
API routes, database services, or runtime secrets.

The public routes also include `/{locale}/aanvragen/` and
`/{locale}/werken-bij-jofra/` in Dutch and Arabic. Quote buttons lead to a
validated personnel-request form. This form **only prepares an email draft**:
it does not send, store, or confirm delivery of inquiries. Visitors must open
their email application and send the draft themselves; phone/email alternatives
are shown. Recruitment is an open email enquiry, not an advertised vacancy.

Automatic delivery is not configured and cannot run on GitHub Pages alone.
A server-side endpoint or approved form-delivery provider and a verified delivery
test are required before presenting an automatically submitted request as sent.

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

The `jofra-showcase` branch's GitHub Actions workflow builds this output and
publishes it to GitHub Pages.

# GitHub Pages deployment

For project setup, features, and verification commands, start with the
repository [`README`](../README.md).

The application is a static ES-module site. All application, Worker, stylesheet,
and seed-resource URLs are relative to their importing document or module, so
the same `dist` directory works at a domain root or a project Pages subpath.

## Local release verification

From a clean clone:

```sh
npm install --ignore-scripts
npm test
npm run verify:fixtures
npm run verify:pages
```

`verify:pages` rebuilds `dist`, mounts it at `/OutMatch-Evolution`, launches a
real module Worker and the browser acceptance checks, and captures desktop and
phone screenshots. It requires Chromium on `PATH`, or an explicit
`CHROMIUM_PATH`. The mount name is only a local project-subpath simulation; the
static output itself contains no repository-name-specific URLs.

To inspect the production build manually without the simulated subpath, run:

```sh
npm run build
SERVE_ROOT=dist npm run dev
```

## Automated deployment

`.github/workflows/pages.yml` tests, validates fixtures, exercises the built site
under the simulated project subpath, and retains the browser screenshots for 14
days on pull requests to `main`. Pushes to `main` and manual dispatches also
upload `dist` and deploy it with the official GitHub Pages actions. In the
repository settings, select **GitHub Actions** as the Pages source. No generated
`dist` or browser artifact files need to be committed.

## Release status

The native Chromium acceptance run is reported passing in CI. Browser screenshots
are retained with the workflow run, and deployment remains gated on the same
`verify:pages` command. Repository owners should review those artifacts and the
deployed URL as the final release sign-off rather than committing generated files.

# OutMatch Reach Evolution Lab

A local-first, deterministic laboratory for evolving and auditing OutMatch Reach
generals. The application runs entirely in the browser: tournaments execute in
module Workers, durable checkpoints and completed generations live in IndexedDB,
and portable `.omgen` archives support offline transfer and continuation.

## Release status

The deterministic engine, R29 reproduction, evolution pipeline, durable
generation management, portable archive format, production Lab interface,
Chromium acceptance automation, and GitHub Pages delivery workflow are
implemented. See [`TASKS.md`](TASKS.md) for the concise status and
[`docs/CONTINUATION_PLAN.md`](docs/CONTINUATION_PLAN.md) for acceptance details.

## Features

- Canonical Reach engine with deterministic golden-game verification.
- Three-stage Worker tournament with durable between-game checkpoints.
- Deterministic migration, breeding, mutation, and wildcard selection.
- Start, pause, reload, resume, multi-generation, and boundary-stop controls.
- Immutable completed generations, ledgers, reports, rankings, and provenance.
- Audited manual moves, copy entrants, and validated 112-locus JSON replacement files.
- Population filtering, sorting, lineage inspection, and CSV/JSON reports.
- Explicit-color exhibitions stored separately from evolutionary ledgers.
- Graphical, keyboard-operable replay timeline backed by immutable frames.
- Self-contained `.omgen` export, validation, import, and continuation.
- Desktop/phone Chromium acceptance and project-subpath Pages verification.

## Requirements

- Node.js 22 or newer for development and verification.
- A modern browser with ES modules, module Workers, IndexedDB, Web Crypto, and
  Blob download support.
- Chromium on `PATH`, or `CHROMIUM_PATH`, for native browser verification.

The application has no runtime package dependencies and does not require a
backend service.

## Quick start

```sh
npm run dev
```

Open <http://localhost:4173>. Browser data remains local to that origin. To
build and serve the production output instead:

```sh
npm run build
SERVE_ROOT=dist npm run dev
```

## Verification

Fast and focused commands:

```sh
npm test
npm run verify:fixtures
npm run verify:step3
npm run verify:step4
npm run verify:step5
npm run verify:step6
```

Native and release gates:

```sh
npm run verify:browser
npm run verify:pages
npm run verify:all
```

`verify:pages` builds `dist`, mounts it at `/OutMatch-Evolution`, exercises real
module Workers and IndexedDB in Chromium, and captures desktop and phone
screenshots under `artifacts/browser/`. `verify:all` is strict and fails when a
required browser is unavailable.

## Data and privacy

Runs, checkpoints, generations, ledgers, settings, and replays are stored in the
browser's IndexedDB. No application data is uploaded by the Lab. Users should
export important generations as `.omgen` files before clearing site data or
changing browsers or origins.

Exhibition games and their replay frames are deliberately stored outside the
evolutionary ledger and cannot be committed as tournament results.

## Deployment

The static build is project-subpath safe. The Pages workflow verifies the built
site, retains browser screenshots, uploads `dist`, and deploys on `main` or
manual dispatch. Repository setup and clean-clone reproduction are documented in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Versioned tags matching `package.json` (for example `v0.1.0`) run the release
workflow after the full built-site browser gate. Each GitHub release includes a
compressed static site and its Chromium screenshot evidence. Release history is
recorded in [`CHANGELOG.md`](CHANGELOG.md).

## Architecture and specifications

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — subsystem boundaries and data flow.
- [`docs/STEP3_EVOLUTION_PIPELINE.md`](docs/STEP3_EVOLUTION_PIPELINE.md) — evolution pipeline.
- [`docs/STEP4_DURABLE_GENERATIONS.md`](docs/STEP4_DURABLE_GENERATIONS.md) — persistence and resume semantics.
- [`docs/STEP5_PORTABLE_OMGEN.md`](docs/STEP5_PORTABLE_OMGEN.md) — portable archive format.
- [`docs/CONTINUATION_PLAN.md`](docs/CONTINUATION_PLAN.md) — UI and release acceptance batches.

## Determinism policy

Deterministic behavior is part of the stored audit contract. Do not replace the
seeded PRNG, reorder canonical schedules, mutate completed generation objects, or
bypass the durable coordinator from UI code. Any intentional rules or format
change should receive a new version identifier and updated fixtures.

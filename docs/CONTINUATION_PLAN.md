# Continuation plan

This document is the handoff point for a fresh Codex session. Read `TASKS.md`, `docs/ARCHITECTURE.md`, and this file before editing. The current branch has completed the deterministic engine and Steps 2–5. Step 6 has a functional local shell, run selection, `.omgen` import/export, storage inspection, ecology drafts, separately hashed intervention drafts, persisted progress display, and immutable report inspection.

## Invariants to preserve

- The UI calls `runDurableTournamentStages` and `finalizeDurableTournament`; it must not reproduce tournament phase transitions.
- A displayed completed game is durable only when represented by the persisted checkpoint cursor and schedule prefix.
- Worker completion order must never change schedule or ledger order.
- Controls and interventions retain separate canonical SHA-256 hashes. Interventions are bound to their parent generation.
- Completed generation and ledger records remain immutable and finalize atomically.
- Exhibition games never enter the evolutionary ledger.
- `.omgen` imports are verified before any write transaction begins.

## Remaining batches

### Batch 6.1 — browser run service — complete

Create a UI-facing application service rather than adding orchestration logic to `src/ui/main.js`.

Deliverables:

1. Build the initial progress record from the selected parent generation, reviewed controls, intervention document, breeding seed, and PRNG version.
2. Adapt browser Workers to the existing worker protocol and bounded pool.
3. Invoke `runDurableTournamentStages` with the real schedule/ranking/challenger hooks.
4. Invoke `finalizeDurableTournament` with report and immutable-record builders.
5. Expose `start`, `requestPause`, `resume`, and `stopAfterGeneration` operations to the UI.
6. Prevent start when controls were not reviewed, an intervention is invalid, storage is unavailable, or progress already exists.

Acceptance:

- An integration test runs a reduced generation through the service and atomically commits it.
- Pause/reopen/resume returns the same ledger and child fingerprint as uninterrupted execution.
- UI code contains no duplicate tournament state machine.

Implemented in `src/ui/run-service.js`. The service creates the first durable
checkpoint from reviewed, separately hashed inputs; binds canonical tournament
hooks and browser Worker execution; and owns start, pause, reopen/resume, and
generation-boundary stop requests. Reduced-generation integration coverage
checks the single final commit and pause/reopen determinism. A fresh service can
now reconstruct its deterministic hooks through `restoreGeneration`, and rejects
a restored child candidate that differs from the durable checkpoint.

### Batch 6.2 — run controls and live feedback — core complete

Deliverables:

1. Add **Run next generation**, **Run N generations**, **Pause after current game**, **Resume**, and **Stop at generation boundary** controls.
2. Disable controls according to durable phase and active operation.
3. Refresh progress only from in-memory results that have also been checkpointed, or from `ProgressRepository`.
4. Show execution failures separately from persistence failures and retain the last safe cursor.

Acceptance:

- Button-state tests cover idle, running, pause-requested, paused, finalizing, and failed states.
- Reloading while paused displays a resumable operation without replaying games.

The lab derives all execution-button availability from a tested operation model
and durable progress, distinguishes execution from persistence failures, and
displays the last safe cursor. Production DOM wiring delegates preparation and
durable orchestration to the run service; controls stay disabled until a selected
immutable parent and reviewed draft make starting safe.

### Batch 6.3 — populations and lineage — complete

Deliverables:

1. Add seven population summaries from the selected immutable checkpoint.
2. Provide sort/filter by rank, ID/name, origin, fitness, training/kills/pokes, and parentage.
3. Add a general detail view with provenance, fitness components, unit behavior, and expandable genome.
4. Queue manual interventions from the selected general while preserving the intervention validators.

Acceptance:

- Population counts always total 49 per population for complete generations.
- All stored text is escaped and no genome/provenance object is mutated by sorting or filtering.

Implemented with immutable population adapters, seven checkpoint summaries,
multi-field filtering and sorting, expandable genome/provenance detail, and a
validator-backed path from the selected general to an intervention draft.

### Batch 6.4 — report-specific views — complete

The generic immutable viewer and matrix CSV support already exist. Extend it without recalculating archived reports.

Deliverables:

1. Add dedicated views for elimination, similarity, unit training/kills, rankings, migration/breeding, and generation comparison.
2. Add report-specific CSV serializers and retain JSON downloads.
3. Add generation-to-generation deltas when both immutable generations are available.

Acceptance:

- UI adapters reproduce values already stored in the generation record.
- CSV tests cover escaping, nulls, ordering, and report-specific columns.

Archived elimination, similarity, unit-rate, ranking, migration, and breeding
records now receive dedicated tabular adapters and CSV output. When the prior
immutable generation is available, the comparison view shows stable numeric
deltas derived only from values already stored in both records.

### Batch 6.5 — matchups and deterministic replay — complete

Deliverables:

1. Select two generals or one general and a population.
2. Show historical ledger statistics when present.
3. Run deterministic exhibition games through the Worker protocol with explicit color selection.
4. Persist replay records separately and render the board/action trace.
5. Clearly label historical, exhibition, and evolutionary games.

Acceptance:

- Exhibition rows cannot be written to generation ledgers.
- Replaying the same stored trace produces the same board sequence.

Exhibitions now use a distinct Worker request/result type, explicit red and blue
selection, and the replay repository rather than generation ledgers. Stored
action traces include immutable board frames, while historical summaries remain
clearly labeled as evolutionary ledger data.

### Batch 6.6 — browser acceptance and accessibility

Deliverables:

1. Add real-browser tests for IndexedDB upgrade/reopen, Worker execution, pause/reload/resume, import/export, and downloads.
2. Test laptop and phone breakpoints, keyboard navigation, dialogs, focus return, labels, and status announcements.
3. Capture screenshots for the dashboard, active run, reports, populations, and replay at desktop and mobile sizes.

Acceptance:

- `npm test`, all focused verification scripts, and browser tests pass.
- No horizontal page overflow at the phone breakpoint; wide tables scroll within their own containers.

Accessibility groundwork now includes skip navigation, visible keyboard focus,
labeled dialogs with focus return, live execution status, and keyboard-focusable
wide tables. `npm run verify:browser` provides a dependency-free Chromium smoke
check and desktop/phone screenshot capture. Its in-browser acceptance page now
exercises IndexedDB upgrade/reopen, a real module Worker game, `.omgen`
export/import, Blob download construction, and an actual document reload between
a persisted pause and deterministic resume. The reported Chromium CI run completed
those checks. A deterministic visual scenario now
scripts dashboard, active-run, report, population, and replay captures at both
breakpoints. The acceptance page also checks phone-width overflow, skip-link
focus, and dialog focus entry/return.

### Batch 7.1 — consolidated acceptance

Deliverables:

1. Add one documented command that runs golden, Steps 3–6, build, and browser acceptance checks.
2. Add fixture/checksum validation before expensive suites.
3. Document expected runtime and environment requirements.

Run the complete release gate with `npm run verify:all`. It validates the
checked-in deterministic fixture and seed SHA-256 manifest before starting the
expensive suites, then runs the full Node suite, golden games, focused Steps
3–6, the static build, and native browser acceptance in order. The command is
intentionally strict: a missing Chromium installation is a failure rather than
a skipped release gate. Set `CHROMIUM_PATH` when Chromium is not available as
`chromium`, `chromium-browser`, or `google-chrome` on `PATH`.

Runtime depends primarily on the full golden-game set and host CPU. Allow
several minutes on a typical developer laptop and additional time on constrained
CI runners. The command requires a supported Node/npm installation, enough CPU
and memory for Worker tests, an available loopback port `4173`, and headless
Chromium with permission to write screenshots under `artifacts/browser/`.

### Batch 7.2 — GitHub Pages delivery

Deliverables:

1. Make the static build base-path safe for a project Pages URL.
2. Add deployment documentation and a Pages workflow.
3. Verify a clean clone can test, build, serve `dist`, and use browser Workers from the deployed path.

The static build now includes browser acceptance assets and can be mounted below
a project subpath by the development server. `npm run verify:pages` builds and
serves `dist` at `/OutMatch-Evolution`, then runs the real Worker/browser checks
against that nested URL. Pull requests run this gate and retain its screenshots;
pushes to `main` run it before uploading and deploying `dist`. Setup and local reproduction are documented in
[`DEPLOYMENT.md`](DEPLOYMENT.md). Local reproduction still requires a
Chromium-equipped environment; CI is the authoritative native-browser gate.

## Commands at handoff

```sh
npm test
npm run verify:step3
npm run verify:step4
npm run verify:step5
npm run verify:step6
npm run build
npm run verify:fixtures
npm run verify:all
npm run verify:pages
```

`verify:step6` covers the fast UI models and render/action adapters; the reported CI browser run supplies the complementary native acceptance gate.

## Known gaps and cautions

- The production DOM instantiates `BrowserRunService` and `RunOperationController`, loads repository-backed parent ledgers and evolution resources, and wires run-next, run-many, pause, resume, and boundary-stop controls; the reported native-browser CI run covers this path.
- Manual moves, copies, and validated 112-locus replacement uploads enter child resident pools as audited, non-breeding residents; production wiring passes the reviewed intervention document into generation assembly.
- The reviewed mutation probability is now consumed by generation breeding for ordinary and self-cross births; preserve its deterministic rescaling when wiring the production preparer.
- Automatic migration planning now evaluates every outsider only against the generation's canonical recruiting population and returns both the audited candidates and selected entrants.
- `prepareProductionGeneration` combines the parent ledger, reviewed controls, migration, interventions, mutation ranges, breeding, canonical Stage 1 scheduling, report builders, and immutable record builders; reviewed hashes are persisted for reload restoration.
- Replay rendering now provides a graphical, keyboard-operable Reach board timeline while retaining raw stored frames for audit inspection.
- The build and Pages workflow are project-subpath safe and verified by the reported Chromium CI run; local reproduction still requires `CHROMIUM_PATH` when Chrome is not on `PATH`.
- Batch 7.1's consolidated release command and fixture checksum preflight are implemented, and browser artifacts are retained by CI for audit.

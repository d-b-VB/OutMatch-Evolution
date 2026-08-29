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

### Batch 6.1 — browser run service

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

### Batch 6.2 — run controls and live feedback

Deliverables:

1. Add **Run next generation**, **Run N generations**, **Pause after current game**, **Resume**, and **Stop at generation boundary** controls.
2. Disable controls according to durable phase and active operation.
3. Refresh progress only from in-memory results that have also been checkpointed, or from `ProgressRepository`.
4. Show execution failures separately from persistence failures and retain the last safe cursor.

Acceptance:

- Button-state tests cover idle, running, pause-requested, paused, finalizing, and failed states.
- Reloading while paused displays a resumable operation without replaying games.

### Batch 6.3 — populations and lineage

Deliverables:

1. Add seven population summaries from the selected immutable checkpoint.
2. Provide sort/filter by rank, ID/name, origin, fitness, training/kills/pokes, and parentage.
3. Add a general detail view with provenance, fitness components, unit behavior, and expandable genome.
4. Queue manual interventions from the selected general while preserving the intervention validators.

Acceptance:

- Population counts always total 49 per population for complete generations.
- All stored text is escaped and no genome/provenance object is mutated by sorting or filtering.

### Batch 6.4 — report-specific views

The generic immutable viewer and matrix CSV support already exist. Extend it without recalculating archived reports.

Deliverables:

1. Add dedicated views for elimination, similarity, unit training/kills, rankings, migration/breeding, and generation comparison.
2. Add report-specific CSV serializers and retain JSON downloads.
3. Add generation-to-generation deltas when both immutable generations are available.

Acceptance:

- UI adapters reproduce values already stored in the generation record.
- CSV tests cover escaping, nulls, ordering, and report-specific columns.

### Batch 6.5 — matchups and deterministic replay

Deliverables:

1. Select two generals or one general and a population.
2. Show historical ledger statistics when present.
3. Run deterministic exhibition games through the Worker protocol with explicit color selection.
4. Persist replay records separately and render the board/action trace.
5. Clearly label historical, exhibition, and evolutionary games.

Acceptance:

- Exhibition rows cannot be written to generation ledgers.
- Replaying the same stored trace produces the same board sequence.

### Batch 6.6 — browser acceptance and accessibility

Deliverables:

1. Add real-browser tests for IndexedDB upgrade/reopen, Worker execution, pause/reload/resume, import/export, and downloads.
2. Test laptop and phone breakpoints, keyboard navigation, dialogs, focus return, labels, and status announcements.
3. Capture screenshots for the dashboard, active run, reports, populations, and replay at desktop and mobile sizes.

Acceptance:

- `npm test`, all focused verification scripts, and browser tests pass.
- No horizontal page overflow at the phone breakpoint; wide tables scroll within their own containers.

### Batch 7.1 — consolidated acceptance

Deliverables:

1. Add one documented command that runs golden, Steps 3–6, build, and browser acceptance checks.
2. Add fixture/checksum validation before expensive suites.
3. Document expected runtime and environment requirements.

### Batch 7.2 — GitHub Pages delivery

Deliverables:

1. Make the static build base-path safe for a project Pages URL.
2. Add deployment documentation and a Pages workflow.
3. Verify a clean clone can test, build, serve `dist`, and use browser Workers from the deployed path.

## Commands at handoff

```sh
npm test
npm run verify:step3
npm run verify:step4
npm run verify:step5
npm run verify:step6
npm run build
```

`verify:step6` currently covers the pure UI models and render/action adapters. Batch 6.6 should extend it with browser acceptance rather than replacing these fast tests.

## Known gaps and cautions

- The progress panel reads durable checkpoints but does not yet start or resume the coordinator.
- Current report rendering is generic except for matrix tables; dedicated report semantics remain.
- Manual move and copy-entrant drafts are validated and hashed, but applying them to child resident pools belongs in the browser run service batch. The advanced replacement/upload operation is still pending.
- There is no populations screen, matchup launcher, or replay board yet.
- The build copies static files and has not been validated under a GitHub Pages project subpath.
- Node tests use injected IndexedDB and Worker doubles; real-browser acceptance remains mandatory.

# Evolution and persistence architecture

The deterministic engine produces one ledger row per scheduled game. Tournament scheduling owns Stage 1, Stage 2, ranking, and challenger transitions; Worker execution may finish games out of order but must return rows in schedule order. Generation assembly consumes final rankings and a versioned breeding PRNG to produce a fingerprinted child checkpoint.

Durable orchestration is responsible for connecting those core modules:

1. create a run and persist deterministic controls;
2. assemble and persist the child candidate;
3. execute Stage 1 from a resumable schedule prefix, then rank it;
4. build and execute Stage 2, then rank it;
5. execute iterative challenger cleanup;
6. build reports and atomically commit the completed generation and ledger;
7. delete obsolete progress only in the final commit transaction.

Persistence checkpoints are phase-specific and may be written only between games. Reopening verifies the parent fingerprint, control and intervention hashes, breeding seed, and PRNG version before continuing. The durable coordinator connects resumable Stage 1, Stage 2, and iterative challenger execution through final ranking, report construction, and an atomic completed-generation/ledger commit. Native Chromium acceptance covers IndexedDB reopen, module Worker execution, and pause/reload/resume behavior.

Portable `.omgen` files serialize completed immutable records, not in-progress IndexedDB transactions. Verified imports can be assigned a new storage run identity and reconstructed as deterministic continuation parents without changing their archived checkpoint fingerprints. The lab interface calls the durable coordinator rather than independently reproducing phase transitions.

`BrowserRunService` owns deterministic preparation/restoration and coordinator hook construction, while `RunOperationController` publishes durable operation state to the UI. DOM event handling remains in `src/ui/main.js`, deterministic presentation adapters remain in `src/ui/`, and tournament/persistence transitions remain in their core modules.

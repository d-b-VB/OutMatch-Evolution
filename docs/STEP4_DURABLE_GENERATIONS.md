# Step 4: Durable generation management

The Step 4 persistence primitives store run metadata, immutable completed generations and ledgers, resumable progress, settings, and optional replays in versioned IndexedDB stores.

Progress is saved only between games. A checkpoint contains the complete schedule prefix, deterministic parent and control identities, breeding seed and PRNG version, and enough tournament state to resume without replaying games. Completing a generation atomically writes its generation and ledger records while deleting obsolete progress.

The resumable executor supports cooperative pause, configurable checkpoint intervals, bounded retries for transient IndexedDB failures, and reports the last safely committed cursor. Run deletion removes all artifacts owned by that run in one transaction. Storage Manager inspection reports quota and can request persistent browser storage.

Run the focused acceptance suite with:

```sh
npm run verify:step4
```

The suite covers migration logic, repositories, pause/reopen/resume execution, immutable finalization, replay storage, cleanup, and storage-quota behavior using injected IndexedDB test doubles. Real-browser IndexedDB acceptance and durable tournament orchestration remain later integration gates.

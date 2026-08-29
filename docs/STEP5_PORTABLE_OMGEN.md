# Step 5: Portable `.omgen` generations

An `.omgen` file is a deterministic, uncompressed ZIP archive containing `manifest.json`, `generation.json`, and `ledger.json` in that order. JSON object keys are recursively sorted, ZIP timestamps are frozen, and repeated exports with the same creation timestamp are byte-identical.

The manifest identifies format version 1, the generation fingerprint, canonical entry paths, exact byte lengths, and SHA-256 digests. Import rejects unsupported versions, unsafe or unexpected paths, duplicate or missing entries, size-limit violations, CRC corruption, SHA-256 corruption, and mismatched run/generation/ledger references before database writes.

Import first produces a non-mutating inspection and explicit plan. Existing identities are never overwritten. A caller may choose a new run ID; storage-level run and ledger references are rewritten consistently while the immutable generation checkpoint and its fingerprint are preserved. The run, ledger, and generation are then inserted in one transaction.

Imported checkpoints are validated again before continuation. Parent metadata, population/provenance invariants, fingerprint, breeding seed, and PRNG version are used to create a fresh durable `initialized` progress record. Continuation receives clones so archived immutable records cannot be changed by evolution code.

Run the focused suite with:

```sh
npm run verify:step5
```
